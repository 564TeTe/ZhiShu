import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  ProviderPermissionDecision,
  RuntimeEvent,
  RuntimeStartCommand,
} from '@/shared/types.js';

import { createRuntimeService } from '../runtime.service.js';

function policy(requireApprovalFor: RuntimeStartCommand['capabilities']) {
  return {
    requireApprovalFor,
    mode: 'MANUAL' as const,
    projectRoot: 'D:\\workspace\\demo',
    allowedDirectories: ['.'],
    trustedCommands: [],
    approvalTimeoutSeconds: 45,
  };
}

function createCommand(overrides: Partial<RuntimeStartCommand> = {}): RuntimeStartCommand {
  return {
    protocolVersion: '1.0',
    requestId: 'request-1',
    idempotencyKey: 'attempt-1:start',
    taskId: 'task-1',
    attemptId: 'attempt-1',
    projectRef: 'D:\\workspace\\demo',
    executor: 'claude',
    objective: '修复除零错误并运行测试',
    capabilities: ['READ_FILE', 'WRITE_FILE', 'SEARCH_CODE', 'TEST'],
    permissionPolicy: policy(['WRITE_FILE']),
    ...overrides,
  };
}

function createDedupRepository() {
  const records = new Map<string, { hash: string; response: Record<string, unknown> }>();
  return {
    updateResponse(idempotencyKey: string, response: Record<string, unknown>) {
      const existing = records.get(idempotencyKey);
      if (existing) records.set(idempotencyKey, { ...existing, response });
    },
    inspect(input: {
      idempotencyKey: string;
      requestHash: string;
    }) {
      const existing = records.get(input.idempotencyKey);
      if (!existing) return { outcome: 'missing' as const, response: null };
      if (existing.hash !== input.requestHash) {
        return { outcome: 'conflict' as const, response: existing.response };
      }
      return { outcome: 'replay' as const, response: existing.response };
    },
    accept(input: {
      idempotencyKey: string;
      requestHash: string;
      response: Record<string, unknown>;
    }) {
      const existing = records.get(input.idempotencyKey);
      if (!existing) {
        records.set(input.idempotencyKey, { hash: input.requestHash, response: input.response });
        return { outcome: 'created' as const, response: input.response };
      }
      if (existing.hash !== input.requestHash) {
        return { outcome: 'conflict' as const, response: existing.response };
      }
      return { outcome: 'replay' as const, response: existing.response };
    },
  };
}

async function waitFor(
  predicate: () => boolean,
  message: string,
  timeoutMs = 1000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(message);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('start dispatches one provider run and emits ordered lifecycle events', async () => {
  const events: RuntimeEvent[] = [];
  const prompts: string[] = [];
  const runOptions: Record<string, unknown>[] = [];
  let id = 0;
  const service = createRuntimeService({
    providerRuntime: {
      hasRuntime: () => true,
      async run(_provider, prompt, options, writer) {
        prompts.push(prompt);
        runOptions.push(options);
        writer.send({ kind: 'status', text: 'reading project' });
        writer.send({ kind: 'complete', exitCode: 0 });
      },
      async abort() { return true; },
      resolveToolApproval() {},
    },
    commandDedup: createDedupRepository(),
    eventReporter: { async report(batch) { events.push(...batch); } },
    workspaceExists: async () => true,
    createId: () => String(++id),
    now: () => new Date('2026-08-11T00:00:00.000Z'),
  });

  const accepted = await service.start(createCommand());
  await waitFor(
    () => service.getRun(accepted.runtimeRunId)?.status === 'succeeded',
    'runtime run did not complete',
  );

  assert.equal(prompts.length, 1);
  assert.equal(runOptions[0]?.runtimeSessionKey, accepted.runtimeRunId);
  assert.equal(runOptions[0]?.sessionId, undefined);
  assert.equal(runOptions[0]?.settingSources, undefined);
  assert.deepEqual(runOptions[0]?.toolsSettings, {
    allowedTools: ['Read', 'Glob', 'Grep', 'Bash'],
    disallowedTools: [],
    skipPermissions: false,
  });
  assert.deepEqual(runOptions[0]?.settings, {
    permissions: { ask: ['Edit', 'Write', 'NotebookEdit'] },
  });
  assert.match(prompts[0], /修复除零错误并运行测试/);
  assert.deepEqual(events.map((event) => event.type), [
    'RUN_STARTED',
    'AGENT_STATUS',
    'ARTIFACT_PUBLISHED',
    'RUN_COMPLETED',
  ]);
  assert.deepEqual(events.map((event) => event.sequenceNo), [1, 2, 3, 4]);
});

test('emits heartbeats only while a Runtime run is live', async () => {
  const events: RuntimeEvent[] = [];
  const controls: { heartbeat?: () => void; finishProvider?: () => void } = {};
  let cleared = false;
  let id = 0;
  const providerDone = new Promise<void>((resolve) => { controls.finishProvider = resolve; });
  const service = createRuntimeService({
    providerRuntime: {
      hasRuntime: () => true,
      async run() { await providerDone; },
      async abort() { return true; },
      resolveToolApproval() {},
    },
    commandDedup: createDedupRepository(),
    eventReporter: { async report(batch) { events.push(...batch); } },
    workspaceExists: async () => true,
    createId: () => String(++id),
    now: () => new Date('2026-08-15T00:00:00.000Z'),
    heartbeatIntervalMs: 10_000,
    setHeartbeatTimer(callback) {
      controls.heartbeat = callback;
      return 1 as unknown as ReturnType<typeof setInterval>;
    },
    clearHeartbeatTimer() { cleared = true; },
    runtimeInstanceId: 'runtime-instance-test',
  });

  const accepted = await service.start(createCommand());
  await waitFor(() => controls.heartbeat !== undefined, 'heartbeat timer was not started');
  if (!controls.heartbeat) throw new Error('heartbeat timer was not captured');
  controls.heartbeat();
  await waitFor(
    () => events.some((event) => event.type === 'RUNTIME_HEARTBEAT'),
    'heartbeat event was not reported',
  );
  const heartbeatEvent = events.find((event) => event.type === 'RUNTIME_HEARTBEAT');
  assert.deepEqual(heartbeatEvent?.payload, {
    runtimeInstanceId: 'runtime-instance-test',
    runStatus: 'running',
  });

  controls.finishProvider?.();
  await waitFor(
    () => service.getRun(accepted.runtimeRunId)?.status === 'succeeded',
    'runtime run did not complete',
  );
  assert.equal(cleared, true);
  const countAfterFinish = events.filter((event) => event.type === 'RUNTIME_HEARTBEAT').length;
  controls.heartbeat();
  assert.equal(events.filter((event) => event.type === 'RUNTIME_HEARTBEAT').length, countAfterFinish);
});

test('follow-up Attempt prompt contains structured parent outcome and user correction', async () => {
  let receivedPrompt = '';
  let id = 0;
  const service = createRuntimeService({
    providerRuntime: {
      hasRuntime: () => true,
      async run(_provider, prompt, _options, writer) {
        receivedPrompt = prompt;
        writer.send({ kind: 'complete', exitCode: 0 });
      },
      async abort() { return true; },
      resolveToolApproval() {},
    },
    commandDedup: createDedupRepository(),
    eventReporter: { async report() {} },
    workspaceExists: async () => true,
    createId: () => String(++id),
  });

  const accepted = await service.start(createCommand({
    attemptId: 'attempt-2',
    idempotencyKey: 'attempt-2:start',
    context: {
      taskFollowUpContext: {
        contextType: 'TASK_FOLLOW_UP_V1',
        followUpId: 'follow-up-1',
        parentAttemptId: 'attempt-1',
        originalObjective: '修复手机号登录失败',
        previousAttempt: {
          attemptId: 'attempt-1',
          attemptNumber: 1,
          status: 'SUCCEEDED',
          evidence: [
            { type: 'SUMMARY', content: 'Attempt 1 修改了普通密码登录流程。' },
            { type: 'FILE_CHANGE', content: '修改 src/auth/login.ts', metadata: { path: 'src/auth/login.ts' } },
            { type: 'TEST_REPORT', content: 'npm test：12 passed' },
          ],
        },
        attemptHistory: [
          {
            attemptId: 'attempt-1',
            attemptNumber: 1,
            status: 'SUCCEEDED',
            executor: 'claude',
            evidence: [
              { type: 'SUMMARY', content: 'Attempt 1 修改了普通密码登录流程。' },
            ],
          },
          {
            attemptId: 'attempt-2',
            attemptNumber: 2,
            status: 'FAILED',
            executor: 'claude',
            failureReason: '验证码接口仍返回 403',
            userFeedback: '请继续处理 403',
            evidence: [
              { type: 'TEST_REPORT', content: 'npm test：1 failed' },
            ],
          },
        ],
        historyTruncated: false,
        userFeedback: '手机号验证码登录仍然失败。',
        requestedAcceptance: '手机号和密码登录都通过回归测试。',
        additionalContext: { failingCase: 'SMS-403' },
      },
    },
  }));
  await waitFor(() => service.getRun(accepted.runtimeRunId)?.status === 'succeeded', 'follow-up run did not finish');

  assert.match(receivedPrompt, /【任务跟进上下文】/);
  assert.match(receivedPrompt, /父 Attempt：#1（SUCCEEDED，attempt-1）/);
  assert.match(receivedPrompt, /【上一次执行总结】\nAttempt 1 修改了普通密码登录流程。/);
  assert.match(receivedPrompt, /【上一次修改文件】\n修改 src\/auth\/login.ts/);
  assert.match(receivedPrompt, /【上一次测试结果】\nnpm test：12 passed/);
  assert.match(receivedPrompt, /【累计执行历史】/);
  assert.match(receivedPrompt, /第 2 次执行（FAILED，attempt-2）/);
  assert.match(receivedPrompt, /失败原因：验证码接口仍返回 403/);
  assert.match(receivedPrompt, /【用户本次反馈】\n\n手机号验证码登录仍然失败。/);
  assert.match(receivedPrompt, /【新的验收要求】\n\n手机号和密码登录都通过回归测试。/);
  assert.match(receivedPrompt, /"failingCase": "SMS-403"/);
});

test('versioned Work Order context reaches the provider prompt without granting verification authority', async () => {
  let receivedPrompt = '';
  let id = 0;
  const service = createRuntimeService({
    providerRuntime: {
      hasRuntime: () => true,
      async run(_provider, prompt, _options, writer) {
        receivedPrompt = prompt;
        writer.send({ kind: 'complete', exitCode: 0 });
      },
      async abort() { return true; },
      resolveToolApproval() {},
    },
    commandDedup: createDedupRepository(),
    eventReporter: { async report() {} },
    workspaceExists: async () => true,
    createId: () => String(++id),
  });
  const accepted = await service.start(createCommand({
    context: {
      workOrderContext: {
        schemaVersion: '1.0', workOrderId: 'work-order-1', planId: 'plan-1',
        planVersionId: 'plan-version-3', planVersion: 3, nodeKey: 'verify',
        objective: 'Run the bounded verification suite',
        acceptanceCriteria: ['Gateway and Runtime tests pass', 'Evidence remains traceable'],
        requiredCapabilities: ['READ_FILE', 'TEST'],
        contextVersion: {
          workOrderContextVersion: '1.0', planVersionId: 'plan-version-3', planVersion: 3,
          stateRevision: 8, executionWatermark: 22, capturedAt: '2026-08-15T00:00:00.000Z',
        },
      },
    },
  }));
  await waitFor(() => service.getRun(accepted.runtimeRunId)?.status === 'succeeded', 'work order run did not finish');

  assert.match(receivedPrompt, /【Work Order 执行上下文】/);
  assert.match(receivedPrompt, /Work Order：work-order-1/);
  assert.match(receivedPrompt, /Gateway and Runtime tests pass/);
  assert.match(receivedPrompt, /不得把执行结果直接当作验收结论/);
  assert.match(receivedPrompt, /State Revision 8 \/ Execution Watermark 22/);
});

test('preserves current follow-up requirements when accumulated history exceeds the prompt budget', async () => {
  let receivedPrompt = '';
  let id = 0;
  const service = createRuntimeService({
    providerRuntime: {
      hasRuntime: () => true,
      async run(_provider, prompt, _options, writer) {
        receivedPrompt = prompt;
        writer.send({ kind: 'complete', exitCode: 0 });
      },
      async abort() { return true; },
      resolveToolApproval() {},
    },
    commandDedup: createDedupRepository(),
    eventReporter: { async report() {} },
    workspaceExists: async () => true,
    createId: () => String(++id),
  });

  const history = Array.from({ length: 12 }, (_, index) => ({
    attemptId: `attempt-${index + 1}`,
    attemptNumber: index + 1,
    status: index === 11 ? 'FAILED' : 'SUCCEEDED',
    evidence: [{ type: 'SUMMARY' as const, content: 'old evidence '.repeat(8_000) }],
  }));
  const accepted = await service.start(createCommand({
    attemptId: 'attempt-follow-up',
    idempotencyKey: 'attempt-follow-up:start',
    context: {
      taskFollowUpContext: {
        contextType: 'TASK_FOLLOW_UP_V1',
        followUpId: 'follow-up-large-history',
        parentAttemptId: 'attempt-12',
        originalObjective: 'retain context',
        previousAttempt: {
          attemptId: 'attempt-12',
          attemptNumber: 12,
          status: 'FAILED',
          evidence: [{ type: 'SUMMARY', content: 'parent evidence' }],
        },
        attemptHistory: history,
        historyTruncated: false,
        userFeedback: 'CURRENT_FEEDBACK_MUST_SURVIVE',
        requestedAcceptance: 'CURRENT_ACCEPTANCE_MUST_SURVIVE',
      },
    },
  }));
  await waitFor(() => service.getRun(accepted.runtimeRunId)?.status === 'succeeded', 'large follow-up run did not finish');

  assert.match(receivedPrompt, /CURRENT_FEEDBACK_MUST_SURVIVE/);
  assert.match(receivedPrompt, /CURRENT_ACCEPTANCE_MUST_SURVIVE/);
  assert.match(receivedPrompt, /累计执行历史已压缩/);
});

test('publishes summary, file change, git diff, test, and error artifacts from provider messages', async () => {
  const events: RuntimeEvent[] = [];
  let id = 0;
  const service = createRuntimeService({
    providerRuntime: {
      hasRuntime: () => true,
      async run(_provider, _prompt, _options, writer) {
        writer.send({
          kind: 'tool_use', toolId: 'edit-1', toolName: 'Edit',
          toolInput: { file_path: 'src/calculator.ts' },
        });
        writer.send({ kind: 'tool_result', toolId: 'edit-1', content: 'updated', isError: false });
        writer.send({
          kind: 'tool_use', toolId: 'diff-1', toolName: 'Bash',
          toolInput: { command: 'git diff -- src/calculator.ts' },
        });
        writer.send({ kind: 'tool_result', toolId: 'diff-1', content: 'diff --git a/src/calculator.ts', isError: false });
        writer.send({
          kind: 'tool_use', toolId: 'test-1', toolName: 'Bash',
          toolInput: { command: 'npm test -- calculator' },
        });
        writer.send({ kind: 'tool_result', toolId: 'test-1', content: '1 test passed', isError: false });
        writer.send({
          kind: 'tool_use', toolId: 'failed-1', toolName: 'Bash',
          toolInput: { command: 'npm test -- broken' },
        });
        writer.send({ kind: 'tool_result', toolId: 'failed-1', content: '1 test failed', isError: true });
        writer.send({ kind: 'text', role: 'assistant', content: '修复完成，相关测试已执行。' });
        writer.send({ kind: 'complete', exitCode: 0 });
      },
      async abort() { return true; },
      resolveToolApproval() {},
    },
    commandDedup: createDedupRepository(),
    eventReporter: { async report(batch) { events.push(...batch); } },
    workspaceExists: async () => true,
    createId: () => String(++id),
    now: () => new Date('2026-08-11T00:00:00.000Z'),
  });

  const accepted = await service.start(createCommand());
  await waitFor(
    () => service.getRun(accepted.runtimeRunId)?.status === 'succeeded',
    'artifact-producing run did not complete',
  );

  const artifacts = events.filter((event) => event.type === 'ARTIFACT_PUBLISHED');
  assert.deepEqual(
    artifacts.map((event) => event.payload.artifactType),
    ['FILE_CHANGE', 'GIT_DIFF', 'TEST_REPORT', 'TEST_REPORT', 'ERROR_REPORT', 'SUMMARY'],
  );
  assert.equal(artifacts.at(-1)?.payload.contentPlain, '修复完成，相关测试已执行。');
  assert.equal(artifacts[0]?.payload.producer, 'NODE_RUNTIME');
  assert.equal(typeof artifacts[0]?.payload.hash, 'string');
});

test('matching Start retries replay the first response without launching twice', async () => {
  let runCount = 0;
  let id = 0;
  const service = createRuntimeService({
    providerRuntime: {
      hasRuntime: () => true,
      async run(_provider, _prompt, _options, writer) {
        runCount += 1;
        writer.send({ kind: 'complete', exitCode: 0 });
      },
      async abort() { return true; },
      resolveToolApproval() {},
    },
    commandDedup: createDedupRepository(),
    eventReporter: { async report() {} },
    workspaceExists: async () => true,
    createId: () => String(++id),
  });

  const first = await service.start(createCommand());
  const replay = await service.start(createCommand({ requestId: 'request-retry' }));
  await waitFor(() => service.getRun(first.runtimeRunId)?.status === 'succeeded', 'run did not finish');

  assert.deepEqual(replay, first);
  assert.equal(runCount, 1);
});

test('reusing a Start idempotency key for another objective is rejected', async () => {
  let id = 0;
  const service = createRuntimeService({
    providerRuntime: {
      hasRuntime: () => true,
      async run(_provider, _prompt, _options, writer) {
        writer.send({ kind: 'complete', exitCode: 0 });
      },
      async abort() { return true; },
      resolveToolApproval() {},
    },
    commandDedup: createDedupRepository(),
    eventReporter: { async report() {} },
    workspaceExists: async () => true,
    createId: () => String(++id),
  });

  await service.start(createCommand());
  await assert.rejects(
    service.start(createCommand({ objective: '另一个任务' })),
    (error: unknown) => Boolean(
      error && typeof error === 'object' && 'code' in error && error.code === 'IDEMPOTENCY_CONFLICT'
    ),
  );
});

test('approval decisions resolve the provider hook and resume the run', async () => {
  const events: RuntimeEvent[] = [];
  let approvalDecision: ProviderPermissionDecision | null = null;
  let finishProviderRun: (() => void) | null = null;
  let id = 0;
  const service = createRuntimeService({
    providerRuntime: {
      hasRuntime: () => true,
      run(_provider, _prompt, _options, runtimeWriter) {
        runtimeWriter.send({
          kind: 'permission_request',
          requestId: 'approval-1',
          toolName: 'Write',
          input: { file_path: 'Calculator.java' },
        });
        return new Promise<void>((resolve) => { finishProviderRun = resolve; });
      },
      async abort() { return true; },
      resolveToolApproval(_requestId, decision) {
        approvalDecision = decision;
        finishProviderRun?.();
      },
    },
    commandDedup: createDedupRepository(),
    eventReporter: { async report(batch) { events.push(...batch); } },
    workspaceExists: async () => true,
    createId: () => String(++id),
  });

  const accepted = await service.start(createCommand());
  await waitFor(
    () => service.getRun(accepted.runtimeRunId)?.status === 'waiting_approval',
    'approval was not registered',
  );
  await service.decideApproval(accepted.runtimeRunId, 'approval-1', {
    protocolVersion: '1.0',
    requestId: 'decision-request-1',
    idempotencyKey: 'approval-1:decision',
    decision: 'APPROVED',
  });
  await waitFor(
    () => service.getRun(accepted.runtimeRunId)?.status === 'succeeded',
    'approved run did not finish',
  );

  assert.deepEqual(approvalDecision, { allow: true, message: undefined });
  assert.ok(events.some((event) => event.type === 'APPROVAL_REQUIRED'));
  assert.ok(events.some((event) => event.type === 'APPROVAL_RESOLVED'));
});

test('matching approval retries replay without resolving the provider hook twice', async () => {
  let resolveCount = 0;
  let finishProviderRun: (() => void) | null = null;
  let id = 0;
  const service = createRuntimeService({
    providerRuntime: {
      hasRuntime: () => true,
      run(_provider, _prompt, _options, writer) {
        writer.send({ kind: 'permission_request', requestId: 'approval-1', toolName: 'Write' });
        return new Promise<void>((resolve) => { finishProviderRun = resolve; });
      },
      async abort() { return true; },
      resolveToolApproval() { resolveCount += 1; finishProviderRun?.(); },
    },
    commandDedup: createDedupRepository(),
    eventReporter: { async report() {} },
    workspaceExists: async () => true,
    createId: () => String(++id),
  });
  const accepted = await service.start(createCommand());
  await waitFor(() => service.getRun(accepted.runtimeRunId)?.status === 'waiting_approval', 'approval missing');
  const command = {
    protocolVersion: '1.0' as const,
    requestId: 'decision-1',
    idempotencyKey: 'approval-1:decision',
    decision: 'APPROVED' as const,
  };
  const first = await service.decideApproval(accepted.runtimeRunId, 'approval-1', command);
  const replay = await service.decideApproval(accepted.runtimeRunId, 'approval-1', {
    ...command,
    requestId: 'decision-retry',
  });
  assert.deepEqual(replay, first);
  assert.equal(resolveCount, 1);
});

test('Runtime downgrades an upstream auto approval when the frozen policy hard-denies it', async () => {
  let resolved: ProviderPermissionDecision | null = null;
  let finish: (() => void) | null = null;
  let id = 0;
  const events: RuntimeEvent[] = [];
  const service = createRuntimeService({
    providerRuntime: {
      hasRuntime: () => true,
      run(_provider, _prompt, _options, writer) {
        writer.send({ kind: 'permission_request', requestId: 'approval-secret', toolName: 'Read', input: { file_path: '.env' } });
        return new Promise<void>((resolve) => { finish = resolve; });
      },
      async abort() { return true; },
      resolveToolApproval(_requestId, decision) { resolved = decision; finish?.(); },
    },
    commandDedup: createDedupRepository(),
    eventReporter: { async report(batch) { events.push(...batch); } },
    workspaceExists: async () => true,
    createId: () => String(++id),
  });
  const accepted = await service.start(createCommand({
    permissionPolicy: { ...policy(['READ_FILE']), mode: 'AUTO_TRUSTED' },
  }));
  await waitFor(() => service.getRun(accepted.runtimeRunId)?.status === 'waiting_approval', 'approval missing');
  await service.decideApproval(accepted.runtimeRunId, 'approval-secret', {
    protocolVersion: '1.0', requestId: 'decision-secret', idempotencyKey: 'approval-secret:decision',
    decision: 'APPROVED', decisionSource: 'AUTO_POLICY', policy: 'AUTO_TRUSTED',
    rule: 'safe-read-search', reason: 'upstream approved',
  });
  assert.equal((resolved as ProviderPermissionDecision | null)?.allow, false);
  assert.ok(events.some(event => event.type === 'APPROVAL_RESOLVED'
    && event.payload.decision === 'DENIED'
    && event.payload.rule === 'credential-file'));
});

test('matching cancel retries abort the provider only once', async () => {
  let abortCount = 0;
  let id = 0;
  const service = createRuntimeService({
    providerRuntime: {
      hasRuntime: () => true,
      run() { return new Promise<void>(() => undefined); },
      async abort() { abortCount += 1; return true; },
      resolveToolApproval() {},
    },
    commandDedup: createDedupRepository(),
    eventReporter: { async report() {} },
    workspaceExists: async () => true,
    createId: () => String(++id),
  });
  const accepted = await service.start(createCommand());
  await waitFor(() => service.getRun(accepted.runtimeRunId)?.status === 'running', 'run did not start');
  const command = {
    protocolVersion: '1.0' as const,
    requestId: 'cancel-1',
    idempotencyKey: 'attempt-1:cancel',
  };
  const first = await service.cancel(accepted.runtimeRunId, command);
  const replay = await service.cancel(accepted.runtimeRunId, { ...command, requestId: 'cancel-retry' });
  assert.deepEqual(replay, first);
  assert.equal(abortCount, 1);
});

test('codex read-only start dispatches without Claude-only options', async () => {
  const runOptions: Record<string, unknown>[] = [];
  const dispatchedProviders: string[] = [];
  let id = 0;
  const service = createRuntimeService({
    providerRuntime: {
      hasRuntime: () => true,
      async run(provider, _prompt, options, writer) {
        dispatchedProviders.push(provider);
        runOptions.push(options);
        writer.send({ kind: 'complete', exitCode: 0 });
      },
      async abort() { return true; },
      resolveToolApproval() {},
    },
    commandDedup: createDedupRepository(),
    eventReporter: { async report() {} },
    workspaceExists: async () => true,
    createId: () => String(++id),
  });

  const accepted = await service.start(createCommand({
    executor: 'codex',
    capabilities: ['READ_FILE', 'SEARCH_CODE'],
    permissionPolicy: policy([]),
  }));
  await waitFor(
    () => service.getRun(accepted.runtimeRunId)?.status === 'succeeded',
    'codex run did not complete',
  );

  assert.deepEqual(dispatchedProviders, ['codex']);
  assert.equal(runOptions[0]?.permissionMode, 'plan');
  assert.equal(runOptions[0]?.toolsSettings, undefined);
  assert.equal(runOptions[0]?.settings, undefined);
  assert.equal(runOptions[0]?.env, undefined);
});

test('opencode mutating start is rejected before provider dispatch', async () => {
  let dispatchCount = 0;
  const service = createRuntimeService({
    providerRuntime: {
      hasRuntime: () => true,
      async run() { dispatchCount += 1; },
      async abort() { return true; },
      resolveToolApproval() {},
    },
    commandDedup: createDedupRepository(),
    eventReporter: { async report() {} },
    workspaceExists: async () => true,
    createId: () => '1',
  });

  await assert.rejects(
    service.start(createCommand({
      executor: 'opencode',
      capabilities: ['READ_FILE', 'WRITE_FILE', 'TEST'],
      permissionPolicy: policy(['WRITE_FILE']),
    })),
    (error: unknown) => Boolean(
      error && typeof error === 'object' && 'code' in error && error.code === 'EXECUTOR_READ_ONLY_REQUIRED',
    ),
  );
  assert.equal(dispatchCount, 0);
});

test('unsupported executors are rejected before any provider dispatch', async () => {
  let dispatchCount = 0;
  const service = createRuntimeService({
    providerRuntime: {
      hasRuntime: () => true,
      async run() { dispatchCount += 1; },
      async abort() { return true; },
      resolveToolApproval() {},
    },
    commandDedup: createDedupRepository(),
    eventReporter: { async report() {} },
    workspaceExists: async () => true,
    createId: () => String(++dispatchCount),
  });

  await assert.rejects(
    service.start(createCommand({ executor: 'cursor' as RuntimeStartCommand['executor'] })),
    (error: unknown) => Boolean(
      error && typeof error === 'object' && 'code' in error && error.code === 'UNSUPPORTED_EXECUTOR',
    ),
  );
  assert.equal(dispatchCount, 0);
});

test('connectionRef on a non-Claude executor is rejected as a mismatch', async () => {
  const service = createRuntimeService({
    providerRuntime: {
      hasRuntime: () => true,
      async run() {},
      async abort() { return true; },
      resolveToolApproval() {},
    },
    commandDedup: createDedupRepository(),
    eventReporter: { async report() {} },
    workspaceExists: async () => true,
    createId: () => '1',
  });

  await assert.rejects(
    service.start(createCommand({
      executor: 'codex',
      connectionRef: 'conn-1',
      capabilities: ['READ_FILE', 'SEARCH_CODE'],
      permissionPolicy: policy([]),
    })),
    (error: unknown) => Boolean(
      error && typeof error === 'object' && 'code' in error && error.code === 'CONNECTION_EXECUTOR_MISMATCH',
    ),
  );
});

test('cancel targets the provider-native session id for non-Claude executors', async () => {
  const abortTargets: string[] = [];
  let announceSession: (() => void) | null = null;
  const sessionAnnounced = new Promise<void>((resolve) => { announceSession = resolve; });
  let id = 0;
  const service = createRuntimeService({
    providerRuntime: {
      hasRuntime: () => true,
      async run(_provider, _prompt, _options, writer) {
        writer.setSessionId?.('native-thread-1');
        announceSession?.();
        return new Promise<void>(() => undefined);
      },
      async abort(_provider, sessionId) {
        abortTargets.push(sessionId);
        return true;
      },
      resolveToolApproval() {},
    },
    commandDedup: createDedupRepository(),
    eventReporter: { async report() {} },
    workspaceExists: async () => true,
    createId: () => String(++id),
  });

  const accepted = await service.start(createCommand({
    executor: 'codex',
    capabilities: ['READ_FILE', 'SEARCH_CODE'],
    permissionPolicy: policy([]),
  }));
  await sessionAnnounced;

  await service.cancel(accepted.runtimeRunId, {
    protocolVersion: '1.0',
    requestId: 'cancel-1',
    idempotencyKey: 'attempt-1:cancel',
  });
  assert.deepEqual(abortTargets, ['native-thread-1']);
});

test('non-Claude start is rejected when the executor has no usable credentials', async () => {
  let dispatchCount = 0;
  const service = createRuntimeService({
    providerRuntime: {
      hasRuntime: () => true,
      async run() { dispatchCount += 1; },
      async abort() { return true; },
      resolveToolApproval() {},
      async isExecutorAuthenticated() { return false; },
    },
    commandDedup: createDedupRepository(),
    eventReporter: { async report() {} },
    workspaceExists: async () => true,
    createId: () => '1',
  });

  await assert.rejects(
    service.start(createCommand({
      executor: 'opencode',
      capabilities: ['READ_FILE', 'SEARCH_CODE'],
      permissionPolicy: policy([]),
    })),
    (error: unknown) => Boolean(
      error && typeof error === 'object' && 'code' in error && error.code === 'EXECUTOR_NOT_AUTHENTICATED',
    ),
  );
  assert.equal(dispatchCount, 0);
});

test('Claude start bypasses the non-Claude credential preflight', async () => {
  let dispatchCount = 0;
  let id = 0;
  const service = createRuntimeService({
    providerRuntime: {
      hasRuntime: () => true,
      async run(_provider, _prompt, _options, writer) {
        dispatchCount += 1;
        writer.send({ kind: 'complete', exitCode: 0 });
      },
      async abort() { return true; },
      resolveToolApproval() {},
      async isExecutorAuthenticated() { return false; },
    },
    commandDedup: createDedupRepository(),
    eventReporter: { async report() {} },
    workspaceExists: async () => true,
    createId: () => String(++id),
  });

  const accepted = await service.start(createCommand());
  await waitFor(
    () => service.getRun(accepted.runtimeRunId)?.status === 'succeeded',
    'claude run did not complete',
  );
  assert.equal(dispatchCount, 1);
});
