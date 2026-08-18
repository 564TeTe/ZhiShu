import { createInterface } from 'node:readline';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

import crossSpawn from 'cross-spawn';

import {
  abortCodexSession,
  queryCodex,
} from '@/modules/providers/list/codex/codex-runtime.provider.js';
import type { IProviderRuntime } from '@/shared/interfaces.js';
import type {
  AnyRecord,
  ProviderPermissionDecision,
  ProviderRuntimeContext,
  ProviderRuntimeWriter,
} from '@/shared/types.js';
import { createCompleteMessage, createNormalizedMessage } from '@/shared/utils.js';

type JsonRpcId = string | number;

type JsonRpcMessage = {
  id?: JsonRpcId;
  method?: string;
  params?: AnyRecord;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

type SpawnAppServer = () => ChildProcessWithoutNullStreams;

type CodexControlledRuntimeOptions = {
  requestTimeoutMs: number;
  approvalTimeoutMs: number;
};

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_APPROVAL_TIMEOUT_MS = 10 * 60_000;

type AppServerRun = {
  client: CodexAppServerClient;
  runtimeSessionKey: string | null;
  threadId: string | null;
  turnId: string | null;
  status: 'running' | 'aborted' | 'completed';
  startedAt: string;
  resolvedApprovals: Map<string, 'accept' | 'decline' | 'cancel'>;
};

type PendingApproval = {
  client: CodexAppServerClient;
  rpcIds: Set<JsonRpcId>;
  runtimeApprovalId: string;
  sessionId: string;
  requestType: 'command' | 'file';
  request: AnyRecord;
  timeout: NodeJS.Timeout;
};

type ThreadStartResult = {
  thread?: { id?: string };
  approvalPolicy?: unknown;
  sandbox?: unknown;
};

type TurnStartResult = {
  turn?: { id?: string };
};

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as AnyRecord
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function createCodexEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  delete environment.CODEX_API_KEY;
  return environment;
}

function defaultSpawnAppServer(): ChildProcessWithoutNullStreams {
  return crossSpawn('codex', ['app-server', '--stdio'], {
    env: createCodexEnvironment(),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  }) as ChildProcessWithoutNullStreams;
}

class CodexAppServerClient {
  private readonly process: ChildProcessWithoutNullStreams;
  private readonly requestResolvers = new Map<JsonRpcId, {
    resolve(value: unknown): void;
    reject(error: Error): void;
    timeout: NodeJS.Timeout;
  }>();
  private nextRequestId = 1;
  private stderr = '';
  private closed = false;
  private closeNotified = false;

  constructor(
    spawnAppServer: SpawnAppServer,
    private readonly onNotification: (message: JsonRpcMessage) => void,
    private readonly onServerRequest: (message: JsonRpcMessage) => void,
    private readonly onClosed: (error: Error) => void,
    private readonly requestTimeoutMs: number,
  ) {
    this.process = spawnAppServer();
    const lines = createInterface({ input: this.process.stdout });
    lines.on('line', (line) => this.handleLine(line));
    this.process.stderr.on('data', (chunk: Buffer | string) => {
      this.stderr = `${this.stderr}${String(chunk)}`.slice(-8_000);
    });
    this.process.once('error', (error) => this.notifyClosed(error));
    this.process.once('exit', (code, signal) => {
      const detail = this.stderr.trim();
      const suffix = detail ? `: ${detail}` : '';
      this.notifyClosed(new Error(`Codex App Server exited (${code ?? signal ?? 'unknown'})${suffix}`));
    });
  }

  async initialize(): Promise<void> {
    const result = asRecord(await this.request('initialize', {
      clientInfo: { name: 'zhishu', title: 'Zhishu Agent Task', version: '1.0.0' },
      capabilities: { experimentalApi: false, requestAttestation: false },
    }));
    if (
      !readString(result?.userAgent)
      || !readString(result?.codexHome)
      || !readString(result?.platformFamily)
      || !readString(result?.platformOs)
    ) {
      throw new Error('Codex App Server is incompatible: initialize returned an unsupported response.');
    }
    this.notify('initialized');
  }

  request(method: string, params: AnyRecord): Promise<unknown> {
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.requestResolvers.delete(id);
        reject(new Error(`Codex App Server request timed out: ${method}`));
      }, this.requestTimeoutMs);
      this.requestResolvers.set(id, { resolve, reject, timeout });
      this.write({ method, id, params });
    });
  }

  notify(method: string, params?: AnyRecord): void {
    this.write(params ? { method, params } : { method });
  }

  respond(id: JsonRpcId, result: unknown): void {
    this.write({ id, result });
  }

  respondError(id: JsonRpcId, code: number, message: string): void {
    this.write({ id, error: { code, message } });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.process.stdin.end();
    if (!this.process.killed) this.process.kill();
    this.notifyClosed(new Error('Codex App Server was closed'));
  }

  private write(message: JsonRpcMessage): void {
    if (this.closed || !this.process.stdin.writable) {
      throw new Error('Codex App Server is not writable');
    }
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      return;
    }

    if (message.id !== undefined && !message.method) {
      const resolver = this.requestResolvers.get(message.id);
      if (!resolver) return;
      this.requestResolvers.delete(message.id);
      clearTimeout(resolver.timeout);
      if (message.error) {
        resolver.reject(new Error(message.error.message ?? 'Codex App Server request failed'));
      } else {
        resolver.resolve(message.result);
      }
      return;
    }

    if (message.id !== undefined && message.method) {
      this.onServerRequest(message);
      return;
    }
    if (message.method) this.onNotification(message);
  }

  private failPending(error: Error): void {
    for (const resolver of this.requestResolvers.values()) {
      clearTimeout(resolver.timeout);
      resolver.reject(error);
    }
    this.requestResolvers.clear();
  }

  private notifyClosed(error: Error): void {
    this.failPending(error);
    if (this.closeNotified) return;
    this.closeNotified = true;
    this.onClosed(error);
  }
}

function buildRuntimeApprovalId(message: JsonRpcMessage): string {
  const params = message.params ?? {};
  const threadId = readString(params.threadId) ?? 'thread';
  const turnId = readString(params.turnId) ?? 'turn';
  const itemId = readString(params.itemId) ?? 'item';
  const approvalId = readString(params.approvalId) ?? String(message.id);
  return `codex:${threadId}:${turnId}:${itemId}:${approvalId}`;
}

function firstChangedPath(changes: unknown): string | null {
  if (!Array.isArray(changes)) return null;
  for (const change of changes) {
    const record = asRecord(change);
    const path = readString(record?.path) ?? readString(record?.filePath);
    if (path) return path;
  }
  return null;
}

function createAppServerRuntime(
  spawnAppServer: SpawnAppServer,
  runtimeConfig: CodexControlledRuntimeOptions,
): IProviderRuntime {
  const activeRuns = new Map<string, AppServerRun>();
  const pendingApprovals = new Map<string, PendingApproval>();

  const registerRun = (run: AppServerRun, key: string | null): void => {
    if (key) activeRuns.set(key, run);
  };

  const removeRun = (run: AppServerRun): void => {
    for (const [key, value] of activeRuns.entries()) {
      if (value === run) activeRuns.delete(key);
    }
    for (const [key, approval] of pendingApprovals.entries()) {
      if (approval.client === run.client) {
        clearTimeout(approval.timeout);
        pendingApprovals.delete(key);
      }
    }
    run.resolvedApprovals.clear();
  };

  const runControlled = async (
    command: string,
    options: AnyRecord,
    writer: ProviderRuntimeWriter,
    context: ProviderRuntimeContext,
  ): Promise<void> => {
    const workingDirectory = readString(options.cwd) ?? readString(options.projectPath) ?? process.cwd();
    const runtimeSessionKey = readString(options.runtimeSessionKey);
    const requestedModel = await context.resolveResumeModel(undefined, readString(options.model));
    const catalog = await context.getProviderModels();
    const resolvedModel = catalog.OPTIONS.some((option) => option.value === requestedModel)
      ? requestedModel
      : catalog.DEFAULT;
    let resolveTurn!: () => void;
    let rejectTurn!: (error: Error) => void;
    const turnFinished = new Promise<void>((resolve, reject) => {
      resolveTurn = resolve;
      rejectTurn = reject;
    });
    // Initialization can fail before the main flow reaches `await turnFinished`.
    // Observe early process-exit rejection immediately while preserving the
    // original promise for the normal turn lifecycle await below.
    void turnFinished.catch(() => undefined);
    let run!: AppServerRun;
    const fileChangesByItemId = new Map<string, unknown[]>();

    const send = (message: unknown): void => writer.send(message);
    const sendItem = (item: AnyRecord, completed: boolean): void => {
      const itemType = readString(item.type);
      const sessionId = run.threadId ?? runtimeSessionKey;
      if (itemType === 'agentMessage' && completed) {
        send(createNormalizedMessage({
          kind: 'text', role: 'assistant', content: readString(item.text) ?? '',
          sessionId, provider: 'codex',
        }));
      } else if (itemType === 'reasoning' && completed) {
        const summary = Array.isArray(item.summary) ? item.summary.join('\n') : '';
        send(createNormalizedMessage({
          kind: 'thinking', content: summary, sessionId, provider: 'codex',
        }));
      } else if (itemType === 'commandExecution') {
        const toolId = readString(item.id) ?? `command-${Date.now()}`;
        if (!completed) {
          send(createNormalizedMessage({
            kind: 'tool_use', toolName: 'Bash', toolId,
            toolInput: { command: readString(item.command) ?? '', cwd: readString(item.cwd) },
            sessionId, provider: 'codex',
          }));
        } else {
          send(createNormalizedMessage({
            kind: 'tool_result', toolName: 'Bash', toolId,
            content: readString(item.aggregatedOutput) ?? '',
            isError: typeof item.exitCode === 'number' && item.exitCode !== 0,
            sessionId, provider: 'codex',
          }));
        }
      } else if (itemType === 'fileChange') {
        const toolId = readString(item.id) ?? `file-${Date.now()}`;
        const changes = Array.isArray(item.changes) ? item.changes : [];
        fileChangesByItemId.set(toolId, changes);
        const filePath = firstChangedPath(changes);
        if (!completed) {
          send(createNormalizedMessage({
            kind: 'tool_use', toolName: 'Write', toolId,
            toolInput: { file_path: filePath, changes },
            sessionId, provider: 'codex',
          }));
        } else {
          send(createNormalizedMessage({
            kind: 'tool_result', toolName: 'Write', toolId,
            content: changes, isError: item.status === 'failed',
            sessionId, provider: 'codex',
          }));
        }
      }
    };

    const handleNotification = (message: JsonRpcMessage): void => {
      const params = message.params ?? {};
      if (message.method === 'item/started' || message.method === 'item/completed') {
        const item = asRecord(params.item);
        if (item) sendItem(item, message.method === 'item/completed');
        return;
      }
      if (message.method === 'item/fileChange/patchUpdated') {
        const itemId = readString(params.itemId);
        if (itemId && Array.isArray(params.changes)) {
          fileChangesByItemId.set(itemId, params.changes);
        }
        return;
      }
      if (message.method === 'turn/completed') {
        const turn = asRecord(params.turn);
        const status = readString(turn?.status);
        const error = asRecord(turn?.error);
        if (status === 'failed') {
          rejectTurn(new Error(readString(error?.message) ?? 'Codex turn failed'));
        } else {
          resolveTurn();
        }
        return;
      }
      if (message.method === 'error') {
        const error = asRecord(params.error);
        if (params.willRetry !== true) {
          rejectTurn(new Error(readString(error?.message) ?? 'Codex App Server reported an error'));
        }
      }
    };

    const handleServerRequest = (message: JsonRpcMessage): void => {
      if (message.id === undefined) return;
      const requestType = message.method === 'item/commandExecution/requestApproval'
        ? 'command'
        : message.method === 'item/fileChange/requestApproval'
          ? 'file'
          : null;
      if (!requestType) {
        run.client.respondError(message.id, -32601, `Unsupported Codex server request: ${message.method}`);
        rejectTurn(new Error(`Codex App Server is incompatible: unsupported server request ${message.method}.`));
        return;
      }

      const params = message.params ?? {};
      const runtimeApprovalId = buildRuntimeApprovalId(message);
      const resolvedDecision = run.resolvedApprovals.get(runtimeApprovalId);
      if (resolvedDecision) {
        run.client.respond(message.id, { decision: resolvedDecision });
        return;
      }
      const existingApproval = pendingApprovals.get(runtimeApprovalId);
      if (existingApproval) {
        existingApproval.rpcIds.add(message.id);
        return;
      }
      const sessionId = run.threadId ?? runtimeSessionKey ?? readString(params.threadId) ?? 'codex';
      const toolName = requestType === 'command' ? 'Bash' : 'Write';
      const itemId = readString(params.itemId);
      const changes = itemId ? fileChangesByItemId.get(itemId) ?? [] : [];
      const input = requestType === 'command'
        ? {
            command: readString(params.command) ?? '',
            cwd: readString(params.cwd),
            reason: readString(params.reason),
            commandActions: params.commandActions ?? [],
          }
        : {
            file_path: firstChangedPath(changes) ?? readString(params.grantRoot),
            reason: readString(params.reason),
            itemId,
            changes,
          };
      const timeout = setTimeout(() => {
        const approval = pendingApprovals.get(runtimeApprovalId);
        if (!approval) return;
        pendingApprovals.delete(runtimeApprovalId);
        run.resolvedApprovals.set(runtimeApprovalId, 'cancel');
        for (const rpcId of approval.rpcIds) {
          approval.client.respond(rpcId, { decision: 'cancel' });
        }
        send(createNormalizedMessage({
          kind: 'permission_cancelled', requestId: runtimeApprovalId,
          reason: 'timeout', sessionId, provider: 'codex',
        }));
      }, runtimeConfig.approvalTimeoutMs);
      pendingApprovals.set(runtimeApprovalId, {
        client: run.client,
        rpcIds: new Set([message.id]),
        runtimeApprovalId,
        sessionId,
        requestType,
        request: params,
        timeout,
      });
      send(createNormalizedMessage({
        kind: 'permission_request', requestId: runtimeApprovalId,
        toolName, input, sessionId, provider: 'codex',
      }));
    };

    const client = new CodexAppServerClient(
      spawnAppServer,
      handleNotification,
      handleServerRequest,
      rejectTurn,
      runtimeConfig.requestTimeoutMs,
    );
    run = {
      client,
      runtimeSessionKey,
      threadId: null,
      turnId: null,
      status: 'running',
      startedAt: new Date().toISOString(),
      resolvedApprovals: new Map(),
    };
    registerRun(run, runtimeSessionKey);

    try {
      await client.initialize();
      const threadResult = asRecord(await client.request('thread/start', {
        cwd: workingDirectory,
        model: resolvedModel ?? null,
        approvalPolicy: 'untrusted',
        sandbox: 'read-only',
        ephemeral: false,
      })) as ThreadStartResult | null;
      const threadId = readString(threadResult?.thread?.id);
      if (!threadId) throw new Error('Codex App Server did not return a thread id');
      const sandbox = asRecord(threadResult?.sandbox);
      if (threadResult?.approvalPolicy === 'never' || sandbox?.type !== 'readOnly') {
        throw new Error('Codex App Server is incompatible: controlled-write safety policy was not applied.');
      }
      run.threadId = threadId;
      registerRun(run, threadId);
      writer.setSessionId?.(threadId);

      const turnResult = asRecord(await client.request('turn/start', {
        threadId,
        input: [{ type: 'text', text: command, text_elements: [] }],
      })) as TurnStartResult | null;
      const turnId = readString(turnResult?.turn?.id);
      if (!turnId) throw new Error('Codex App Server did not return a turn id');
      run.turnId = turnId;
      await turnFinished;
      if (run.status !== 'aborted') {
        run.status = 'completed';
        send(createCompleteMessage({ provider: 'codex', sessionId: threadId, exitCode: 0 }));
      }
    } catch (error) {
      if (run.status !== 'aborted') {
        send(createNormalizedMessage({
          kind: 'error', content: readErrorMessage(error),
          sessionId: run.threadId ?? runtimeSessionKey, provider: 'codex',
        }));
        send(createCompleteMessage({
          provider: 'codex', sessionId: run.threadId ?? runtimeSessionKey, exitCode: 1,
        }));
        throw error;
      }
    } finally {
      removeRun(run);
      client.close();
    }
  };

  return {
    run: runControlled,
    async abort(sessionId: string): Promise<boolean> {
      const run = activeRuns.get(sessionId);
      if (!run || run.status !== 'running') return false;
      run.status = 'aborted';
      if (run.threadId && run.turnId) {
        try {
          await run.client.request('turn/interrupt', {
            threadId: run.threadId,
            turnId: run.turnId,
          });
        } catch {
          // Process teardown below remains the cancellation fallback.
        }
      }
      run.client.close();
      removeRun(run);
      return true;
    },
    permissions: {
      resolve(requestId: string, decision: ProviderPermissionDecision): void {
        const approval = pendingApprovals.get(requestId);
        if (!approval) return;
        pendingApprovals.delete(requestId);
        clearTimeout(approval.timeout);
        const resolvedDecision = decision.allow ? 'accept' : 'decline';
        const run = [...activeRuns.values()].find((candidate) => candidate.client === approval.client);
        run?.resolvedApprovals.set(requestId, resolvedDecision);
        for (const rpcId of approval.rpcIds) {
          approval.client.respond(rpcId, { decision: resolvedDecision });
        }
      },
      listPending(sessionId: string): unknown[] {
        return [...pendingApprovals.values()]
          .filter((approval) => approval.sessionId === sessionId)
          .map((approval) => ({
            requestId: approval.runtimeApprovalId,
            requestType: approval.requestType,
            request: approval.request,
          }));
      },
    },
  };
}

/**
 * Creates the Codex runtime used by CodexProvider. Agent Task controlled-write
 * runs use App Server; existing chat and read-only task runs retain the SDK path.
 * Tests inject a fake App Server process through `spawnAppServer`.
 */
export function createCodexControlledRuntime(
  spawnAppServer: SpawnAppServer = defaultSpawnAppServer,
  optionOverrides: Partial<CodexControlledRuntimeOptions> = {},
): IProviderRuntime {
  const positiveTimeout = (value: number | undefined, fallback: number): number => (
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
  );
  const runtimeConfig: CodexControlledRuntimeOptions = {
    requestTimeoutMs: positiveTimeout(optionOverrides.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS),
    approvalTimeoutMs: positiveTimeout(optionOverrides.approvalTimeoutMs, DEFAULT_APPROVAL_TIMEOUT_MS),
  };
  const appServerRuntime = createAppServerRuntime(spawnAppServer, runtimeConfig);
  return {
    run(command, options, writer, context) {
      return options.controlledWrite === true
        ? appServerRuntime.run(command, options, writer, context)
        : queryCodex(command, options, writer, context);
    },
    async abort(sessionId: string): Promise<boolean> {
      if (await appServerRuntime.abort(sessionId)) return true;
      return abortCodexSession(sessionId);
    },
    permissions: appServerRuntime.permissions,
  };
}

/** CodexProvider consumes this singleton as its live runtime facet. */
export const codexControlledRuntime = createCodexControlledRuntime();
