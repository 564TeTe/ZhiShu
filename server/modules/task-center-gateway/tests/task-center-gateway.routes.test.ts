import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import express, { type NextFunction, type Request, type Response } from 'express';

import type { RuntimeEventDeliveryHealth } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

import { createTaskCenterGatewayRoutes } from '../task-center-gateway.routes.js';
import { createTaskCenterGatewayService } from '../task-center-gateway.service.js';

const healthyRuntime: RuntimeEventDeliveryHealth = {
  status: 'up',
  started: true,
  configurationReady: true,
  missingConfiguration: [],
  invalidConfiguration: [],
  pendingEvents: 0,
  dueEvents: 0,
  oldestEventAgeMs: null,
  maxAttempts: 0,
  lastError: null,
};

const secureWorkspaceDependencies = {
  getProjectControlToken: () => 'project-control-secret',
  getWorkspaceObservation: () => ({
    machineId: 'machine-1', localProjectId: 'local-project-1',
    normalizedWorkspacePath: 'D:\\workspace\\demo',
  }),
};

async function withServer(
  service: ReturnType<typeof createTaskCenterGatewayService>,
  run: (baseUrl: string) => Promise<void>,
  userId?: string,
): Promise<void> {
  const app = express();
  if (userId) {
    app.use((request, _response, next) => {
      (request as Request & { user?: { id: string } }).user = { id: userId };
      next();
    });
  }
  app.use('/api/task-center', createTaskCenterGatewayRoutes(service));
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof AppError) {
      response.status(error.statusCode).json({ code: error.code, message: error.message });
      return;
    }
    response.status(500).json({ code: 'INTERNAL_ERROR' });
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('dashboard route delegates the local project id to the read service', async () => {
  const service = createTaskCenterGatewayService({
    ...secureWorkspaceDependencies,
    fetch: (async (input: Parameters<typeof globalThis.fetch>[0]) => {
      const url = String(input);
      const apiUrl = url.replace('/internal/project-control/v1/', '/api/v1/');
      if (url.includes('/internal/project-control/v1/workspaces/resolve?')) {
        return new Response(JSON.stringify({
          schemaVersion: '1.0', resolution: 'MATCHED_BY_LOCAL_PROJECT_ID',
          project: { projectId: 'control-project-1', identityVersion: 1 },
          binding: { workspaceId: 'workspace-1' }, candidates: [], ambiguityReasons: [], proposal: null,
          executionRegistration: {
            projectId: 'control-project-1', profileId: 'profile-1',
            projectRef: 'D:\\workspace\\demo', profileName: 'Default',
          },
        }), { status: 200 });
      }
      if (apiUrl.includes('/api/v1/tasks?')) return new Response('[]', { status: 200 });
      if (apiUrl.includes('/approval-policy')) {
        return new Response(JSON.stringify({
          projectId: 'control-project-1', projectRoot: 'D:\\workspace\\demo', mode: 'MANUAL',
          allowedDirectories: ['.'], trustedCommands: [], approvalTimeoutSeconds: 45,
          updatedAt: '2026-08-15T00:00:00.000Z',
        }), { status: 200 });
      }
      return new Response('{}', { status: 500 });
    }) as typeof globalThis.fetch,
    getControlPlaneBaseUrl: () => 'http://control.test',
    getProjectById: (projectId) => projectId === 'local-project-1'
      ? { projectId, displayName: 'Demo', projectRef: 'D:\\workspace\\demo' }
      : null,
    getRuntimeDeliveryHealth: () => healthyRuntime,
    now: () => 0,
  });

  await withServer(service, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/task-center/projects/local-project-1/dashboard`);
    assert.equal(response.status, 200);
    const body = await response.json() as { availability: string; project: { projectId: string } };
    assert.equal(body.availability, 'ready');
    assert.equal(body.project.projectId, 'local-project-1');
  });
});

test('dashboard route returns 404 for an unknown local project', async () => {
  const service = createTaskCenterGatewayService({
    getProjectById: () => null,
    getRuntimeDeliveryHealth: () => healthyRuntime,
  });

  await withServer(service, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/task-center/projects/missing/dashboard`);
    assert.equal(response.status, 404);
    assert.equal((await response.json() as { code: string }).code, 'PROJECT_NOT_FOUND');
  });
});

test('task detail route returns the selected task through the project-scoped boundary', async () => {
  const service = createTaskCenterGatewayService({
    ...secureWorkspaceDependencies,
    fetch: (async (input: Parameters<typeof globalThis.fetch>[0]) => {
      const url = String(input);
      if (url.includes('/internal/project-control/v1/workspaces/resolve?')) {
        return new Response(JSON.stringify({
          schemaVersion: '1.0', resolution: 'MATCHED_BY_LOCAL_PROJECT_ID',
          project: { projectId: 'control-project-1', identityVersion: 1 },
          binding: { workspaceId: 'workspace-1' }, candidates: [], ambiguityReasons: [], proposal: null,
          executionRegistration: {
            projectId: 'control-project-1', profileId: 'profile-1',
            projectRef: 'D:\\workspace\\demo', profileName: 'Default',
          },
        }), { status: 200 });
      }
      if (url.endsWith('/internal/project-control/v1/projects/control-project-1/tasks/task-1')) {
        return new Response(JSON.stringify({
          taskId: 'task-1', projectId: 'control-project-1', profileId: 'profile-1',
          title: '任务详情', objective: '验证详情路由', status: 'SUCCEEDED',
          attemptStatus: 'SUCCEEDED', resolutionStatus: 'WAITING_ACCEPTANCE',
          attemptId: 'attempt-1', attemptNumber: 1, createdAt: '2026-08-15T00:00:00.000Z',
        }), { status: 200 });
      }
      if (url.endsWith('/attempts') || url.endsWith('/approvals')
        || url.endsWith('/artifacts') || url.endsWith('/follow-ups')) {
        return new Response('[]', { status: 200 });
      }
      return new Response('{}', { status: 500 });
    }) as typeof globalThis.fetch,
    getControlPlaneBaseUrl: () => 'http://control.test',
    getProjectById: (projectId) => ({
      projectId,
      displayName: 'Demo',
      projectRef: 'D:\\workspace\\demo',
    }),
    getRuntimeDeliveryHealth: () => healthyRuntime,
    now: () => 0,
  });

  await withServer(service, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/task-center/projects/local-project-1/tasks/task-1`,
    );
    assert.equal(response.status, 200);
    const body = await response.json() as { task: { taskId: string }; attempts: unknown[] };
    assert.equal(body.task.taskId, 'task-1');
    assert.deepEqual(body.attempts, []);
  });
});

test('workspace confirmation route requires an authenticated actor even with a complete proposal', async () => {
  const service = createTaskCenterGatewayService({
    getProjectById: () => null,
    getRuntimeDeliveryHealth: () => healthyRuntime,
  });

  await withServer(service, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/task-center/projects/local-project-1/workspace-binding/confirm`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'workspace-1',
          proposalId: 'proposal-1',
          action: 'MOVE_WORKSPACE',
          machineId: 'machine-1',
          localProjectId: 'local-project-1',
          workspacePath: 'D:\\workspace\\demo-moved',
          baseIdentityVersion: 1,
          clientRequestId: 'request-1',
        }),
      },
    );
    assert.equal(response.status, 401);
    assert.equal((await response.json() as { code: string }).code, 'AUTH_USER_REQUIRED');
  });
});

test('project registration route requires an authenticated actor', async () => {
  const service = createTaskCenterGatewayService({
    getProjectById: () => null,
    getRuntimeDeliveryHealth: () => healthyRuntime,
  });

  await withServer(service, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/task-center/projects/local-project-1/registration`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    );
    assert.equal(response.status, 401);
    assert.equal((await response.json() as { code: string }).code, 'AUTH_USER_REQUIRED');
  });
});

test('State Steward proposal route requires an authenticated actor', async () => {
  const service = createTaskCenterGatewayService({
    getProjectById: () => null,
    getRuntimeDeliveryHealth: () => healthyRuntime,
  });

  await withServer(service, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/task-center/projects/local-project-1/state/steward/reports/report-1/proposal`,
      { method: 'POST' },
    );
    assert.equal(response.status, 401);
    assert.equal((await response.json() as { code: string }).code, 'AUTH_USER_REQUIRED');
  });
});

test('State Steward routes forward only report identity and return proposal audit history', async () => {
  const calls: Array<{ url: string; method: string; actor: string | null; body: string | null }> = [];
  const service = createTaskCenterGatewayService({
    ...secureWorkspaceDependencies,
    getControlPlaneBaseUrl: () => 'http://control.test',
    getProjectById: () => ({
      projectId: 'local-project-1', displayName: 'Demo', projectRef: 'D:\\workspace\\demo',
    }),
    getRuntimeDeliveryHealth: () => healthyRuntime,
    fetch: (async (
      input: Parameters<typeof globalThis.fetch>[0],
      init?: Parameters<typeof globalThis.fetch>[1],
    ) => {
      const url = String(input);
      if (url.includes('/workspaces/resolve?')) {
        return new Response(JSON.stringify({
          schemaVersion: '1.0', resolution: 'MATCHED_BY_LOCAL_PROJECT_ID',
          project: { projectId: 'control-project-1', identityVersion: 1 },
          binding: { workspaceId: 'workspace-1' }, proposal: null,
          executionRegistration: {
            projectId: 'control-project-1', profileId: 'profile-1',
            projectRef: 'D:\\workspace\\demo', profileName: 'Default',
          },
        }), { status: 200 });
      }
      calls.push({
        url,
        method: init?.method ?? 'GET',
        actor: new Headers(init?.headers).get('X-Zhishu-Actor'),
        body: typeof init?.body === 'string' ? init.body : null,
      });
      if (url.includes('/state/proposals?proposalType=STATE_CHANGE&limit=50')) {
        return new Response(JSON.stringify([{ proposalId: 'proposal-1', status: 'PENDING_APPROVAL' }]), {
          status: 200,
        });
      }
      if (url.endsWith('/state/steward/reports/report-1/proposal')) {
        return new Response(JSON.stringify({ proposalId: 'proposal-1', status: 'PENDING_APPROVAL' }), {
          status: 201,
        });
      }
      return new Response('{}', { status: 500 });
    }) as typeof globalThis.fetch,
  });

  await withServer(service, async (baseUrl) => {
    const history = await fetch(`${baseUrl}/api/task-center/projects/local-project-1/state/proposals`);
    assert.equal(history.status, 200);
    assert.equal((await history.json() as Array<{ proposalId: string }>)[0]?.proposalId, 'proposal-1');

    const proposal = await fetch(
      `${baseUrl}/api/task-center/projects/local-project-1/state/steward/reports/report-1/proposal`,
      { method: 'POST' },
    );
    assert.equal(proposal.status, 201);
    assert.equal((await proposal.json() as { proposalId: string }).proposalId, 'proposal-1');
  }, '42');

  assert.deepEqual(calls.map((call) => ({
    path: new URL(call.url).pathname, method: call.method, actor: call.actor, body: call.body,
  })), [
    {
      path: '/internal/project-control/v1/projects/control-project-1/state/proposals',
      method: 'GET', actor: null, body: null,
    },
    {
      path: '/internal/project-control/v1/projects/control-project-1/state/steward/reports/report-1/proposal',
      method: 'POST', actor: 'user:42', body: '{}',
    },
  ]);
});

test('task history route validates and forwards bounded search filters', async () => {
  let historyUrl = '';
  const service = createTaskCenterGatewayService({
    ...secureWorkspaceDependencies,
    fetch: (async (input: Parameters<typeof globalThis.fetch>[0]) => {
      const url = String(input);
      if (url.includes('/workspaces/resolve?')) {
        return new Response(JSON.stringify({
          schemaVersion: '1.0', resolution: 'MATCHED_BY_LOCAL_PROJECT_ID',
          project: { projectId: 'control-project-1', identityVersion: 1 },
          binding: { workspaceId: 'workspace-1' }, proposal: null,
          executionRegistration: {
            projectId: 'control-project-1', profileId: 'profile-1',
            projectRef: 'D:\\workspace\\demo', profileName: 'Default',
          },
        }), { status: 200 });
      }
      if (url.includes('/projects/control-project-1/tasks?')) {
        historyUrl = url;
        return new Response(JSON.stringify({
          items: [{
            taskId: 'task-1', projectId: 'control-project-1', profileId: 'profile-1',
            title: 'Archived task', objective: 'History', status: 'FAILED',
            resolutionStatus: 'NEEDS_FOLLOW_UP', createdAt: '2026-08-15T00:00:00.000Z',
            archivedAt: '2026-08-15T01:00:00.000Z', archivedBy: 'user:7', archiveReason: 'Done',
          }],
          nextCursor: null, hasMore: false,
        }), { status: 200 });
      }
      return new Response('{}', { status: 500 });
    }) as typeof globalThis.fetch,
    getControlPlaneBaseUrl: () => 'http://control.test',
    getProjectById: (projectId) => ({
      projectId, displayName: 'Demo', projectRef: 'D:\\workspace\\demo',
    }),
    getRuntimeDeliveryHealth: () => healthyRuntime,
  });

  await withServer(service, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/task-center/projects/local-project-1/tasks`
        + '?archive=ARCHIVED&status=FAILED&search=History&limit=10',
    );
    assert.equal(response.status, 200);
    const body = await response.json() as { items: Array<{ archivedBy: string }> };
    assert.equal(body.items[0]?.archivedBy, 'user:7');
    const forwarded = new URL(historyUrl);
    assert.equal(forwarded.searchParams.get('archive'), 'ARCHIVED');
    assert.equal(forwarded.searchParams.get('status'), 'FAILED');
    assert.equal(forwarded.searchParams.get('search'), 'History');
    assert.equal(forwarded.searchParams.get('limit'), '10');

    const invalid = await fetch(
      `${baseUrl}/api/task-center/projects/local-project-1/tasks?archive=DELETED`,
    );
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json() as { code: string }).code, 'INVALID_TASK_HISTORY_QUERY');
  });
});

test('project activity and metrics routes reject unsafe cursor and window values', async () => {
  const service = createTaskCenterGatewayService({
    getProjectById: () => null,
    getRuntimeDeliveryHealth: () => healthyRuntime,
  });

  await withServer(service, async (baseUrl) => {
    const invalidCursor = await fetch(
      `${baseUrl}/api/task-center/projects/local-project-1/activity?after=-1`,
    );
    assert.equal(invalidCursor.status, 400);
    assert.equal((await invalidCursor.json() as { code: string }).code, 'INVALID_PROJECT_ACTIVITY_QUERY');

    const invalidLimit = await fetch(
      `${baseUrl}/api/task-center/projects/local-project-1/activity?limit=201`,
    );
    assert.equal(invalidLimit.status, 400);

    const invalidWindow = await fetch(
      `${baseUrl}/api/task-center/projects/local-project-1/metrics?windowHours=2161`,
    );
    assert.equal(invalidWindow.status, 400);
    assert.equal((await invalidWindow.json() as { code: string }).code, 'INVALID_PROJECT_METRICS_WINDOW');
  });
});

test('LOST retry route requires an authenticated actor', async () => {
  const service = createTaskCenterGatewayService({
    getProjectById: () => null,
    getRuntimeDeliveryHealth: () => healthyRuntime,
  });

  await withServer(service, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/task-center/projects/local-project-1/tasks/task-1/retry-lost`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    );
    assert.equal(response.status, 401);
    assert.equal((await response.json() as { code: string }).code, 'AUTH_USER_REQUIRED');
  });
});

test('daily execution command routes reject an unauthenticated browser actor', async () => {
  const service = createTaskCenterGatewayService({
    getProjectById: () => null,
    getRuntimeDeliveryHealth: () => healthyRuntime,
  });
  const commands = [
    { path: 'cancel', body: {} },
    { path: 'retry', body: {} },
    { path: 'archive', body: { reason: '归档历史' } },
    {
      path: 'follow-ups',
      body: {
        parentAttemptId: 'attempt-1', clientRequestId: 'follow-up-1',
        feedback: '继续处理', requestedAcceptance: '测试通过',
      },
    },
    {
      path: 'acceptance',
      body: {
        attemptId: 'attempt-1', clientRequestId: 'acceptance-1',
        decision: 'RESOLVED', reason: '证据已复核',
      },
    },
    {
      path: 'approvals/approval-1/decision',
      body: { decision: 'APPROVED' },
    },
  ];

  await withServer(service, async (baseUrl) => {
    for (const command of commands) {
      const response = await fetch(
        `${baseUrl}/api/task-center/projects/local-project-1/tasks/task-1/${command.path}`,
        {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(command.body),
        },
      );
      assert.equal(response.status, 401);
      assert.equal((await response.json() as { code: string }).code, 'AUTH_USER_REQUIRED');
    }
  });
});

test('Work Order claim and Verification routes require an authenticated actor', async () => {
  const service = createTaskCenterGatewayService({
    getProjectById: () => null,
    getRuntimeDeliveryHealth: () => healthyRuntime,
  });

  await withServer(service, async (baseUrl) => {
    const claim = await fetch(
      `${baseUrl}/api/task-center/projects/local-project-1/work-orders/claims`,
      {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: 'plan-1', nodeKey: 'node-1', clientRequestId: 'claim-1' }),
      },
    );
    assert.equal(claim.status, 401);
    assert.equal((await claim.json() as { code: string }).code, 'AUTH_USER_REQUIRED');

    const verification = await fetch(
      `${baseUrl}/api/task-center/projects/local-project-1/work-orders/work-order-1/verifications`,
      {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId: 'report-1', decision: 'PASSED', reason: 'Reviewed' }),
      },
    );
    assert.equal(verification.status, 401);
    assert.equal((await verification.json() as { code: string }).code, 'AUTH_USER_REQUIRED');
  });
});

test('Parallel Schedule command routes require an authenticated actor', async () => {
  const service = createTaskCenterGatewayService({
    getProjectById: () => null,
    getRuntimeDeliveryHealth: () => healthyRuntime,
  });
  const commands = [
    {
      path: '/plans/plan-1/parallel-schedules',
      body: {
        clientRequestId: 'parallel-create-1', baseStateRevision: 2,
        basePlanVersion: 1, nodeKeys: ['alpha', 'beta'],
      },
    },
    {
      path: '/plans/plan-1/parallel-schedules/schedule-1/confirm',
      body: { clientRequestId: 'parallel-confirm-1' },
    },
    {
      path: '/plans/plan-1/parallel-schedules/schedule-1/reject',
      body: { clientRequestId: 'parallel-reject-1', reason: 'Replan scopes' },
    },
    {
      path: '/plans/plan-1/parallel-schedules/schedule-1/workspace-leases/lease-1/provision',
      body: { clientRequestId: 'parallel-provision-1' },
    },
    {
      path: '/plans/plan-1/parallel-schedules/schedule-1/dispatch',
      body: { clientRequestId: 'parallel-dispatch-1' },
    },
  ];

  await withServer(service, async (baseUrl) => {
    for (const command of commands) {
      const response = await fetch(
        `${baseUrl}/api/task-center/projects/local-project-1${command.path}`,
        {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(command.body),
        },
      );
      assert.equal(response.status, 401);
      assert.equal((await response.json() as { code: string }).code, 'AUTH_USER_REQUIRED');
    }
  });
});

test('Integration Gate command routes require an authenticated actor', async () => {
  const service = createTaskCenterGatewayService({
    getProjectById: () => null,
    getRuntimeDeliveryHealth: () => healthyRuntime,
  });
  const commands = [
    {
      path: '/plans/plan-1/integration-gates',
      body: {
        clientRequestId: 'gate-create-1', scheduleId: 'schedule-1',
        baseStateRevision: 2, basePlanVersion: 1, evidenceReferenceIds: [],
      },
    },
    {
      path: '/plans/plan-1/integration-gates/gate-1/confirm',
      body: { clientRequestId: 'gate-confirm-1' },
    },
    {
      path: '/plans/plan-1/integration-gates/gate-1/reject',
      body: { clientRequestId: 'gate-reject-1', reason: 'Needs evidence' },
    },
    {
      path: '/plans/plan-1/integration-gates/gate-1/executions',
      body: { clientRequestId: 'integration-execute-1' },
    },
    {
      path: '/plans/plan-1/integration-gates/gate-1/executions/run-1/agent',
      body: { clientRequestId: 'integration-agent-1' },
    },
    {
      path: '/plans/plan-1/integration-gates/gate-1/executions/run-1/finalize',
      body: {
        clientRequestId: 'integration-finalize-1',
        candidateCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    },
  ];

  await withServer(service, async (baseUrl) => {
    for (const command of commands) {
      const response = await fetch(
        `${baseUrl}/api/task-center/projects/local-project-1${command.path}`,
        {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(command.body),
        },
      );
      assert.equal(response.status, 401);
      assert.equal((await response.json() as { code: string }).code, 'AUTH_USER_REQUIRED');
    }
  });
});

test('Parallel Schedule proposal route requires current versions and exactly two distinct nodes', async () => {
  const service = createTaskCenterGatewayService({
    getProjectById: () => null,
    getRuntimeDeliveryHealth: () => healthyRuntime,
  });
  const invalidBodies = [
    { clientRequestId: 'request-1', baseStateRevision: -1, basePlanVersion: 1, nodeKeys: ['a', 'b'] },
    { clientRequestId: 'request-2', baseStateRevision: 0, basePlanVersion: 0, nodeKeys: ['a', 'b'] },
    { clientRequestId: 'request-3', baseStateRevision: 0, basePlanVersion: 1, nodeKeys: ['a', 'a'] },
    { clientRequestId: 'request-4', baseStateRevision: 0, basePlanVersion: 1, nodeKeys: ['a', 'b', 'c'] },
  ];

  await withServer(service, async (baseUrl) => {
    for (const body of invalidBodies) {
      const response = await fetch(
        `${baseUrl}/api/task-center/projects/local-project-1/plans/plan-1/parallel-schedules`,
        {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      assert.equal(response.status, 400);
      assert.equal((await response.json() as { code: string }).code, 'INVALID_PARALLEL_SCHEDULE');
    }
  }, '12');
});

test('Parallel Schedule routes normalize input and forward the authenticated actor', async () => {
  const calls: Array<{
    path: string;
    method: string;
    actor: string | null;
    body: Record<string, unknown> | null;
  }> = [];
  const service = createTaskCenterGatewayService({
    ...secureWorkspaceDependencies,
    getControlPlaneBaseUrl: () => 'http://control.test',
    getProjectById: () => ({
      projectId: 'local-project-1', displayName: 'Demo', projectRef: 'D:\\workspace\\demo',
    }),
    getRuntimeDeliveryHealth: () => healthyRuntime,
    fetch: (async (
      input: Parameters<typeof globalThis.fetch>[0],
      init?: Parameters<typeof globalThis.fetch>[1],
    ) => {
      const url = String(input);
      if (url.includes('/workspaces/resolve?')) {
        return new Response(JSON.stringify({
          schemaVersion: '1.0', resolution: 'MATCHED_BY_LOCAL_PROJECT_ID',
          project: { projectId: 'control-project-1', identityVersion: 1 },
          binding: { workspaceId: 'workspace-1' }, proposal: null,
          executionRegistration: {
            projectId: 'control-project-1', profileId: 'profile-1',
            projectRef: 'D:\\workspace\\demo', profileName: 'Default',
          },
        }), { status: 200 });
      }
      calls.push({
        path: new URL(url).pathname,
        method: init?.method ?? 'GET',
        actor: new Headers(init?.headers).get('X-Zhishu-Actor'),
        body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null,
      });
      return new Response(JSON.stringify({ scheduleId: 'schedule-1' }), {
        status: (init?.method ?? 'GET') === 'GET' ? 200 : 201,
      });
    }) as typeof globalThis.fetch,
  });

  await withServer(service, async (baseUrl) => {
    const root = `${baseUrl}/api/task-center/projects/local-project-1/plans/plan-1/parallel-schedules`;
    assert.equal((await fetch(
      `${baseUrl}/api/task-center/projects/local-project-1/plans/plan-1/capability-matrix`,
    )).status, 200);
    assert.equal((await fetch(
      `${baseUrl}/api/task-center/projects/local-project-1/plans/plan-1/parallel-schedule-candidates`,
    )).status, 200);
    assert.equal((await fetch(
      `${baseUrl}/api/task-center/projects/local-project-1/plans/plan-1/parallel-schedule-recommendation`,
    )).status, 200);
    assert.equal((await fetch(root)).status, 200);
    assert.equal((await fetch(root, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientRequestId: 'create-1', baseStateRevision: 4,
        basePlanVersion: 2, nodeKeys: [' alpha ', 'beta'],
      }),
    })).status, 201);
    assert.equal((await fetch(`${root}/schedule-1/confirm`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientRequestId: 'confirm-1' }),
    })).status, 200);
    assert.equal((await fetch(`${root}/schedule-1/reject`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientRequestId: 'reject-1', reason: 'Replan scopes' }),
    })).status, 200);
    assert.equal((await fetch(`${root}/schedule-1/workspace-leases/lease-1/provision`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientRequestId: 'provision-1' }),
    })).status, 200);
  }, '27');

  assert.deepEqual(calls.map((call) => [call.method, call.actor, call.path]), [
    ['GET', null, '/internal/project-control/v1/projects/control-project-1/plans/plan-1/capability-matrix'],
    ['GET', null, '/internal/project-control/v1/projects/control-project-1/plans/plan-1/parallel-schedule-candidates'],
    ['GET', null, '/internal/project-control/v1/projects/control-project-1/plans/plan-1/parallel-schedule-recommendation'],
    ['GET', null, '/internal/project-control/v1/projects/control-project-1/plans/plan-1/parallel-schedules'],
    ['POST', 'user:27', '/internal/project-control/v1/projects/control-project-1/plans/plan-1/parallel-schedules'],
    ['POST', 'user:27', '/internal/project-control/v1/projects/control-project-1/plans/plan-1/parallel-schedules/schedule-1/confirm'],
    ['POST', 'user:27', '/internal/project-control/v1/projects/control-project-1/plans/plan-1/parallel-schedules/schedule-1/reject'],
    ['POST', 'user:27', '/internal/project-control/v1/projects/control-project-1/plans/plan-1/parallel-schedules/schedule-1/workspace-leases/lease-1/provision'],
  ]);
  assert.deepEqual(calls[4]?.body, {
    clientRequestId: 'create-1', baseStateRevision: 4,
    basePlanVersion: 2, nodeKeys: ['alpha', 'beta'], physicalWorkspaceKind: 'DIRECTORY_ONLY',
  });
  assert.deepEqual(calls[5]?.body, { clientRequestId: 'confirm-1' });
  assert.deepEqual(calls[6]?.body, { clientRequestId: 'reject-1', reason: 'Replan scopes' });
  assert.deepEqual(calls[7]?.body, { clientRequestId: 'provision-1' });
});

test('Integration execution routes forward authenticated Gate, Run, and Profile identities', async () => {
  const calls: Array<{ path: string; actor: string | null; body: Record<string, unknown> | null }> = [];
  const service = createTaskCenterGatewayService({
    ...secureWorkspaceDependencies,
    getControlPlaneBaseUrl: () => 'http://control.test',
    getProjectById: () => ({ projectId: 'local-project-1', displayName: 'Demo', projectRef: 'D:\\workspace\\demo' }),
    getRuntimeDeliveryHealth: () => healthyRuntime,
    fetch: (async (input: Parameters<typeof globalThis.fetch>[0], init?: Parameters<typeof globalThis.fetch>[1]) => {
      const url = String(input);
      if (url.includes('/workspaces/resolve?')) {
        return new Response(JSON.stringify({
          schemaVersion: '1.0', resolution: 'MATCHED_BY_LOCAL_PROJECT_ID',
          project: { projectId: 'control-project-1', identityVersion: 1 },
          binding: { workspaceId: 'workspace-1' }, proposal: null,
          executionRegistration: { projectId: 'control-project-1', profileId: 'profile-1',
            projectRef: 'D:\\workspace\\demo', profileName: 'Default' },
        }), { status: 200 });
      }
      calls.push({
        path: new URL(url).pathname,
        actor: new Headers(init?.headers).get('X-Zhishu-Actor'),
        body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null,
      });
      return new Response(JSON.stringify({ runId: 'run-1', agentRunId: 'agent-1' }), { status: 201 });
    }) as typeof globalThis.fetch,
  });

  await withServer(service, async (baseUrl) => {
    const root = `${baseUrl}/api/task-center/projects/local-project-1/plans/plan-1/integration-gates/gate-1`;
    assert.equal((await fetch(`${root}/executions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientRequestId: 'execute-1' }),
    })).status, 201);
    assert.equal((await fetch(`${root}/executions/run-1/agent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientRequestId: 'agent-1', profileId: 'profile-2' }),
    })).status, 201);
    assert.equal((await fetch(`${root}/executions/run-1/finalize`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientRequestId: 'finalize-1',
        candidateCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      }),
    })).status, 200);
  }, 'integration-user');

  assert.deepEqual(calls, [
    {
      path: '/internal/project-control/v1/projects/control-project-1/plans/plan-1/integration-gates/gate-1/executions',
      actor: 'user:integration-user', body: { clientRequestId: 'execute-1' },
    },
    {
      path: '/internal/project-control/v1/projects/control-project-1/plans/plan-1/integration-gates/gate-1/executions/run-1/agent',
      actor: 'user:integration-user', body: { clientRequestId: 'agent-1', profileId: 'profile-2' },
    },
    {
      path: '/internal/project-control/v1/projects/control-project-1/plans/plan-1/integration-gates/gate-1/executions/run-1/finalize',
      actor: 'user:integration-user',
      body: {
        clientRequestId: 'finalize-1',
        candidateCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    },
  ]);
});

test('Integration finalization route rejects abbreviated or non-hex candidate commits', async () => {
  const service = createTaskCenterGatewayService({
    getProjectById: () => null,
    getRuntimeDeliveryHealth: () => healthyRuntime,
  });

  await withServer(service, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/task-center/projects/local-project-1/plans/plan-1/integration-gates/gate-1/executions/run-1/finalize`,
      {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientRequestId: 'finalize-1', candidateCommit: 'abc123' }),
      },
    );
    assert.equal(response.status, 400);
    assert.equal((await response.json() as { code: string }).code, 'INVALID_INTEGRATION_CANDIDATE');
  }, 'integration-user');
});
