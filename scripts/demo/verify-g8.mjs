#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';

import {
  commandResult,
  createProjectRegistration,
  demoRepositoryPath,
  demoRoot,
  ensureDemoDirectories,
  fetchJson,
  parseArguments,
  projectRoot,
  readDotEnv,
  readStackState,
  timestampLabel,
} from './lib.mjs';

const TERMINAL_ATTEMPT_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'LOST', 'ABORTED']);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function createDemoBrowserToken() {
  const databasePath = join(demoRoot, 'node-runtime.db');
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const user = database.prepare(
      'SELECT id, username FROM users WHERE is_active = 1 ORDER BY id LIMIT 1',
    ).get();
    assert(user, 'Demo Node authentication database has no active user.');

    const fileEnvironment = readDotEnv(join(projectRoot, '.env'));
    const storedSecret = database.prepare(
      "SELECT value FROM app_config WHERE key = 'jwt_secret'",
    ).get()?.value;
    const secret = process.env.JWT_SECRET?.trim()
      || fileEnvironment.JWT_SECRET?.trim()
      || storedSecret;
    assert(secret, 'Demo Node JWT secret is unavailable.');

    return jwt.sign(
      { userId: user.id, username: user.username },
      secret,
      { expiresIn: '2h' },
    );
  } finally {
    database.close();
  }
}

function taskCenterPath(projectId, suffix) {
  return `/api/task-center/projects/${encodeURIComponent(projectId)}${suffix}`;
}

async function nodeJson(stack, token, path, options = {}) {
  return fetchJson(`${stack.nodeBaseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });
}

async function assertTaskCenterGatewayLoaded(stack, token) {
  const response = await fetch(
    `${stack.nodeBaseUrl}/api/task-center/projects/g8-route-probe/dashboard`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
  );
  const contentType = response.headers.get('content-type') ?? '';
  await response.arrayBuffer();
  assert(response.status !== 401, 'Generated Demo browser token was rejected by the running Node process.');
  assert(
    contentType.includes('application/json'),
    'Running Node process has not loaded the Task Center Gateway; the request reached the SPA HTML fallback. Rebuild and restart the existing stack before G8 verification.',
  );
}

async function assertProjectControlLoaded(stack) {
  assert(
    stack.projectControlToken,
    'Demo stack predates the separate Project Control credential. Stop and start the stack to load the G8 build.',
  );
  const response = await fetch(
    `${stack.controlBaseUrl}/internal/project-control/v1/projects/00000000-0000-0000-0000-000000000000/activity?limit=1`,
    {
      headers: {
        Authorization: `Bearer ${stack.projectControlToken}`,
        Accept: 'application/json',
      },
    },
  );
  const body = await response.json().catch(() => null);
  assert(
    response.status === 404 && body?.code === 'TASK_NOT_FOUND',
    `Running Control Plane has not loaded the V16 project activity capability: ${response.status} ${JSON.stringify(body)}`,
  );
}

async function waitForDashboardReady(stack, token, projectId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await nodeJson(stack, token, taskCenterPath(projectId, '/dashboard'));
    if (latest?.availability === 'ready') return latest;
    await delay(1_000);
  }
  throw new Error(`Task Center dashboard did not become ready: ${JSON.stringify(latest)}`);
}

async function waitForTerminalTask(stack, token, projectId, taskId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const approved = new Set();
  let latest = null;

  while (Date.now() < deadline) {
    latest = await nodeJson(stack, token, taskCenterPath(projectId, `/tasks/${encodeURIComponent(taskId)}`));
    for (const approval of latest?.approvals ?? []) {
      if (approval.status !== 'PENDING' || approved.has(approval.approvalId)) continue;
      await nodeJson(
        stack,
        token,
        taskCenterPath(
          projectId,
          `/tasks/${encodeURIComponent(taskId)}/approvals/${encodeURIComponent(approval.approvalId)}/decision`,
        ),
        {
          method: 'POST',
          body: { decision: 'APPROVED', message: 'G8 fixed Demo approval through the Task Center Gateway.' },
        },
      );
      approved.add(approval.approvalId);
    }

    if (TERMINAL_ATTEMPT_STATUSES.has(latest?.task?.attemptStatus)) {
      assert(
        latest.task.attemptStatus === 'SUCCEEDED',
        `Task ${taskId} ended as ${latest.task.attemptStatus}: ${latest.task.errorCode ?? ''} ${latest.task.errorMessage ?? ''}`,
      );
      return { detail: latest, approvedCount: approved.size };
    }
    await delay(1_500);
  }

  throw new Error(`Task ${taskId} timed out: ${JSON.stringify(latest?.task ?? null)}`);
}

async function waitForVerifiableWorkOrder(stack, token, projectId, planId, workOrderId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    const workOrders = await nodeJson(
      stack,
      token,
      taskCenterPath(projectId, `/work-orders?planId=${encodeURIComponent(planId)}`),
    );
    latest = workOrders.find((candidate) => candidate.workOrderId === workOrderId) ?? null;
    const report = latest?.reports?.find((candidate) => candidate.attemptStatus === 'SUCCEEDED');
    if (latest?.status === 'AWAITING_VERIFICATION' && report?.systemEvidence?.length > 0) {
      return { workOrder: latest, report };
    }
    await delay(1_000);
  }
  throw new Error(`Work Order ${workOrderId} did not become verifiable: ${JSON.stringify(latest)}`);
}

async function executeWorkOrder(stack, token, projectId, plan, node, label, timeoutMs) {
  const body = {
    planId: plan.planId,
    nodeKey: node.nodeKey,
    clientRequestId: `${label}-${randomUUID()}`,
  };
  const claimed = await nodeJson(
    stack,
    token,
    taskCenterPath(projectId, '/work-orders/claims'),
    { method: 'POST', body },
  );
  const replay = await nodeJson(
    stack,
    token,
    taskCenterPath(projectId, '/work-orders/claims'),
    { method: 'POST', body },
  );
  assert(replay.workOrderId === claimed.workOrderId, 'Work Order claim replay changed the Work Order id.');
  assert(replay.taskId === claimed.taskId, 'Work Order claim replay created a second Task.');
  assert(replay.initialAttemptId === claimed.initialAttemptId, 'Work Order claim replay created a second Attempt.');
  assert(replay.replayed === true, 'Work Order claim replay was not marked replayed.');

  const terminal = await waitForTerminalTask(
    stack, token, projectId, claimed.taskId, timeoutMs,
  );
  const verifiable = await waitForVerifiableWorkOrder(
    stack, token, projectId, plan.planId, claimed.workOrderId, timeoutMs,
  );
  return {
    claimed,
    replayed: replay.replayed,
    task: terminal.detail.task,
    attempts: terminal.detail.attempts,
    approvalCount: terminal.approvedCount,
    artifacts: terminal.detail.artifacts,
    report: verifiable.report,
  };
}

async function verifyExecution(stack, token, projectId, execution, decision, reason) {
  return nodeJson(
    stack,
    token,
    taskCenterPath(
      projectId,
      `/work-orders/${encodeURIComponent(execution.claimed.workOrderId)}/verifications`,
    ),
    {
      method: 'POST',
      body: { reportId: execution.report.reportId, decision, reason },
    },
  );
}

async function createRoundProject(stack, token, workspacePath, runLabel, roundNumber, timeoutMs) {
  const controlProject = await fetchJson(`${stack.controlBaseUrl}/api/v1/projects/ensure`, {
    method: 'POST',
    body: createProjectRegistration(workspacePath),
    timeoutMs: 30_000,
  });
  const local = await nodeJson(stack, token, '/api/projects/create-project', {
    method: 'POST',
    body: { path: workspacePath, customName: `G8 ${runLabel} round ${roundNumber}` },
    timeoutMs: 30_000,
  });
  const projectId = local?.project?.projectId;
  assert(projectId, `Node did not return a local project id: ${JSON.stringify(local)}`);
  const dashboard = await waitForDashboardReady(stack, token, projectId, timeoutMs);
  assert(
    dashboard.project.controlProjectId === controlProject.projectId,
    'Task Center resolved a different Control Project than the fixed Demo registration.',
  );
  return { projectId, controlProject, dashboard };
}

function createMarkdownReport(report) {
  const lines = [
    '# 知枢 G8 连续两轮真实闭环报告',
    '',
    `- 完成时间：${report.completedAt}`,
    `- Node Gateway：\`${report.nodeBaseUrl}\``,
    `- 第一轮：${report.rounds[0].result}`,
    `- 第二轮：${report.rounds[1].result}`,
    '',
    '| 轮次 | 本地 Project | Work Order 数 | 恢复路径 | 最终测试 | 活动事件 |',
    '|---:|---|---:|---|---|---:|',
    ...report.rounds.map((round) => (
      `| ${round.roundNumber} | \`${round.projectId}\` | ${round.executions.length} | ${round.recoveryMode} | ${round.finalTest.passed ? '通过' : '失败'} | ${round.activity.events.length} |`
    )),
    '',
    '第二轮先将首个 Execution Report 人工验证为 FAILED，再对同一 Plan Node 创建新的历史 Work Order，最终以系统证据通过验证。',
    '',
  ];
  return `${lines.join('\n')}\n`;
}

async function runRound(stack, token, runLabel, roundNumber, recoverFromFailure, timeoutMs) {
  const workspacePath = join(demoRoot, 'workspaces', `g8-${runLabel}-round-${roundNumber}`);
  await mkdir(workspacePath, { recursive: true });
  await cp(demoRepositoryPath, workspacePath, {
    recursive: true,
    filter: (source) => !source.endsWith('tasks.json'),
  });

  const baselineTest = commandResult('npm', ['test'], { cwd: workspacePath, timeout: 60_000 });
  assert(baselineTest.status !== 0, `Round ${roundNumber} fixture baseline unexpectedly passes.`);

  const project = await createRoundProject(
    stack, token, workspacePath, runLabel, roundNumber, timeoutMs,
  );
  const activityHead = await nodeJson(
    stack, token, taskCenterPath(project.projectId, '/activity?limit=1'),
  );

  const objective = '修复固定 Demo Repository 中 src/pricing.mjs 的折扣边界：负数按 0，大于 0.5 按 0.5，合法值保持不变；运行 npm test，并形成可追溯的文件与测试证据。';
  const initialProposal = await nodeJson(
    stack,
    token,
    taskCenterPath(project.projectId, '/state/initial-proposals'),
    {
      method: 'POST',
      body: {
        goal: '完成折扣边界修复并以系统测试证据验收。',
        stage: `G8 固定 Demo 第 ${roundNumber} 轮`,
        summary: '固定、隔离、可重复的单 Agent 真实闭环。',
        blocker: null,
        decisions: [],
        constraints: [{
          title: '固定仓库边界',
          content: '只修改 src/pricing.mjs，不修改测试；验证命令为 npm test。',
          rationale: '保证两轮使用同一验收用例。',
          evidenceReferenceIds: [],
        }],
        risks: [],
      },
    },
  );
  await nodeJson(
    stack,
    token,
    taskCenterPath(project.projectId, `/state/proposals/${encodeURIComponent(initialProposal.proposalId)}/confirm`),
    { method: 'POST', body: { clientRequestId: `g8-state-${roundNumber}-${randomUUID()}` } },
  );
  const confirmedState = await nodeJson(
    stack, token, taskCenterPath(project.projectId, '/state'),
  );

  const brain = await nodeJson(
    stack,
    token,
    taskCenterPath(project.projectId, '/brain/ask'),
    {
      method: 'POST',
      body: {
        question: '基于已确认目标、约束和固定验收仓库，说明为什么本轮只应批准一个可执行实施节点。',
        threadId: null,
      },
    },
  );
  const proposal = await nodeJson(
    stack,
    token,
    taskCenterPath(project.projectId, '/plans/proposals'),
    { method: 'POST', body: { objective } },
  );
  const implementationNode = proposal?.payload?.nodes?.find((node) => node.nodeKey.startsWith('implement'));
  assert(implementationNode, `Planner did not produce an implementation node: ${JSON.stringify(proposal)}`);
  assert(implementationNode.dependsOn?.length === 0, 'Implementation node cannot be approved independently.');
  assert(implementationNode.requiredCapabilities?.includes('TEST'), 'Implementation node lacks TEST capability.');

  const plan = await nodeJson(
    stack,
    token,
    taskCenterPath(project.projectId, `/plans/proposals/${encodeURIComponent(proposal.proposalId)}/publish`),
    { method: 'POST', body: { approvedNodeKeys: [implementationNode.nodeKey] } },
  );
  assert(plan.nodes?.length === 1, 'G8 must publish exactly one approved Plan node.');
  assert(plan.nodes[0]?.executionState === 'READY', 'The single approved Plan node is not READY.');

  const executions = [];
  const firstExecution = await executeWorkOrder(
    stack, token, project.projectId, plan, plan.nodes[0], `g8-r${roundNumber}-first`, timeoutMs,
  );
  executions.push(firstExecution);

  let failedVerification = null;
  let stateAfterFailure = null;
  let finalVerification;
  if (recoverFromFailure) {
    failedVerification = await verifyExecution(
      stack,
      token,
      project.projectId,
      firstExecution,
      'FAILED',
      'G8 第二轮中间验收主动失败：要求以新的历史 Work Order 重新执行并复核同一节点。',
    );
    assert(failedVerification.workOrder?.status === 'REJECTED', 'Failed verification did not reject the Work Order.');
    stateAfterFailure = await nodeJson(
      stack, token, taskCenterPath(project.projectId, '/state'),
    );
    assert(
      stateAfterFailure.stateRevision === confirmedState.stateRevision,
      'FAILED verification advanced authoritative Project State.',
    );

    const recoveredExecution = await executeWorkOrder(
      stack, token, project.projectId, plan, plan.nodes[0], `g8-r${roundNumber}-recovery`, timeoutMs,
    );
    executions.push(recoveredExecution);
    finalVerification = await verifyExecution(
      stack,
      token,
      project.projectId,
      recoveredExecution,
      'PASSED',
      'G8 第二轮恢复执行已产生文件与测试系统证据，验收通过。',
    );
  } else {
    finalVerification = await verifyExecution(
      stack,
      token,
      project.projectId,
      firstExecution,
      'PASSED',
      'G8 第一轮文件与测试系统证据已复核，验收通过。',
    );
  }

  assert(finalVerification.workOrder?.status === 'VERIFIED', 'Final Work Order is not VERIFIED.');
  assert(finalVerification.brainRun?.status === 'SUCCEEDED', 'Verification Brain handoff did not succeed.');

  const finalTest = commandResult('npm', ['test'], { cwd: workspacePath, timeout: 60_000 });
  const finalOutput = `${finalTest.stdout ?? ''}\n${finalTest.stderr ?? ''}`;
  assert(finalTest.status === 0, `Round ${roundNumber} final tests failed:\n${finalOutput}`);
  const repairedSource = await readFile(join(workspacePath, 'src', 'pricing.mjs'), 'utf8');
  const originalSource = await readFile(join(demoRepositoryPath, 'src', 'pricing.mjs'), 'utf8');
  assert(repairedSource !== originalSource, `Round ${roundNumber} did not change pricing.mjs.`);

  const [state, plans, workOrders, tasks, metrics, activity, threads] = await Promise.all([
    nodeJson(stack, token, taskCenterPath(project.projectId, '/state')),
    nodeJson(stack, token, taskCenterPath(project.projectId, '/plans')),
    nodeJson(stack, token, taskCenterPath(project.projectId, `/work-orders?planId=${encodeURIComponent(plan.planId)}`)),
    nodeJson(stack, token, taskCenterPath(project.projectId, '/tasks?archive=ALL&limit=100')),
    nodeJson(stack, token, taskCenterPath(project.projectId, '/metrics')),
    nodeJson(stack, token, taskCenterPath(project.projectId, `/activity?after=${activityHead.nextCursor}&limit=200`)),
    nodeJson(stack, token, taskCenterPath(project.projectId, '/brain/threads')),
  ]);
  const planSnapshot = plans.find((candidate) => candidate.planId === plan.planId);
  assert(planSnapshot?.nodes?.[0]?.executionState === 'COMPLETED', 'Verified Plan node is not COMPLETED.');
  assert(
    state.stateRevision > confirmedState.stateRevision,
    'PASSED verification did not advance Project State beyond the confirmed initial snapshot.',
  );
  assert(
    state.entries?.some((entry) => (
      entry.sourceType === 'EXECUTION_REPORT' && entry.authorityLevel === 'SYSTEM_VERIFIED'
    )),
    'PASSED verification did not create a SYSTEM_VERIFIED Execution Report fact.',
  );
  assert(workOrders.length === executions.length, 'Work Order history count does not match the executed recovery path.');
  assert(tasks.items?.length >= executions.length, 'Task history does not contain every Work Order Task.');
  assert(metrics.attempts?.succeeded >= executions.length, 'Project metrics do not include successful Attempts.');
  assert(metrics.tokens?.brainRuns >= 2, 'Project metrics do not include Brain runs from discussion and handoff.');
  assert(activity.events?.length > 0, 'Project activity replay contains no G8 events.');
  assert(threads.length > 0, 'Project Brain thread history is empty.');

  return {
    roundNumber,
    result: 'PASSED',
    recoveryMode: recoverFromFailure ? 'Verification FAILED -> new Work Order -> PASSED' : 'Direct PASSED',
    workspacePath,
    projectId: project.projectId,
    controlProjectId: project.controlProject.projectId,
    profileId: project.controlProject.profileId,
    initialStateProposalId: initialProposal.proposalId,
    brainRunId: brain.runId,
    planId: plan.planId,
    nodeKey: plan.nodes[0].nodeKey,
    executions,
    failedVerification,
    stateAfterFailure,
    finalVerification,
    state,
    metrics,
    activity,
    finalTest: { passed: true, output: finalOutput },
  };
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2));
  const timeoutMs = Number.parseInt(String(arguments_.taskTimeoutMs ?? 15 * 60_000), 10);
  assert(Number.isSafeInteger(timeoutMs) && timeoutMs >= 60_000, 'taskTimeoutMs must be at least 60000.');

  const stack = await readStackState();
  assert(stack, 'Demo stack is not running. Start it before G8 verification.');
  await ensureDemoDirectories();
  const token = createDemoBrowserToken();
  await assertProjectControlLoaded(stack);
  await assertTaskCenterGatewayLoaded(stack, token);

  const runLabel = timestampLabel();
  const rounds = [
    await runRound(stack, token, runLabel, 1, false, timeoutMs),
    await runRound(stack, token, runLabel, 2, true, timeoutMs),
  ];
  const report = {
    schemaVersion: 1,
    runId: randomUUID(),
    startedAt: runLabel,
    completedAt: new Date().toISOString(),
    nodeBaseUrl: stack.nodeBaseUrl,
    controlBaseUrl: stack.controlBaseUrl,
    rounds,
  };
  const evidenceBase = join(demoRoot, 'evidence', `g8-${runLabel}`);
  await writeFile(`${evidenceBase}.json`, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(`${evidenceBase}.md`, createMarkdownReport(report), 'utf8');

  console.log('='.repeat(72));
  console.log('G8 fixed Demo completed two consecutive Task Center Gateway rounds.');
  console.log(`Evidence JSON: ${evidenceBase}.json`);
  console.log(`Evidence report: ${evidenceBase}.md`);
}

main().catch((error) => {
  console.error(`[FAIL] ${error.message}`);
  process.exitCode = 1;
});
