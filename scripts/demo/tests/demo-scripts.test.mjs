import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import {
  createProjectRegistration,
  isZhishuNodeHealth,
  loadTaskTemplates,
  parseArguments,
  processCommandMatches,
  readDotEnv,
  resolveProjectControlToken,
  resolveSharedToken,
} from '../lib.mjs';

test('requires formal Runtime event delivery before treating Node as ready', () => {
  assert.equal(isZhishuNodeHealth({ status: 'ok' }), false);
  assert.equal(isZhishuNodeHealth({
    status: 'ok',
    runtimeEventDelivery: { configurationReady: true, started: false },
  }), false);
  assert.equal(isZhishuNodeHealth({
    status: 'ok',
    runtimeEventDelivery: { configurationReady: true, started: true },
  }), true);
});

test('matches owned process paths across Windows and POSIX separators', () => {
  assert.equal(processCommandMatches(
    'node D:\\workspace\\dist-server\\server\\index.js',
    'D:/workspace/dist-server/server/index.js',
  ), true);
  assert.equal(processCommandMatches('node C:/other/server/index.js', 'D:/workspace/server/index.js'), false);
});

test('parses flag, spaced, and inline command arguments', () => {
  assert.deepEqual(
    parseArguments(['--skip-build', '--node-port', '3101', '--control-port=8180']),
    { skipBuild: true, nodePort: '3101', controlPort: '8180' },
  );
});

test('reads dotenv values without exposing comment lines', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zhishu-demo-env-'));
  const path = join(directory, '.env');
  try {
    await writeFile(path, '# ignored\nZS_RUNTIME_TOKEN="local-secret"\nEMPTY=\n', 'utf8');
    assert.deepEqual(readDotEnv(path), { ZS_RUNTIME_TOKEN: 'local-secret', EMPTY: '' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('uses a configured token or generates a strong ephemeral token', () => {
  assert.equal(resolveSharedToken({ ZS_RUNTIME_TOKEN: 'configured-token' }), 'configured-token');
  const generated = resolveSharedToken({}, {});
  assert.match(generated, /^[a-f0-9]{64}$/);
});

test('uses a separate configured or ephemeral Project Control token', () => {
  assert.equal(
    resolveProjectControlToken({ ZS_PROJECT_CONTROL_TOKEN: 'project-control-token' }, {}),
    'project-control-token',
  );
  assert.match(resolveProjectControlToken({}, {}), /^[a-f0-9]{64}$/);
});

test('loads the fixed four-step task contract', () => {
  const tasks = loadTaskTemplates();
  assert.deepEqual(tasks.map((task) => task.key), [
    'readonly-analysis',
    'approved-write',
    'test-execution',
    'artifact-summary',
  ]);
  assert.deepEqual(tasks.map((task) => task.expect.minimumApprovals), [0, 1, 1, 0]);
});

test('creates an absolute project registration with a fresh UUID', () => {
  const registration = createProjectRegistration('.');
  assert.match(registration.candidateProjectId, /^[0-9a-f-]{36}$/);
  assert.equal(typeof registration.projectRef, 'string');
  assert.ok(registration.projectRef.length > 0);
});

test('configures the Windows launcher for UTF-8 before reading Node output', () => {
  const launcher = readFileSync(new URL('../start-windows.ps1', import.meta.url), 'utf8');
  const encodingSetup = launcher.indexOf('[Console]::OutputEncoding = $utf8NoBom');
  const npmLaunch = launcher.indexOf('& npm.cmd run zhishu:start');

  assert.ok(encodingSetup >= 0, 'Windows launcher must configure UTF-8 output decoding');
  assert.ok(npmLaunch > encodingSetup, 'UTF-8 decoding must be configured before npm starts');
  assert.match(launcher, /\$OutputEncoding = \$utf8NoBom/);
});

test('G8 verifier uses the authenticated Task Center Gateway for two-round failure recovery', () => {
  const verifier = readFileSync(new URL('../verify-g8.mjs', import.meta.url), 'utf8');
  const packageJson = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));

  assert.equal(packageJson.scripts['demo:g8'], 'node scripts/demo/verify-g8.mjs');
  assert.match(verifier, /\/api\/task-center\/projects/);
  assert.match(verifier, /decision,\s*reason/);
  assert.match(verifier, /'FAILED'/);
  assert.match(verifier, /g8-r\$\{roundNumber\}-recovery/);
  assert.match(verifier, /contentType\.includes\('application\/json'\)/);
  assert.match(verifier, /projectControlToken/);
  assert.match(verifier, /TASK_NOT_FOUND/);
});

test('Demo launcher keeps Runtime and Project Control credentials separate', () => {
  const launcher = readFileSync(new URL('../start-stack.mjs', import.meta.url), 'utf8');

  assert.match(launcher, /resolveProjectControlToken/);
  assert.match(launcher, /projectControlToken === sharedToken/);
  assert.match(launcher, /ZS_PROJECT_CONTROL_TOKEN: projectControlToken/);
  assert.match(launcher, /schemaVersion: 2/);
});

test('Scheduler proposal UI exposes creation and decision without provisioning controls', () => {
  const composer = readFileSync(
    new URL('../../../src/components/task-center/view/subcomponents/ParallelScheduleProposalComposer.tsx', import.meta.url),
    'utf8',
  );
  const decision = readFileSync(
    new URL('../../../src/components/task-center/view/subcomponents/ParallelScheduleProposalDecision.tsx', import.meta.url),
    'utf8',
  );
  const api = readFileSync(
    new URL('../../../src/components/task-center/api/taskCenterApi.ts', import.meta.url),
    'utf8',
  );

  assert.match(composer, /createParallelScheduleProposal/);
  assert.match(composer, /仅创建提案/);
  assert.doesNotMatch(
    composer,
    /confirmParallelSchedule|rejectParallelSchedule|provisionParallelSchedule|claimWorkOrder|createIntegrationGate/,
  );
  assert.match(decision, /confirmParallelScheduleProposal/);
  assert.match(decision, /rejectParallelScheduleProposal/);
  assert.match(decision, /仅审批/);
  assert.doesNotMatch(
    decision,
    /provisionParallelSchedule|claimWorkOrder|createIntegrationGate|confirmIntegrationGate/,
  );
  assert.match(api, /export async function createParallelScheduleProposal/);
  assert.match(api, /export async function confirmParallelScheduleProposal/);
  assert.match(api, /export async function rejectParallelScheduleProposal/);
});

test('Workspace Provision UI supports both isolated kinds and only approved ready leases', () => {
  const provision = readFileSync(
    new URL('../../../src/components/task-center/view/subcomponents/DirectoryOnlyWorkspaceProvision.tsx', import.meta.url),
    'utf8',
  );
  const api = readFileSync(
    new URL('../../../src/components/task-center/api/taskCenterApi.ts', import.meta.url),
    'utf8',
  );

  assert.match(provision, /schedule\.status === 'APPROVED'/);
  assert.match(provision, /assignment\.status === 'READY_FOR_PROVISIONING'/);
  assert.match(provision, /\['DIRECTORY_ONLY', 'GIT_WORKTREE'\]\.includes\(lease\.physicalWorkspaceKind\)/);
  assert.match(provision, /provisionParallelScheduleWorkspaceLease/);
  assert.doesNotMatch(provision, /claimWorkOrder|createIntegrationGate|confirmIntegrationGate|rejectIntegrationGate/);
  assert.match(api, /export async function provisionParallelScheduleWorkspaceLease/);
  assert.match(api, /workspace-leases/);
});

test('Schedule execution supports both isolated kinds and dispatches only approved provisioned pairs', () => {
  const execution = readFileSync(
    new URL('../../../src/components/task-center/view/subcomponents/DirectoryOnlyScheduleExecution.tsx', import.meta.url),
    'utf8',
  );
  const api = readFileSync(
    new URL('../../../src/components/task-center/api/taskCenterApi.ts', import.meta.url),
    'utf8',
  );

  assert.match(execution, /schedule\.status === 'APPROVED'/);
  assert.match(execution, /schedule\.assignments\.length === 2/);
  assert.match(execution, /assignment\.status === 'PROVISIONED'/);
  assert.match(execution, /lease\.status === 'PROVISIONED'/);
  assert.match(execution, /lease\.provisioningState === 'PROVISIONED'/);
  assert.match(execution, /\['DIRECTORY_ONLY', 'GIT_WORKTREE'\]\.includes\(lease\.physicalWorkspaceKind\)/);
  assert.match(execution, /workspaceKinds\.size === 1/);
  assert.match(execution, /dispatchParallelSchedule/);
  assert.doesNotMatch(
    execution,
    /claimWorkOrder|provisionParallelScheduleWorkspaceLease|createIntegrationGate|confirmIntegrationGate|rejectIntegrationGate/,
  );
  assert.match(api, /export async function dispatchParallelSchedule/);
  assert.match(api, /parallel-schedules.*dispatch/s);
});

test('Integration Gate UI keeps evidence review separate from execution', () => {
  const control = readFileSync(
    new URL('../../../src/components/task-center/view/subcomponents/IntegrationGateControl.tsx', import.meta.url),
    'utf8',
  );
  const api = readFileSync(
    new URL('../../../src/components/task-center/api/taskCenterApi.ts', import.meta.url),
    'utf8',
  );

  assert.match(control, /schedule\.status === 'APPROVED'/);
  assert.match(control, /schedule\.assignments\.length === 2/);
  assert.match(control, /\['PROVISIONED', 'VERIFIED'\]\.includes\(assignment\.status\)/);
  assert.match(control, /schedule\.baseStateRevision === currentStateRevision/);
  assert.match(control, /evidenceReferenceIds\.length === 0/);
  assert.match(control, /selectedGate\.evidenceStatus !== 'PRESENT'/);
  assert.match(control, /createIntegrationGate/);
  assert.match(control, /confirmIntegrationGate/);
  assert.match(control, /rejectIntegrationGate/);
  assert.doesNotMatch(control, /executeIntegrationGate|startIntegrationAgent|dispatchParallelSchedule/);
  assert.match(api, /export async function createIntegrationGate/);
  assert.match(api, /export async function confirmIntegrationGate/);
  assert.match(api, /export async function rejectIntegrationGate/);
});

test('Integration finalization is explicit, commit-pinned, and remote-free', () => {
  const control = readFileSync(
    new URL('../../../src/components/task-center/view/subcomponents/IntegrationExecutionControl.tsx', import.meta.url),
    'utf8',
  );
  const api = readFileSync(
    new URL('../../../src/components/task-center/api/taskCenterApi.ts', import.meta.url),
    'utf8',
  );
  const adapter = readFileSync(
    new URL('../../../control-plane/src/main/java/com/zhishu/integration/GitIntegrationWorkspacePort.java', import.meta.url),
    'utf8',
  );
  const gitRunner = readFileSync(
    new URL('../../../control-plane/src/main/java/com/zhishu/workspace/GitCommandRunner.java', import.meta.url),
    'utf8',
  );

  assert.match(control, /run\.status === 'SUCCEEDED'/);
  assert.match(control, /run\.finalizationState !== 'CLEANED'/);
  assert.match(control, /finalizeIntegrationExecution/);
  assert.match(control, /run\.candidateCommit/);
  assert.match(control, /setPendingFinalization\(\{ gate, run \}\)/);
  assert.match(control, /确认应用并清理/);
  assert.match(api, /export async function finalizeIntegrationExecution/);
  assert.match(adapter, /Primary Worktree must be clean/);
  assert.match(adapter, /"merge", "--ff-only", request\.candidateCommit\(\)/);
  assert.match(gitRunner, /core\.hooksPath=/);
  assert.doesNotMatch(adapter, /List\.of\("(?:push|pull|fetch)"/);
});

test('Integration build and test policy uses only server-owned project presets', () => {
  const resolver = readFileSync(
    new URL('../../../control-plane/src/main/java/com/zhishu/integration/IntegrationPolicyResolver.java', import.meta.url),
    'utf8',
  );
  const routes = readFileSync(
    new URL('../../../server/modules/task-center-gateway/task-center-gateway.routes.ts', import.meta.url),
    'utf8',
  );

  assert.match(resolver, /"NPM", List\.of\("npm", "run", "build"\), List\.of\("npm", "test"\)/);
  assert.match(resolver, /"MAVEN", List\.of\("mvn", "-q", "-DskipTests", "compile"\)/);
  assert.match(resolver, /package\.json and pom\.xml both exist/);
  assert.doesNotMatch(routes, /body\.(?:buildCommand|testCommand)|body\.(?:buildArgv|testArgv)/);
});
