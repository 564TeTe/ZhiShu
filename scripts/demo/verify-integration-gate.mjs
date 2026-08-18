#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  commandResult,
  createProjectRegistration,
  demoRoot,
  ensureDemoDirectories,
  fetchJson,
  projectRoot,
  readDotEnv,
  readStackState,
  timestampLabel,
} from './lib.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function createDemoBrowserToken() {
  const database = new Database(join(demoRoot, 'node-runtime.db'), {
    readonly: true,
    fileMustExist: true,
  });
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
    return jwt.sign({ userId: user.id, username: user.username }, secret, { expiresIn: '2h' });
  } finally {
    database.close();
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(options.headers ?? {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { response, body };
}

async function requiredJson(url, options = {}) {
  const result = await requestJson(url, options);
  if (!result.response.ok) {
    throw new Error(`${options.method ?? 'GET'} ${url} returned ${result.response.status}: ${JSON.stringify(result.body)}`);
  }
  return result.body;
}

async function expectConflict(url, options = {}) {
  const result = await requestJson(url, options);
  assert(result.response.status === 409,
    `Expected 409 from ${options.method ?? 'GET'} ${url}, got ${result.response.status}: ${JSON.stringify(result.body)}`);
  return result.body;
}

function nodePath(localProjectId, suffix) {
  return `/api/task-center/projects/${encodeURIComponent(localProjectId)}${suffix}`;
}

function nodeRequest(stack, browserToken, localProjectId, suffix, options = {}) {
  return requiredJson(`${stack.nodeBaseUrl}${nodePath(localProjectId, suffix)}`, {
    ...options,
    headers: { Authorization: `Bearer ${browserToken}`, ...(options.headers ?? {}) },
  });
}

function controlRequest(stack, actor, projectId, suffix, options = {}) {
  return requiredJson(`${stack.controlBaseUrl}/internal/project-control/v1/projects/${projectId}${suffix}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${stack.projectControlToken}`,
      'X-Zhishu-Actor': actor,
      ...(options.headers ?? {}),
    },
  });
}

function runSql(sql) {
  const result = commandResult('docker', [
    'exec', 'control-plane-postgres-1', 'psql', '-v', 'ON_ERROR_STOP=1',
    '-U', 'zhishu', '-d', 'zhishu', '-c', sql,
  ], { timeout: 30_000 });
  if (result.error || result.status !== 0) {
    throw new Error(`PostgreSQL fixture failed: ${result.stderr || result.stdout}`);
  }
}

async function createEvidenceFixture(stack, projectId, profileId, actor) {
  const taskId = randomUUID();
  const attemptId = randomUUID();
  const artifactId = randomUUID();
  const referenceId = randomUUID();
  const sourceId = randomUUID();
  const snapshot = '{"executor":"claude","capabilities":["READ_FILE","WRITE_FILE","TEST"]}';
  const sql = `BEGIN;
INSERT INTO agent_task (id, project_id, profile_id, title, objective, status)
VALUES ('${taskId}', '${projectId}', '${profileId}', 'Integration Gate Evidence Fixture', 'Evidence-only runtime fixture', 'SUCCEEDED');
INSERT INTO task_attempt (id, task_id, attempt_number, runtime_run_id, status, profile_snapshot, started_at, completed_at)
VALUES ('${attemptId}', '${taskId}', 1, 'integration-gate-evidence-fixture', 'SUCCEEDED', '${snapshot}'::jsonb, now(), now());
UPDATE agent_task SET current_attempt_id = '${attemptId}' WHERE id = '${taskId}';
INSERT INTO task_artifact (id, task_id, attempt_id, artifact_type, producer, content_plain, mime_type, size_bytes, hash, metadata)
VALUES ('${artifactId}', '${taskId}', '${attemptId}', 'SUMMARY', 'integration-gate-demo', 'Evidence-only runtime fixture', 'text/plain', 30, 'integration-gate-fixture-hash', '{}'::jsonb);
INSERT INTO evidence_reference (id, project_id, artifact_id, source_type, source_id, purpose, created_by)
VALUES ('${referenceId}', '${projectId}', '${artifactId}', 'INTEGRATION_GATE_DEMO', '${sourceId}', 'RUNTIME_EVIDENCE', '${actor}');
COMMIT;`;
  runSql(sql);
  return { taskId, attemptId, artifactId, referenceId, sourceId, artifactHash: 'integration-gate-fixture-hash' };
}

async function createPlan(stack, projectId, actor) {
  const context = await controlRequest(stack, actor, projectId, '/contexts', {
    method: 'POST', body: { packageType: 'PLANNER' },
  });
  const proposal = await controlRequest(stack, actor, projectId, '/plans/proposals', {
    method: 'POST',
    body: {
      schemaVersion: '1.0',
      name: 'Integration Gate Runtime Acceptance',
      objective: 'Validate a non-Git Evidence-only Integration Gate at runtime.',
      creationReason: 'Stage 10.2C runtime acceptance',
      baseStateRevision: context.version.stateRevision,
      basePlanVersion: null,
      contextPackageId: context.packageId,
      provider: 'zhishu-grounded',
      model: 'grounded-planner-v1',
      permissions: { taskCreate: false, runtimeDispatch: false, planPublish: false },
      nodes: [
        {
          nodeKey: 'alpha', title: 'Alpha evidence review', objective: 'Review alpha evidence without applying changes.',
          scope: ['src/alpha'], acceptanceCriteria: ['Alpha evidence is traceable'], priority: 4,
          requiredCapabilities: ['READ_FILE'], requiresHumanApproval: false, dependsOn: [],
        },
        {
          nodeKey: 'beta', title: 'Beta evidence review', objective: 'Review beta evidence without applying changes.',
          scope: ['src/beta'], acceptanceCriteria: ['Beta evidence is traceable'], priority: 3,
          requiredCapabilities: ['READ_FILE'], requiresHumanApproval: false, dependsOn: [],
        },
      ],
    },
  });
  const plan = await controlRequest(stack, actor, projectId, `/plans/proposals/${proposal.proposalId}/publish`, {
    method: 'POST', body: { approvedNodeKeys: ['alpha', 'beta'] },
  });
  assert(plan.planId && plan.versionNumber === 1, `Unexpected published plan: ${JSON.stringify(plan)}`);
  assert(plan.nodes?.length === 2 && plan.nodes.every((node) => node.executionState === 'READY'),
    `Published plan is not ready for parallel scheduling: ${JSON.stringify(plan.nodes)}`);
  return { context, proposal, plan };
}

async function provisionSchedule(stack, browserToken, localProjectId, plan, clientPrefix) {
  const schedule = await nodeRequest(stack, browserToken, localProjectId, `/plans/${plan.planId}/parallel-schedules`, {
    method: 'POST',
    body: {
      clientRequestId: `${clientPrefix}-create`,
      baseStateRevision: plan.baseStateRevision,
      basePlanVersion: plan.versionNumber,
      nodeKeys: ['alpha', 'beta'],
    },
  });
  const confirmed = await nodeRequest(
    stack, browserToken, localProjectId,
    `/plans/${plan.planId}/parallel-schedules/${schedule.scheduleId}/confirm`,
    { method: 'POST', body: { clientRequestId: `${clientPrefix}-confirm` } },
  );
  let latest = confirmed;
  for (const assignment of confirmed.assignments) {
    latest = await nodeRequest(
      stack, browserToken, localProjectId,
      `/plans/${plan.planId}/parallel-schedules/${schedule.scheduleId}`
        + `/workspace-leases/${assignment.workspaceLease.leaseId}/provision`,
      { method: 'POST', body: { clientRequestId: `${clientPrefix}-provision-${assignment.workerSlot}` } },
    );
  }
  assert(latest.assignments.every((assignment) => assignment.status === 'PROVISIONED'),
    `Schedule was not fully provisioned: ${JSON.stringify(latest.assignments)}`);
  return latest;
}

async function main() {
  const stack = await readStackState();
  assert(stack?.projectControlToken, 'The controlled Demo stack is not running with a Project Control token.');
  const browserToken = createDemoBrowserToken();
  const actor = 'system:integration-gate-runtime-demo';
  const label = timestampLabel();
  await ensureDemoDirectories();
  const workspacePath = join(demoRoot, 'workspaces', `integration-gate-${label}`);
  await mkdir(workspacePath, { recursive: true });

  const controlProject = await requiredJson(`${stack.controlBaseUrl}/api/v1/projects/ensure`, {
    method: 'POST', body: createProjectRegistration(workspacePath),
  });
  const localProject = await requiredJson(`${stack.nodeBaseUrl}/api/projects/create-project`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${browserToken}` },
    body: { path: workspacePath, customName: `Integration Gate ${label}` },
  });
  const localProjectId = localProject.project.projectId;
  const dashboard = await nodeRequest(stack, browserToken, localProjectId, '/dashboard');
  assert(dashboard.project.controlProjectId === controlProject.projectId,
    'Gateway resolved a different Control Project than the runtime fixture.');

  const evidence = await createEvidenceFixture(
    stack, controlProject.projectId, controlProject.profileId, actor,
  );
  const { plan } = await createPlan(stack, controlProject.projectId, actor);
  const scheduleA = await provisionSchedule(stack, browserToken, localProjectId, plan, 'gate-runtime-a');
  const gateBase = `/plans/${plan.planId}/integration-gates`;
  const staleGate = await nodeRequest(stack, browserToken, localProjectId, gateBase, {
    method: 'POST',
    body: {
      clientRequestId: 'gate-runtime-stale-create', scheduleId: scheduleA.scheduleId,
      baseStateRevision: plan.baseStateRevision, basePlanVersion: plan.versionNumber,
      evidenceReferenceIds: [evidence.referenceId],
    },
  });
  assert(staleGate.status === 'PENDING_APPROVAL' && staleGate.evidenceCount === 1
    && staleGate.proposal.applyState === 'NOT_ATTEMPTED',
  `Unexpected stale Gate proposal: ${JSON.stringify(staleGate)}`);
  runSql(`UPDATE parallel_schedule_assignment SET status = 'CANCELLED' WHERE schedule_id = '${scheduleA.scheduleId}';`);
  await expectConflict(`${stack.nodeBaseUrl}${nodePath(localProjectId, `${gateBase}/${staleGate.gateId}/confirm`)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${browserToken}`, 'Content-Type': 'application/json' },
    body: { clientRequestId: 'gate-runtime-stale-confirm' },
  });
  const staleList = await nodeRequest(stack, browserToken, localProjectId, gateBase);
  const staleObserved = staleList.find((gate) => gate.gateId === staleGate.gateId);
  assert(staleObserved?.status === 'STALE'
    && staleObserved.events.at(-1)?.payload?.reason === 'ASSIGNMENT_PROVISIONING_CHANGED',
  `Stale Gate audit was not observed: ${JSON.stringify(staleObserved)}`);

  const scheduleB = await provisionSchedule(stack, browserToken, localProjectId, plan, 'gate-runtime-b');
  const approvedGate = await nodeRequest(stack, browserToken, localProjectId, gateBase, {
    method: 'POST',
    body: {
      clientRequestId: 'gate-runtime-approved-create', scheduleId: scheduleB.scheduleId,
      baseStateRevision: plan.baseStateRevision, basePlanVersion: plan.versionNumber,
      evidenceReferenceIds: [evidence.referenceId],
    },
  });
  assert(approvedGate.evidence?.[0]?.artifactHash === evidence.artifactHash,
    'Runtime Gate did not expose the captured artifact hash.');
  const approved = await nodeRequest(stack, browserToken, localProjectId,
    `${gateBase}/${approvedGate.gateId}/confirm`,
    { method: 'POST', body: { clientRequestId: 'gate-runtime-approved-confirm' } });
  const replay = await nodeRequest(stack, browserToken, localProjectId,
    `${gateBase}/${approvedGate.gateId}/confirm`,
    { method: 'POST', body: { clientRequestId: 'gate-runtime-approved-confirm' } });
  assert(approved.status === 'APPROVED' && approved.applyState === 'NOT_ATTEMPTED',
    `Runtime Gate did not approve as evidence-only: ${JSON.stringify(approved)}`);
  assert(replay.gateId === approved.gateId && replay.events.length === 2,
    'Runtime Gate confirmation replay changed identity or duplicated events.');
  const finalGates = await nodeRequest(stack, browserToken, localProjectId, gateBase);
  const workOrders = await controlRequest(stack, actor, controlProject.projectId,
    `/work-orders?planId=${encodeURIComponent(plan.planId)}`);
  assert(Array.isArray(workOrders) && workOrders.length === 0,
    `Integration Gate unexpectedly created Work Orders: ${JSON.stringify(workOrders)}`);

  const report = {
    schemaVersion: 1,
    stage: '10.2C',
    startedAt: label,
    completedAt: new Date().toISOString(),
    nodeBaseUrl: stack.nodeBaseUrl,
    controlBaseUrl: stack.controlBaseUrl,
    localProjectId,
    controlProjectId: controlProject.projectId,
    planId: plan.planId,
    evidenceReferenceId: evidence.referenceId,
    staleGateId: staleGate.gateId,
    approvedGateId: approved.gateId,
    statuses: finalGates.map((gate) => ({
      gateId: gate.gateId, status: gate.status, applyState: gate.applyState,
      evidenceCount: gate.evidenceCount, eventTypes: gate.events.map((event) => event.eventType),
    })),
    workOrderCount: workOrders.length,
    constraints: {
      gateMode: 'EVIDENCE_ONLY', applyState: 'NOT_ATTEMPTED',
      gitCommandsExecuted: false, workOrdersCreated: false, agentsStarted: false,
    },
  };
  const evidenceBase = join(demoRoot, 'evidence', `integration-gate-${label}`);
  await writeFile(`${evidenceBase}.json`, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(`${evidenceBase}.md`, [
    '# Integration Gate Runtime Acceptance', '',
    `- Stage: ${report.stage}`,
    `- Control Project: \`${report.controlProjectId}\``,
    `- Plan: \`${report.planId}\``,
    `- Stale Gate: \`${report.staleGateId}\` -> STALE (ASSIGNMENT_PROVISIONING_CHANGED)`,
    `- Approved Gate: \`${report.approvedGateId}\` -> APPROVED`,
    '- Gate mode: `EVIDENCE_ONLY`',
    '- Apply state: `NOT_ATTEMPTED`',
    '- Work Orders: 0',
    '- Git / Agent: not executed', '',
  ].join('\n'), 'utf8');
  console.log(JSON.stringify({ ...report, evidenceJson: `${evidenceBase}.json`, evidenceMarkdown: `${evidenceBase}.md` }, null, 2));
}

main().catch((error) => {
  console.error(`[FAIL] ${error.message}`);
  process.exitCode = 1;
});
