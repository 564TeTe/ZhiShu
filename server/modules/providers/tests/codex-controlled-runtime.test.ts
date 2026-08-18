import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

import {
  createCodexControlledRuntime,
} from '@/modules/providers/list/codex/codex-controlled-runtime.provider.js';
import type { ProviderRuntimeWriter } from '@/shared/types.js';

class FakeAppServer extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;
  approvalResponses: Array<Record<string, unknown>> = [];
  private nextServerRequestId = 100;

  constructor() {
    super();
    let buffer = '';
    this.stdin.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      while (buffer.includes('\n')) {
        const newline = buffer.indexOf('\n');
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.trim()) this.handle(JSON.parse(line) as Record<string, unknown>);
      }
    });
  }

  kill(): boolean {
    this.killed = true;
    this.emit('exit', 0, null);
    return true;
  }

  protected send(message: Record<string, unknown>): void {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }

  protected handle(message: Record<string, unknown>): void {
    const id = message.id as string | number | undefined;
    if (message.method === 'initialize' && id !== undefined) {
      this.send({ id, result: { userAgent: 'fake', codexHome: 'C:\\fake', platformFamily: 'windows', platformOs: 'windows' } });
      return;
    }
    if (message.method === 'initialized') return;
    if (message.method === 'thread/start' && id !== undefined) {
      const params = message.params as Record<string, unknown>;
      assert.equal(params.approvalPolicy, 'untrusted');
      assert.equal(params.sandbox, 'read-only');
      assert.equal(params.model, 'gpt-5.6-sol');
      this.send({
        id,
        result: {
          thread: { id: 'thread-fake-1' },
          approvalPolicy: 'untrusted',
          sandbox: { type: 'readOnly', networkAccess: false },
        },
      });
      return;
    }
    if (message.method === 'turn/start' && id !== undefined) {
      this.send({ id, result: { turn: { id: 'turn-fake-1' } } });
      setImmediate(() => this.send({
        method: 'item/commandExecution/requestApproval',
        id: this.nextServerRequestId++,
        params: {
          threadId: 'thread-fake-1',
          turnId: 'turn-fake-1',
          itemId: 'item-fake-1',
          approvalId: 'approval-fake-1',
          command: 'npm test',
          cwd: 'C:\\workspace',
        },
      }));
      setImmediate(() => this.send({
        method: 'item/commandExecution/requestApproval',
        id: this.nextServerRequestId++,
        params: {
          threadId: 'thread-fake-1',
          turnId: 'turn-fake-1',
          itemId: 'item-fake-1',
          approvalId: 'approval-fake-1',
          command: 'npm test',
          cwd: 'C:\\workspace',
        },
      }));
      return;
    }
    if ((message.id === 100 || message.id === 101) && message.result && typeof message.result === 'object') {
      this.approvalResponses.push(message.result as Record<string, unknown>);
      assert.equal((message.result as Record<string, unknown>).decision, 'accept');
      if (this.approvalResponses.length !== 2) return;
      setImmediate(() => this.send({
        method: 'turn/completed',
        params: { threadId: 'thread-fake-1', turn: { status: 'completed', error: null } },
      }));
    }
  }
}

class SilentAppServer extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;

  kill(): boolean {
    this.killed = true;
    this.emit('exit', 0, null);
    return true;
  }
}

class ExitingAppServer extends FakeAppServer {
  protected override handle(message: Record<string, unknown>): void {
    if (message.method === 'turn/start' && message.id !== undefined) {
      this.send({ id: message.id, result: { turn: { id: 'turn-fake-1' } } });
      setImmediate(() => this.emit('exit', 7, null));
      return;
    }
    super.handle(message);
  }
}

class IncompatibleInitializeAppServer extends FakeAppServer {
  protected override handle(message: Record<string, unknown>): void {
    if (message.method === 'initialize' && message.id !== undefined) {
      this.send({ id: message.id, result: { userAgent: 'old-codex' } });
      return;
    }
    super.handle(message);
  }
}

class UnsafePolicyAppServer extends FakeAppServer {
  protected override handle(message: Record<string, unknown>): void {
    if (message.method === 'thread/start' && message.id !== undefined) {
      this.send({
        id: message.id,
        result: {
          thread: { id: 'thread-unsafe-1' },
          approvalPolicy: 'never',
          sandbox: { type: 'workspaceWrite', writableRoots: [] },
        },
      });
      return;
    }
    super.handle(message);
  }
}

class FileApprovalAppServer extends FakeAppServer {
  readonly decisions: string[] = [];

  protected override handle(message: Record<string, unknown>): void {
    if (message.method === 'turn/start' && message.id !== undefined) {
      this.send({ id: message.id, result: { turn: { id: 'turn-file-1' } } });
      setImmediate(() => {
        this.send({
          method: 'item/started',
          params: {
            threadId: 'thread-fake-1',
            turnId: 'turn-file-1',
            item: {
              type: 'fileChange',
              id: 'file-item-1',
              status: 'inProgress',
              changes: [{ path: 'src/app.ts', kind: 'update', diff: '@@ -1 +1 @@\n-old\n+new' }],
            },
          },
        });
        this.send({
          method: 'item/fileChange/requestApproval',
          id: 200,
          params: {
            threadId: 'thread-fake-1', turnId: 'turn-file-1', itemId: 'file-item-1',
          },
        });
      });
      return;
    }
    if (message.id === 200 && message.result && typeof message.result === 'object') {
      const decision = String((message.result as Record<string, unknown>).decision);
      this.decisions.push(decision);
      this.send({
        method: 'turn/completed',
        params: { threadId: 'thread-fake-1', turn: { status: 'completed', error: null } },
      });
      return;
    }
    super.handle(message);
  }
}

const createContext = () => ({
  resolveProviderSessionId: () => null,
  resolveResumeModel: async () => 'gpt-5.6-luna',
  getProviderModels: async () => ({
    OPTIONS: [{ value: 'gpt-5.6-sol', label: 'GPT-5.6-Sol' }],
    DEFAULT: 'gpt-5.6-sol',
  }),
  normalizeMessage: () => [],
  isProviderInstalled: async () => true,
});

const createWriter = (messages: Record<string, unknown>[]): ProviderRuntimeWriter => ({
  isWebSocketWriter: true,
  send(data) { if (data && typeof data === 'object') messages.push(data as Record<string, unknown>); },
  setSessionId(sessionId) { messages.push({ kind: 'session_id', sessionId }); },
});

test('Codex controlled-write runtime pauses for approval and resumes the turn', async () => {
  const fake = new FakeAppServer();
  const runtime = createCodexControlledRuntime(() => fake as unknown as ChildProcessWithoutNullStreams);
  const messages: Record<string, unknown>[] = [];
  const writer = createWriter(messages);
  const runPromise = runtime.run('run tests and fix failures', {
    cwd: 'C:\\workspace',
    runtimeSessionKey: 'run-fake',
    controlledWrite: true,
  }, writer, createContext());

  let approval: Record<string, unknown> | undefined;
  for (let attempt = 0; attempt < 50 && !approval; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    approval = messages.find((message) => message.kind === 'permission_request');
  }
  assert.ok(approval);
  assert.equal(approval.toolName, 'Bash');
  assert.equal(typeof approval.requestId, 'string');
  runtime.permissions?.resolve(String(approval.requestId), { allow: true });
  runtime.permissions?.resolve(String(approval.requestId), { allow: true });

  await runPromise;
  assert.ok(messages.some((message) => message.kind === 'complete'));
  assert.equal(messages.filter((message) => message.kind === 'permission_request').length, 1);
  assert.equal(fake.approvalResponses.length, 2);
  assert.equal(fake.killed, true);
});

test('Codex approval includes file paths, change kinds, and unified diffs', async () => {
  const fake = new FileApprovalAppServer();
  const runtime = createCodexControlledRuntime(
    () => fake as unknown as ChildProcessWithoutNullStreams,
    { approvalTimeoutMs: 1_000 },
  );
  const messages: Record<string, unknown>[] = [];
  const runPromise = runtime.run('change one file', {
    cwd: 'C:\\workspace', runtimeSessionKey: 'run-file', controlledWrite: true,
  }, createWriter(messages), createContext());

  let approval: Record<string, unknown> | undefined;
  for (let attempt = 0; attempt < 50 && !approval; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    approval = messages.find((message) => message.kind === 'permission_request');
  }
  assert.ok(approval);
  const input = approval.input as Record<string, unknown>;
  assert.equal(input.file_path, 'src/app.ts');
  assert.deepEqual(input.changes, [
    { path: 'src/app.ts', kind: 'update', diff: '@@ -1 +1 @@\n-old\n+new' },
  ]);
  runtime.permissions?.resolve(String(approval.requestId), { allow: false });
  await runPromise;
  assert.deepEqual(fake.decisions, ['decline']);
});

test('Codex approval timeout cancels the native request and emits expiration', async () => {
  const fake = new FileApprovalAppServer();
  const runtime = createCodexControlledRuntime(
    () => fake as unknown as ChildProcessWithoutNullStreams,
    { approvalTimeoutMs: 15 },
  );
  const messages: Record<string, unknown>[] = [];
  await runtime.run('change one file', {
    cwd: 'C:\\workspace', runtimeSessionKey: 'run-timeout', controlledWrite: true,
  }, createWriter(messages), createContext());

  assert.deepEqual(fake.decisions, ['cancel']);
  assert.ok(messages.some((message) => message.kind === 'permission_cancelled'));
});

test('Codex JSON-RPC requests time out and terminate the App Server process', async () => {
  const fake = new SilentAppServer();
  const runtime = createCodexControlledRuntime(
    () => fake as unknown as ChildProcessWithoutNullStreams,
    { requestTimeoutMs: 15 },
  );
  const messages: Record<string, unknown>[] = [];

  await assert.rejects(
    runtime.run('read only', {
      cwd: 'C:\\workspace', runtimeSessionKey: 'run-request-timeout', controlledWrite: true,
    }, createWriter(messages), createContext()),
    /request timed out: initialize/,
  );
  assert.equal(fake.killed, true);
  assert.ok(messages.some((message) => message.kind === 'error'));
});

test('Codex App Server abnormal exit fails the run without hanging', async () => {
  const fake = new ExitingAppServer();
  const runtime = createCodexControlledRuntime(
    () => fake as unknown as ChildProcessWithoutNullStreams,
    { requestTimeoutMs: 1_000 },
  );
  const messages: Record<string, unknown>[] = [];

  await assert.rejects(
    runtime.run('read only', {
      cwd: 'C:\\workspace', runtimeSessionKey: 'run-exit', controlledWrite: true,
    }, createWriter(messages), createContext()),
    /exited \(7\)/,
  );
  assert.ok(messages.some((message) => message.kind === 'error'));
});

test('Codex App Server initialize response is validated for compatibility', async () => {
  const fake = new IncompatibleInitializeAppServer();
  const runtime = createCodexControlledRuntime(
    () => fake as unknown as ChildProcessWithoutNullStreams,
    { requestTimeoutMs: 1_000 },
  );

  await assert.rejects(
    runtime.run('read only', {
      cwd: 'C:\\workspace', runtimeSessionKey: 'run-incompatible', controlledWrite: true,
    }, createWriter([]), createContext()),
    /initialize returned an unsupported response/,
  );
});

test('Codex controlled write fails closed when App Server ignores the safety policy', async () => {
  const fake = new UnsafePolicyAppServer();
  const runtime = createCodexControlledRuntime(
    () => fake as unknown as ChildProcessWithoutNullStreams,
    { requestTimeoutMs: 1_000 },
  );

  await assert.rejects(
    runtime.run('write a file', {
      cwd: 'C:\\workspace', runtimeSessionKey: 'run-unsafe-policy', controlledWrite: true,
    }, createWriter([]), createContext()),
    /controlled-write safety policy was not applied/,
  );
});
