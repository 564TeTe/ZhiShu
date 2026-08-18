import assert from 'node:assert/strict';
import test from 'node:test';

import type { RuntimeEventDeliveryHealth } from '@/shared/types.js';

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
    machineId: 'machine-1',
    localProjectId: 'local-project-1',
    normalizedWorkspacePath: 'D:\\workspace\\demo',
  }),
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function registeredProjectFetch(requests: string[]): typeof globalThis.fetch {
  return (async (input: Parameters<typeof globalThis.fetch>[0]) => {
    const url = String(input);
    requests.push(url);
    const apiUrl = url.replace('/internal/project-control/v1/', '/api/v1/');
    if (url.includes('/internal/project-control/v1/workspaces/resolve?')) {
      return jsonResponse({
        schemaVersion: '1.0', resolution: 'MATCHED_BY_LOCAL_PROJECT_ID',
        project: { projectId: 'control-project-1', identityVersion: 1 },
        binding: { workspaceId: 'workspace-1' }, candidates: [], ambiguityReasons: [], proposal: null,
        executionRegistration: {
          projectId: 'control-project-1', profileId: 'profile-1',
          projectRef: 'D:\\workspace\\demo', profileName: 'Default',
        },
      });
    }
    if (apiUrl.includes('/api/v1/projects/resolve?')) {
      return jsonResponse({
        projectId: 'control-project-1',
        profileId: 'profile-1',
        projectRef: 'D:\\workspace\\demo',
        profileName: 'Default',
      });
    }
    if (apiUrl.includes('/approval-policy')) {
      return jsonResponse({
        projectId: 'control-project-1',
        projectRoot: 'D:\\workspace\\demo',
        mode: 'MANUAL',
        allowedDirectories: ['.'],
        trustedCommands: [],
        approvalTimeoutSeconds: 45,
        updatedAt: '2026-08-15T00:00:00.000Z',
      });
    }
    if (apiUrl.includes('/api/v1/tasks?')) {
      return jsonResponse([
        {
          taskId: 'task-1',
          projectId: 'control-project-1',
          profileId: 'profile-1',
          title: '等待审批的任务',
          objective: '验证只读聚合',
          status: 'WAITING_APPROVAL',
          attemptStatus: 'WAITING_APPROVAL',
          resolutionStatus: 'IN_PROGRESS',
          attemptId: 'attempt-1',
          attemptNumber: 1,
          runtimeRunId: 'run-1',
          createdAt: '2026-08-15T00:00:00.000Z',
          startedAt: '2026-08-15T00:00:01.000Z',
          completedAt: null,
          errorCode: null,
          errorMessage: null,
        },
      ]);
    }
    if (apiUrl.endsWith('/approvals')) {
      return jsonResponse([{
        id: 'approval-1',
        taskId: 'task-1',
        attemptId: 'attempt-1',
        toolName: 'Write',
        riskLevel: 'HIGH',
        status: 'PENDING',
        expiresAt: '2026-08-15T00:01:00.000Z',
        createdAt: '2026-08-15T00:00:10.000Z',
      }]);
    }
    if (apiUrl.endsWith('/artifacts')) {
      return jsonResponse([{
        id: 'artifact-1',
        taskId: 'task-1',
        attemptId: 'attempt-1',
        artifactType: 'SUMMARY',
        producer: 'runtime',
        contentPlain: '已完成第一步分析。',
        createdAt: '2026-08-15T00:00:09.000Z',
      }]);
    }
    if (apiUrl.endsWith('/follow-ups')) return jsonResponse([]);
    return jsonResponse({ message: 'unexpected request' }, 500);
  }) as typeof globalThis.fetch;
}

test('dashboard aggregates bounded read-only execution facts', async () => {
  const requests: string[] = [];
  const service = createTaskCenterGatewayService({
    ...secureWorkspaceDependencies,
    fetch: registeredProjectFetch(requests),
    getControlPlaneBaseUrl: () => 'http://control.test',
    getProjectById: () => ({
      projectId: 'local-project-1',
      displayName: 'Demo',
      projectRef: 'D:\\workspace\\demo',
    }),
    getRuntimeDeliveryHealth: () => healthyRuntime,
    now: () => Date.parse('2026-08-15T00:00:20.000Z'),
  });

  const dashboard = await service.getDashboard('local-project-1');

  assert.equal(dashboard.availability, 'ready');
  assert.equal(dashboard.project.controlProjectId, 'control-project-1');
  assert.equal(dashboard.summary.totalTasks, 1);
  assert.equal(dashboard.summary.waitingApproval, 1);
  assert.equal(dashboard.approvals.length, 1);
  assert.equal(dashboard.recentArtifacts[0]?.contentExcerpt, '已完成第一步分析。');
  assert.equal(requests.length, 6);
  assert.ok(requests.every((request) => !request.includes('/ensure')));
});

test('task history keeps pagination and archive metadata inside the stable project boundary', async () => {
  const requests: string[] = [];
  const service = createTaskCenterGatewayService({
    ...secureWorkspaceDependencies,
    getControlPlaneBaseUrl: () => 'http://control.test',
    getProjectById: () => ({
      projectId: 'local-project-1', displayName: 'Demo', projectRef: 'D:\\workspace\\demo',
    }),
    getRuntimeDeliveryHealth: () => healthyRuntime,
    fetch: (async (input: Parameters<typeof globalThis.fetch>[0]) => {
      const url = String(input);
      requests.push(url);
      if (url.includes('/workspaces/resolve?')) {
        return jsonResponse({
          schemaVersion: '1.0', resolution: 'MATCHED_BY_LOCAL_PROJECT_ID',
          project: { projectId: 'control-project-1', identityVersion: 1 },
          binding: { workspaceId: 'workspace-1' }, proposal: null,
          executionRegistration: {
            projectId: 'control-project-1', profileId: 'profile-1',
            projectRef: 'D:\\workspace\\demo', profileName: 'Default',
          },
        });
      }
      if (url.includes('/projects/control-project-1/tasks?')) {
        return jsonResponse({
          items: [{
            taskId: 'task-1', projectId: 'control-project-1', profileId: 'profile-1',
            title: 'Archived task', objective: 'Trace it', status: 'SUCCEEDED',
            resolutionStatus: 'RESOLVED', createdAt: '2026-08-15T00:00:00.000Z',
            archivedAt: '2026-08-15T01:00:00.000Z', archivedBy: 'user:7', archiveReason: 'Complete',
          }],
          nextCursor: 'next-page', hasMore: true,
        });
      }
      return jsonResponse({ message: 'unexpected request' }, 500);
    }) as typeof globalThis.fetch,
  });

  const page = await service.listTaskHistory('local-project-1', {
    archive: 'ARCHIVED', status: 'SUCCEEDED', resolutionStatus: 'RESOLVED',
    search: 'Trace', cursor: 'cursor-1', limit: 20,
  });

  assert.equal(page.items[0]?.archivedBy, 'user:7');
  assert.equal(page.nextCursor, 'next-page');
  const forwarded = new URL(requests[1] as string);
  assert.equal(forwarded.searchParams.get('archive'), 'ARCHIVED');
  assert.equal(forwarded.searchParams.get('resolutionStatus'), 'RESOLVED');
  assert.equal(forwarded.searchParams.get('cursor'), 'cursor-1');
});

test('project activity and metrics stay inside the resolved control project boundary', async () => {
  const requests: string[] = [];
  const service = createTaskCenterGatewayService({
    ...secureWorkspaceDependencies,
    getControlPlaneBaseUrl: () => 'http://control.test',
    getProjectById: () => ({
      projectId: 'local-project-1', displayName: 'Demo', projectRef: 'D:\\workspace\\demo',
    }),
    getRuntimeDeliveryHealth: () => healthyRuntime,
    fetch: (async (input: Parameters<typeof globalThis.fetch>[0]) => {
      const url = String(input);
      requests.push(url);
      if (url.includes('/workspaces/resolve?')) {
        return jsonResponse({
          schemaVersion: '1.0', resolution: 'MATCHED_BY_LOCAL_PROJECT_ID',
          project: { projectId: 'control-project-1', identityVersion: 1 },
          binding: { workspaceId: 'workspace-1' }, proposal: null,
          executionRegistration: {
            projectId: 'control-project-1', profileId: 'profile-1',
            projectRef: 'D:\\workspace\\demo', profileName: 'Default',
          },
        });
      }
      if (url.includes('/projects/control-project-1/activity?')) {
        return jsonResponse({
          schemaVersion: '1.0', projectId: 'control-project-1', status: 'READY',
          requestedAfterCursor: 41, latestCursor: 42, retentionFloorCursor: 10,
          nextCursor: 42, hasMore: false,
          events: [{
            cursor: 42, eventId: 'event-1', projectId: 'control-project-1',
            changeType: 'TASK_UPDATED', resourceType: 'TASK', resourceId: 'task-1',
            taskId: 'task-1', attemptId: 'attempt-1', sourceEventId: null,
            occurredAt: '2026-08-15T00:00:00.000Z',
          }],
        });
      }
      if (url.includes('/projects/control-project-1/metrics?')) {
        return jsonResponse({
          schemaVersion: '1.0', projectId: 'control-project-1', windowHours: 168,
          generatedAt: '2026-08-15T00:00:00.000Z',
          attempts: {
            total: 2, terminal: 1, succeeded: 0, failed: 1, lost: 0, aborted: 0,
            active: 1, unknownHealth: 0, lostHealth: 0, failureRate: 1,
            p50DurationMs: 1000, p95DurationMs: 1000,
          },
          tokens: { brainRuns: 1, inputTokens: 7, outputTokens: 8, totalTokens: 15 },
          activity: {
            eventCount: 3, latestCursor: 42, retentionFloorCursor: 10,
            latestEventAt: '2026-08-15T00:00:00.000Z', latestEventLagMs: 100,
          },
        });
      }
      return jsonResponse({ message: 'unexpected request' }, 500);
    }) as typeof globalThis.fetch,
  });

  const activity = await service.getProjectActivity('local-project-1', { after: 41, limit: 50 });
  const metrics = await service.getProjectMetrics('local-project-1', 168);

  assert.equal(activity.events[0]?.cursor, 42);
  assert.equal(metrics.tokens.totalTokens, 15);
  assert.ok(requests.some((url) => url.includes('/activity?limit=50&after=41')));
  assert.ok(requests.some((url) => url.endsWith('/metrics?windowHours=168')));
});

test('dashboard uses the service credential for machine-scoped workspace resolution', async () => {
  const requests: string[] = [];
  const authorizations: Array<string | null> = [];
  const fallbackFetch = registeredProjectFetch(requests);
  const service = createTaskCenterGatewayService({
    ...secureWorkspaceDependencies,
    fetch: (async (
      input: Parameters<typeof globalThis.fetch>[0],
      init?: Parameters<typeof globalThis.fetch>[1],
    ) => {
      const url = String(input);
      if (url.includes('/internal/project-control/v1/')) {
        authorizations.push(new Headers(init?.headers).get('Authorization'));
      }
      if (url.includes('/internal/project-control/v1/workspaces/resolve?')) {
        requests.push(url);
        return jsonResponse({
          schemaVersion: '1.0',
          resolution: 'MATCHED_BY_LOCAL_PROJECT_ID',
          project: { projectId: 'control-project-1' },
          binding: { workspaceId: 'workspace-1' },
          candidates: [],
          ambiguityReasons: [],
          proposal: null,
          executionRegistration: {
            projectId: 'control-project-1',
            profileId: 'profile-1',
            projectRef: 'D:\\workspace\\demo',
            profileName: 'Default',
          },
        });
      }
      return fallbackFetch(input, init);
    }) as typeof globalThis.fetch,
    getControlPlaneBaseUrl: () => 'http://control.test',
    getProjectControlToken: () => 'project-control-secret',
    getProjectById: () => ({
      projectId: 'local-project-1',
      displayName: 'Demo',
      projectRef: 'D:\\workspace\\demo',
    }),
    getWorkspaceObservation: () => ({
      machineId: 'machine-1',
      localProjectId: 'local-project-1',
      normalizedWorkspacePath: 'D:\\workspace\\demo',
    }),
    getRuntimeDeliveryHealth: () => healthyRuntime,
    now: () => Date.parse('2026-08-15T00:00:20.000Z'),
  });

  const dashboard = await service.getDashboard('local-project-1');

  assert.equal(dashboard.availability, 'ready');
  assert.ok(authorizations.length > 1);
  assert.ok(authorizations.every((value) => value === 'Bearer project-control-secret'));
  assert.ok(requests[0]?.includes('machineId=machine-1'));
  assert.ok(requests.every((request) => !request.includes('/api/v1/')));
});

test('workspace confirmation revalidates the proposal and forwards actor plus idempotency data', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const resolution = {
    schemaVersion: '1.0',
    resolution: 'PROPOSAL_REQUIRED',
    project: { projectId: 'control-project-1', identityVersion: 1 },
    binding: { workspaceId: 'workspace-1' },
    candidates: [],
    ambiguityReasons: [],
    proposal: {
      proposalId: 'proposal-1',
      action: 'MOVE_WORKSPACE',
      machineId: 'machine-1',
      localProjectId: 'local-project-1',
      workspacePath: 'D:\\workspace\\demo-moved',
      targetProjectId: 'control-project-1',
      baseIdentityVersion: 1,
      status: 'PENDING',
    },
    executionRegistration: {
      projectId: 'control-project-1', profileId: 'profile-1',
      projectRef: 'D:\\workspace\\demo', profileName: 'Default',
    },
  };
  const service = createTaskCenterGatewayService({
    fetch: (async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
      requests.push({ url: String(input), init });
      if (init?.method === 'POST') {
        return jsonResponse({ changeId: 'change-1', resultingIdentityVersion: 2 });
      }
      return jsonResponse(resolution);
    }) as typeof globalThis.fetch,
    getControlPlaneBaseUrl: () => 'http://control.test',
    getProjectControlToken: () => 'project-control-secret',
    getProjectById: () => ({
      projectId: 'local-project-1', displayName: 'Demo', projectRef: 'D:\\workspace\\demo-moved',
    }),
    getWorkspaceObservation: () => ({
      machineId: 'machine-1', localProjectId: 'local-project-1',
      normalizedWorkspacePath: 'D:\\workspace\\demo-moved',
    }),
  });

  const result = await service.confirmWorkspaceBinding('local-project-1', 'user:7', {
    workspaceId: 'workspace-1',
    proposalId: 'proposal-1',
    action: 'MOVE_WORKSPACE',
    machineId: 'machine-1',
    localProjectId: 'local-project-1',
    workspacePath: 'D:\\workspace\\demo-moved',
    baseIdentityVersion: 1,
    clientRequestId: 'request-1',
  }) as { changeId: string };

  assert.equal(result.changeId, 'change-1');
  assert.equal(requests.length, 2);
  assert.equal(requests[1]?.init?.method, 'POST');
  const headers = new Headers(requests[1]?.init?.headers);
  assert.equal(headers.get('Authorization'), 'Bearer project-control-secret');
  assert.equal(headers.get('X-Zhishu-Actor'), 'user:7');
  assert.match(String(requests[1]?.init?.body), /"clientRequestId":"request-1"/);
});

test('dashboard reports an unregistered project without creating it', async () => {
  const requests: string[] = [];
  const service = createTaskCenterGatewayService({
    ...secureWorkspaceDependencies,
    fetch: (async (input: Parameters<typeof globalThis.fetch>[0]) => {
      requests.push(String(input));
      return jsonResponse({ code: 'PROJECT_REGISTRATION_NOT_FOUND', message: 'not found' }, 404);
    }) as typeof globalThis.fetch,
    getControlPlaneBaseUrl: () => 'http://control.test',
    getProjectById: () => ({
      projectId: 'local-project-1',
      displayName: 'Demo',
      projectRef: 'D:\\workspace\\demo',
    }),
    getRuntimeDeliveryHealth: () => healthyRuntime,
    now: () => 0,
  });

  const dashboard = await service.getDashboard('local-project-1');

  assert.equal(dashboard.availability, 'unavailable');
  assert.equal(dashboard.unavailableReason, 'PROJECT_NOT_REGISTERED');
  assert.equal(requests.length, 1);
  assert.ok(requests.every((request) => !request.includes('/ensure')));
});

test('project registration bootstraps the catalog and re-resolves workspace identity', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const service = createTaskCenterGatewayService({
    ...secureWorkspaceDependencies,
    fetch: (async (
      input: Parameters<typeof globalThis.fetch>[0],
      init?: Parameters<typeof globalThis.fetch>[1],
    ) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith('/api/v1/projects/ensure')) {
        return jsonResponse({
          projectId: 'control-project-1', profileId: 'profile-1',
          projectRef: 'D:\\workspace\\demo', profileName: 'Default',
        });
      }
      if (url.includes('/internal/project-control/v1/workspaces/resolve?')) {
        return jsonResponse({
          schemaVersion: '1.0', resolution: 'MATCHED_BY_WORKSPACE_PATH',
          project: { projectId: 'control-project-1', identityVersion: 1 },
          binding: { workspaceId: 'workspace-1' }, candidates: [], ambiguityReasons: [], proposal: null,
          executionRegistration: {
            projectId: 'control-project-1', profileId: 'profile-1',
            projectRef: 'D:\\workspace\\demo', profileName: 'Default',
          },
        });
      }
      return jsonResponse({ message: 'unexpected request' }, 500);
    }) as typeof globalThis.fetch,
    getControlPlaneBaseUrl: () => 'http://control.test',
    getProjectById: () => ({
      projectId: 'local-project-1', displayName: 'Demo', projectRef: 'D:\\workspace\\demo',
    }),
    getRuntimeDeliveryHealth: () => healthyRuntime,
  });

  const resolution = await service.registerProject('local-project-1', 'user:7');

  assert.equal(resolution.executionRegistration?.projectId, 'control-project-1');
  assert.equal(requests.length, 2);
  const ensureRequest = requests[0];
  assert.equal(ensureRequest.url, 'http://control.test/api/v1/projects/ensure');
  assert.equal(ensureRequest.init?.method, 'POST');
  const headers = new Headers(ensureRequest.init?.headers);
  assert.equal(headers.get('X-Zhishu-Actor'), 'user:7');
  assert.equal(headers.get('Authorization'), null);
  assert.match(String(ensureRequest.init?.body), /"candidateProjectId":"local-project-1"/);
});

test('dashboard fails closed when the Project Control credential is missing', async () => {
  let requests = 0;
  const service = createTaskCenterGatewayService({
    fetch: (async () => { requests += 1; return jsonResponse({}); }) as typeof globalThis.fetch,
    getControlPlaneBaseUrl: () => 'http://control.test',
    getProjectControlToken: () => null,
    getProjectById: () => ({
      projectId: 'local-project-1', displayName: 'Demo', projectRef: 'D:\\workspace\\demo',
    }),
    getRuntimeDeliveryHealth: () => healthyRuntime,
    now: () => 0,
  });

  const dashboard = await service.getDashboard('local-project-1');

  assert.equal(dashboard.availability, 'unavailable');
  assert.equal(dashboard.unavailableReason, 'CONTROL_PLANE_UNAVAILABLE');
  assert.equal(requests, 0);
});

test('dashboard preserves core task data when one detail source fails', async () => {
  const requests: string[] = [];
  const baseFetch = registeredProjectFetch(requests);
  const service = createTaskCenterGatewayService({
    ...secureWorkspaceDependencies,
    fetch: (async (
      input: Parameters<typeof globalThis.fetch>[0],
      init?: Parameters<typeof globalThis.fetch>[1],
    ) => {
      if (String(input).endsWith('/artifacts')) {
        requests.push(String(input));
        return jsonResponse({ message: 'temporarily unavailable' }, 503);
      }
      return baseFetch(input, init);
    }) as typeof globalThis.fetch,
    getControlPlaneBaseUrl: () => 'http://control.test',
    getProjectById: () => ({
      projectId: 'local-project-1',
      displayName: 'Demo',
      projectRef: 'D:\\workspace\\demo',
    }),
    getRuntimeDeliveryHealth: () => healthyRuntime,
    now: () => 0,
  });

  const dashboard = await service.getDashboard('local-project-1');

  assert.equal(dashboard.availability, 'partial');
  assert.equal(dashboard.tasks.length, 1);
  assert.equal(dashboard.recentArtifacts.length, 0);
  assert.ok(dashboard.warnings.some((warning) => warning.code === 'TASK_DETAIL_PARTIAL'));
});

function taskDetailFetch(
  requests: string[],
  projectId = 'control-project-1',
  responses: Partial<Record<'attempts' | 'approvals' | 'artifacts' | 'follow-ups', unknown>> = {},
): typeof globalThis.fetch {
  return (async (input: Parameters<typeof globalThis.fetch>[0]) => {
    const url = String(input);
    requests.push(url);
    const apiUrl = url.replace('/internal/project-control/v1/', '/api/v1/');
    if (url.includes('/internal/project-control/v1/workspaces/resolve?')) {
      return jsonResponse({
        schemaVersion: '1.0', resolution: 'MATCHED_BY_LOCAL_PROJECT_ID',
        project: { projectId: 'control-project-1', identityVersion: 1 },
        binding: { workspaceId: 'workspace-1' }, candidates: [], ambiguityReasons: [], proposal: null,
        executionRegistration: {
          projectId: 'control-project-1', profileId: 'profile-1',
          projectRef: 'D:\\workspace\\demo', profileName: 'Default',
        },
      });
    }
    if (url.endsWith('/internal/project-control/v1/projects/control-project-1/tasks/task-1')) {
      return jsonResponse({
        taskId: 'task-1',
        projectId,
        profileId: 'profile-1',
        title: '只读详情',
        objective: '验证项目归属和执行历史',
        status: 'SUCCEEDED',
        attemptStatus: 'SUCCEEDED',
        resolutionStatus: 'WAITING_ACCEPTANCE',
        attemptId: 'attempt-2',
        attemptNumber: 2,
        runtimeRunId: 'run-2',
        createdAt: '2026-08-15T00:00:00.000Z',
        completedAt: '2026-08-15T00:10:00.000Z',
      });
    }
    for (const source of ['attempts', 'approvals', 'artifacts', 'follow-ups'] as const) {
      if (url.endsWith(`/${source}`)) return jsonResponse(responses[source] ?? []);
    }
    return jsonResponse({ message: 'unexpected request' }, 500);
  }) as typeof globalThis.fetch;
}

function taskDetailService(fetch: typeof globalThis.fetch) {
  return createTaskCenterGatewayService({
    ...secureWorkspaceDependencies,
    fetch,
    getControlPlaneBaseUrl: () => 'http://control.test',
    getProjectById: () => ({
      projectId: 'local-project-1',
      displayName: 'Demo',
      projectRef: 'D:\\workspace\\demo',
    }),
    getRuntimeDeliveryHealth: () => healthyRuntime,
    now: () => Date.parse('2026-08-15T00:20:00.000Z'),
  });
}

test('task detail rejects a task from another Control Plane project before fan-out', async () => {
  const requests: string[] = [];
  const service = taskDetailService(taskDetailFetch(requests, 'another-control-project'));

  await assert.rejects(
    () => service.getTaskDetail('local-project-1', 'task-1'),
    (error: unknown) => error instanceof Error
      && 'code' in error
      && error.code === 'TASK_PROJECT_MISMATCH',
  );
  assert.equal(requests.length, 2);
  assert.ok(requests.every((request) => !request.endsWith('/attempts')));
});

test('task detail preserves a valid empty execution history', async () => {
  const requests: string[] = [];
  const service = taskDetailService(taskDetailFetch(requests));

  const detail = await service.getTaskDetail('local-project-1', 'task-1');

  assert.equal(detail.availability, 'ready');
  assert.deepEqual(detail.attempts, []);
  assert.deepEqual(detail.approvals, []);
  assert.deepEqual(detail.artifacts, []);
  assert.deepEqual(detail.followUps, []);
  assert.equal(requests.length, 6);
});

test('task detail degrades one failed source without discarding the task', async () => {
  const requests: string[] = [];
  const baseFetch = taskDetailFetch(requests);
  const service = taskDetailService((async (
    input: Parameters<typeof globalThis.fetch>[0],
    init?: Parameters<typeof globalThis.fetch>[1],
  ) => {
    if (String(input).endsWith('/artifacts')) {
      requests.push(String(input));
      return jsonResponse({ message: 'temporarily unavailable' }, 503);
    }
    return baseFetch(input, init);
  }) as typeof globalThis.fetch);

  const detail = await service.getTaskDetail('local-project-1', 'task-1');

  assert.equal(detail.availability, 'partial');
  assert.equal(detail.task.taskId, 'task-1');
  assert.deepEqual(detail.artifacts, []);
  assert.ok(detail.warnings.some((warning) => warning.message.includes('Artifact')));
});

test('task detail maps Acceptance snapshots on attempts and Follow-up history', async () => {
  const requests: string[] = [];
  const service = taskDetailService(taskDetailFetch(requests, 'control-project-1', {
    attempts: [{
      attemptId: 'attempt-2',
      attemptNumber: 2,
      runtimeRunId: 'run-2',
      status: 'SUCCEEDED',
      executor: 'codex',
      modelAlias: 'gpt-5',
      createdAt: '2026-08-15T00:05:00.000Z',
      acceptanceDecision: 'NEEDS_FOLLOW_UP',
      acceptanceReason: '还需补充边界测试',
      acceptanceAt: '2026-08-15T00:12:00.000Z',
    }],
    'follow-ups': [{
      id: 'follow-up-1',
      taskId: 'task-1',
      parentAttemptId: 'attempt-1',
      attemptId: 'attempt-2',
      clientRequestId: 'follow-up-request-1',
      actor: 'user',
      feedback: '补充跨项目读取测试',
      requestedAcceptance: '验证归属保护',
      additionalContext: {},
      attemptNumber: 2,
      attemptStatus: 'SUCCEEDED',
      acceptanceDecision: 'RESOLVED',
      acceptanceReason: '测试已通过',
      acceptanceAt: '2026-08-15T00:18:00.000Z',
      createdAt: '2026-08-15T00:04:00.000Z',
    }],
  }));

  const detail = await service.getTaskDetail('local-project-1', 'task-1');

  assert.equal(detail.attempts[0]?.acceptanceDecision, 'NEEDS_FOLLOW_UP');
  assert.equal(detail.attempts[0]?.acceptanceReason, '还需补充边界测试');
  assert.equal(detail.followUps[0]?.acceptanceDecision, 'RESOLVED');
  assert.equal(detail.followUps[0]?.requestedAcceptance, '验证归属保护');
});

test('LOST recovery validates ownership and forwards one authenticated retry command', async () => {
  const calls: Array<{ url: string; method: string; actor: string | null }> = [];
  const service = createTaskCenterGatewayService({
    ...secureWorkspaceDependencies,
    getControlPlaneBaseUrl: () => 'http://control.test',
    getProjectById: () => ({
      projectId: 'local-project-1', displayName: 'Demo', projectRef: 'D:\\workspace\\demo',
    }),
    getRuntimeDeliveryHealth: () => healthyRuntime,
    fetch: (async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/workspaces/resolve?')) {
        return jsonResponse({
          schemaVersion: '1.0', resolution: 'MATCHED_BY_LOCAL_PROJECT_ID',
          project: { projectId: 'control-project-1', identityVersion: 1 },
          binding: { workspaceId: 'workspace-1' }, proposal: null,
          executionRegistration: {
            projectId: 'control-project-1', profileId: 'profile-1',
            projectRef: 'D:\\workspace\\demo', profileName: 'Default',
          },
        });
      }
      calls.push({
        url, method: init?.method ?? 'GET', actor: new Headers(init?.headers).get('X-Zhishu-Actor'),
      });
      if (url.endsWith('/internal/project-control/v1/tasks/task-1') && !init?.method) {
        return jsonResponse({ taskId: 'task-1', projectId: 'control-project-1', status: 'LOST' });
      }
      if (url.endsWith('/internal/project-control/v1/tasks/task-1/retry') && init?.method === 'POST') {
        return jsonResponse({ taskId: 'task-1', status: 'STARTING', attemptNumber: 2 }, 202);
      }
      return jsonResponse({ message: 'unexpected request' }, 500);
    }) as typeof globalThis.fetch,
  });

  const result = await service.retryLostTask('local-project-1', 'task-1', 'user:7') as {
    attemptNumber: number;
  };

  assert.equal(result.attemptNumber, 2);
  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.method, 'POST');
  assert.equal(calls[1]?.actor, 'user:7');
});

test('LOST recovery rejects a live task before sending a retry command', async () => {
  const requests: string[] = [];
  const baseFetch = taskDetailFetch(requests);
  const service = taskDetailService((async (
    input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit,
  ) => {
    const url = String(input);
    if (url.endsWith('/internal/project-control/v1/tasks/task-1')) {
      requests.push(url);
      return jsonResponse({ taskId: 'task-1', projectId: 'control-project-1', status: 'RUNNING' });
    }
    return baseFetch(input, init);
  }) as typeof globalThis.fetch);

  await assert.rejects(
    () => service.retryLostTask('local-project-1', 'task-1', 'user:7'),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'TASK_NOT_LOST',
  );
  assert.equal(requests.filter((url) => url.endsWith('/retry')).length, 0);
});

test('daily execution commands validate ownership and forward the authenticated actor', async () => {
  const commands: Array<{
    path: string;
    actor: string | null;
    body: Record<string, unknown> | null;
  }> = [];
  let taskStatus = 'RUNNING';
  let resolutionStatus = 'IN_PROGRESS';
  const service = createTaskCenterGatewayService({
    ...secureWorkspaceDependencies,
    getControlPlaneBaseUrl: () => 'http://control.test',
    getProjectById: () => ({
      projectId: 'local-project-1', displayName: 'Demo', projectRef: 'D:\\workspace\\demo',
    }),
    getRuntimeDeliveryHealth: () => healthyRuntime,
    fetch: (async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/workspaces/resolve?')) {
        return jsonResponse({
          schemaVersion: '1.0', resolution: 'MATCHED_BY_LOCAL_PROJECT_ID',
          project: { projectId: 'control-project-1', identityVersion: 1 },
          binding: { workspaceId: 'workspace-1' }, proposal: null,
          executionRegistration: {
            projectId: 'control-project-1', profileId: 'profile-1',
            projectRef: 'D:\\workspace\\demo', profileName: 'Default',
          },
        });
      }
      if (url.endsWith('/internal/project-control/v1/tasks/task-1') && !init?.method) {
        return jsonResponse({
          taskId: 'task-1', projectId: 'control-project-1', status: taskStatus,
          attemptStatus: taskStatus, resolutionStatus, attemptId: 'attempt-1',
        });
      }
      if (url.endsWith('/internal/project-control/v1/projects/control-project-1/tasks/task-1') && !init?.method) {
        return jsonResponse({
          taskId: 'task-1', projectId: 'control-project-1', status: taskStatus,
          attemptStatus: taskStatus, resolutionStatus, attemptId: 'attempt-1',
        });
      }
      if (url.endsWith('/internal/project-control/v1/tasks/task-1/approvals') && !init?.method) {
        return jsonResponse([{
          id: 'approval-1', taskId: 'task-1', attemptId: 'attempt-1',
          runtimeRunId: 'run-1', runtimeApprovalId: 'runtime-approval-1',
          toolName: 'Write', toolInput: {}, status: 'PENDING', attemptStatus: 'WAITING_APPROVAL',
          createdAt: '2026-08-15T00:00:00.000Z',
        }]);
      }
      if (init?.method === 'POST') {
        commands.push({
          path: new URL(url).pathname,
          actor: new Headers(init.headers).get('X-Zhishu-Actor'),
          body: init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null,
        });
        return jsonResponse({ taskId: 'task-1' }, url.endsWith('/acceptance') ? 200 : 202);
      }
      return jsonResponse({ message: 'unexpected request' }, 500);
    }) as typeof globalThis.fetch,
  });

  await service.cancelTask('local-project-1', 'task-1', 'user:7');
  taskStatus = 'FAILED';
  await service.retryTask('local-project-1', 'task-1', 'user:7');
  taskStatus = 'SUCCEEDED';
  resolutionStatus = 'WAITING_ACCEPTANCE';
  await service.createTaskFollowUp('local-project-1', 'task-1', 'user:7', {
    parentAttemptId: 'attempt-1', clientRequestId: 'follow-up-1',
    feedback: '补充边界验证', requestedAcceptance: '定向测试通过',
  });
  await service.acceptTaskResult('local-project-1', 'task-1', 'user:7', {
    attemptId: 'attempt-1', clientRequestId: 'acceptance-1',
    decision: 'RESOLVED', reason: '证据已复核',
  });
  taskStatus = 'WAITING_APPROVAL';
  resolutionStatus = 'IN_PROGRESS';
  await service.decideTaskApproval(
    'local-project-1', 'task-1', 'approval-1', 'user:7', 'APPROVED', '允许写入',
  );
  taskStatus = 'SUCCEEDED';
  resolutionStatus = 'RESOLVED';
  await service.archiveTask('local-project-1', 'task-1', 'user:7', '长期历史已保留');

  assert.deepEqual(commands.map((command) => command.path), [
    '/internal/project-control/v1/tasks/task-1/cancel',
    '/internal/project-control/v1/tasks/task-1/retry',
    '/internal/project-control/v1/tasks/task-1/follow-ups',
    '/internal/project-control/v1/tasks/task-1/acceptance',
    '/internal/project-control/v1/approvals/approval-1/decision',
    '/internal/project-control/v1/tasks/task-1/archive',
  ]);
  assert.ok(commands.every((command) => command.actor === 'user:7'));
  assert.deepEqual(commands[2]?.body, {
    parentAttemptId: 'attempt-1', clientRequestId: 'follow-up-1',
    feedback: '补充边界验证', requestedAcceptance: '定向测试通过', additionalContext: {},
  });
  assert.deepEqual(commands[4]?.body, { decision: 'APPROVED', message: '允许写入' });
  assert.deepEqual(commands[5]?.body, { reason: '长期历史已保留' });
});

test('project state commands use the authenticated actor and stable Control Project identity', async () => {
  const calls: Array<{ url: string; method: string; actor: string | null; body: unknown }> = [];
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
        return jsonResponse({
          schemaVersion: '1.0', resolution: 'MATCHED_BY_LOCAL_PROJECT_ID',
          project: { projectId: 'control-project-1', identityVersion: 1 },
          binding: { workspaceId: 'workspace-1' }, proposal: null,
          executionRegistration: {
            projectId: 'control-project-1', profileId: 'profile-1',
            projectRef: 'D:\\workspace\\demo', profileName: 'Default',
          },
        });
      }
      const headers = new Headers(init?.headers);
      calls.push({
        url,
        method: init?.method ?? 'GET',
        actor: headers.get('X-Zhishu-Actor'),
        body: init?.body ? JSON.parse(String(init.body)) as unknown : null,
      });
      if (url.endsWith('/state')) {
        return jsonResponse({ schemaVersion: '1.0', projectId: 'control-project-1', stateRevision: 0, entries: [] });
      }
      if (url.endsWith('/state/initial-proposals')) {
        return jsonResponse({ proposalId: 'proposal-1', status: 'PENDING_APPROVAL', baseStateRevision: 0 }, 201);
      }
      if (url.endsWith('/state/proposals/proposal-1/confirm')) {
        return jsonResponse({ beforeRevision: 0, afterRevision: 1 });
      }
      if (url.includes('/state/proposals?proposalType=STATE_CHANGE&limit=50')) {
        return jsonResponse([{ proposalId: 'proposal-2', status: 'PENDING_APPROVAL', baseStateRevision: 1 }]);
      }
      if (url.endsWith('/state/steward/reports/report-1/proposal')) {
        return jsonResponse({ proposalId: 'proposal-2', status: 'PENDING_APPROVAL', baseStateRevision: 1 }, 201);
      }
      if (url.endsWith('/state/proposals/proposal-2/reject')) {
        return jsonResponse({ changeType: 'STATE_PROPOSAL_REJECTED', beforeRevision: 1, afterRevision: 1 });
      }
      return jsonResponse({ message: 'unexpected request' }, 500);
    }) as typeof globalThis.fetch,
  });

  const state = await service.getProjectState('local-project-1') as { stateRevision: number };
  assert.equal(state.stateRevision, 0);
  await service.createInitialStateProposal('local-project-1', 'user:42', {
    goal: 'Ship', stage: 'Stage 3', summary: null, blocker: null,
    decisions: [], constraints: [], risks: [],
  });
  await service.confirmStateProposal('local-project-1', 'proposal-1', 'user:42', 'request-1');
  await service.listStateProposals('local-project-1');
  await service.createStateStewardProposalFromReport('local-project-1', 'report-1', 'user:42');
  await service.rejectStateProposal(
    'local-project-1', 'proposal-2', 'user:42', 'reject-request-1', 'Not relevant',
  );

  assert.deepEqual(calls.map((call) => [call.method, call.actor, new URL(call.url).pathname]), [
    ['GET', null, '/internal/project-control/v1/projects/control-project-1/state'],
    ['POST', 'user:42', '/internal/project-control/v1/projects/control-project-1/state/initial-proposals'],
    ['POST', 'user:42', '/internal/project-control/v1/projects/control-project-1/state/proposals/proposal-1/confirm'],
    ['GET', null, '/internal/project-control/v1/projects/control-project-1/state/proposals'],
    ['POST', 'user:42', '/internal/project-control/v1/projects/control-project-1/state/steward/reports/report-1/proposal'],
    ['POST', 'user:42', '/internal/project-control/v1/projects/control-project-1/state/proposals/proposal-2/reject'],
  ]);
  assert.deepEqual(calls[2]?.body, { clientRequestId: 'request-1' });
  assert.deepEqual(calls[4]?.body, {});
  assert.deepEqual(calls[5]?.body, { clientRequestId: 'reject-request-1', reason: 'Not relevant' });
});

test('Planner creates a proposal from a versioned context without creating a Task', async () => {
  const calls: Array<{ url: string; method: string; actor: string | null; body: Record<string, unknown> | null }> = [];
  const service = createTaskCenterGatewayService({
    ...secureWorkspaceDependencies,
    getControlPlaneBaseUrl: () => 'http://control.test',
    getProjectById: () => ({ projectId: 'local-project-1', displayName: 'Demo', projectRef: 'D:\\workspace\\demo' }),
    getRuntimeDeliveryHealth: () => healthyRuntime,
    fetch: (async (
      input: Parameters<typeof globalThis.fetch>[0],
      init?: Parameters<typeof globalThis.fetch>[1],
    ) => {
      const url = String(input);
      if (url.includes('/workspaces/resolve?')) {
        return jsonResponse({
          schemaVersion: '1.0', resolution: 'MATCHED_BY_LOCAL_PROJECT_ID',
          project: { projectId: 'control-project-1', identityVersion: 1 }, binding: { workspaceId: 'workspace-1' },
          proposal: null, executionRegistration: {
            projectId: 'control-project-1', profileId: 'profile-1', projectRef: 'D:\\workspace\\demo', profileName: 'Default',
          },
        });
      }
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      calls.push({ url, method: init?.method ?? 'GET', actor: new Headers(init?.headers).get('X-Zhishu-Actor'), body });
      if (url.endsWith('/contexts')) {
        return jsonResponse({
          packageId: 'planner-context-1', packageType: 'PLANNER',
          version: {
            stateRevision: 5, planVersion: null, executionWatermark: 8,
            contextGeneratedAt: '2026-08-15T00:00:00.000Z', contextPackageVersion: '1.0',
          },
          project: { projectId: 'control-project-1', displayName: 'Demo' },
          state: { goal: { content: 'Ship' }, stage: { content: 'Stage 5' }, blocker: null }, constraints: [],
        }, 201);
      }
      if (url.endsWith('/plans/proposals')) return jsonResponse({ proposalId: 'proposal-1', status: 'PENDING_APPROVAL' }, 201);
      if (url.endsWith('/plans/proposals/proposal-1/publish')) return jsonResponse({ planId: 'plan-1', versionNumber: 1 }, 201);
      return jsonResponse({ message: 'unexpected request' }, 500);
    }) as typeof globalThis.fetch,
  });

  await service.createPlannerProposal('local-project-1', 'user:7', '交付 Plan Center');
  await service.publishPlanProposal('local-project-1', 'proposal-1', 'user:7', ['scope', 'implement', 'verify']);

  assert.equal(calls[0]?.body?.packageType, 'PLANNER');
  assert.equal(calls[1]?.body?.baseStateRevision, 5);
  assert.equal(calls[1]?.body?.contextPackageId, 'planner-context-1');
  assert.equal(calls[1]?.actor, 'user:7');
  assert.ok(calls.every((call) => !call.url.includes('/tasks')));
});

test('Work Order bridge forwards stable project/profile identity and records one Brain handoff', async () => {
  const calls: Array<{ url: string; method: string; actor: string | null; body: Record<string, unknown> | null }> = [];
  const service = createTaskCenterGatewayService({
    ...secureWorkspaceDependencies,
    getControlPlaneBaseUrl: () => 'http://control.test',
    getProjectById: () => ({ projectId: 'local-project-1', displayName: 'Demo', projectRef: 'D:\workspace\demo' }),
    getRuntimeDeliveryHealth: () => healthyRuntime,
    fetch: (async (
      input: Parameters<typeof globalThis.fetch>[0],
      init?: Parameters<typeof globalThis.fetch>[1],
    ) => {
      const url = String(input);
      if (url.includes('/workspaces/resolve?')) {
        return jsonResponse({
          schemaVersion: '1.0', resolution: 'MATCHED_BY_LOCAL_PROJECT_ID',
          project: { projectId: 'control-project-1', identityVersion: 1 },
          binding: { workspaceId: 'workspace-1' }, proposal: null,
          executionRegistration: {
            projectId: 'control-project-1', profileId: 'profile-1',
            projectRef: 'D:\\workspace\\demo', profileName: 'Default',
          },
        });
      }
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      calls.push({ url, method: init?.method ?? 'GET', actor: new Headers(init?.headers).get('X-Zhishu-Actor'), body });
      if (url.endsWith('/work-orders/claims')) {
        return jsonResponse({ workOrderId: 'work-order-1', taskId: 'task-1', replayed: false }, 201);
      }
      if (url.endsWith('/work-orders/work-order-1/verifications')) {
        return jsonResponse({
          verificationId: 'verification-1', replayed: false, workOrder: { status: 'VERIFIED' },
          brainHandoff: {
            threadId: 'thread-1', triggerId: 'verification-1',
            question: 'Summarize this verified execution and identify the next Plan step.',
            context: {
              packageId: 'brain-context-1', packageType: 'BRAIN',
              version: {
                stateRevision: 6, planVersion: 2, executionWatermark: 19,
                contextGeneratedAt: '2026-08-15T00:00:00.000Z', contextPackageVersion: '1.0',
              },
              project: { projectId: 'control-project-1', displayName: 'Demo' },
              state: { goal: null, stage: null, summary: 'Verified', blocker: null, entries: [] },
              decisions: [], constraints: [], risks: [], derivedSystemFacts: [],
            },
          },
        }, 201);
      }
      if (url.endsWith('/work-orders/work-order-1/brain-handoff')) {
        return jsonResponse({ runId: 'run-1', threadId: 'thread-1', status: 'SUCCEEDED', replayed: false }, 201);
      }
      return jsonResponse({ message: 'unexpected request' }, 500);
    }) as typeof globalThis.fetch,
  });

  await service.claimWorkOrder('local-project-1', 'user:9', 'plan-1', 'node-1', 'claim-1');
  const verified = await service.verifyWorkOrder(
    'local-project-1', 'work-order-1', 'user:9', 'report-1', 'PASSED', 'Evidence reviewed',
  ) as { brainRun: { runId: string } };

  assert.equal(verified.brainRun.runId, 'run-1');
  assert.deepEqual(calls[0]?.body, {
    clientRequestId: 'claim-1', planId: 'plan-1', nodeKey: 'node-1',
    profileId: 'profile-1', approvalMode: 'MANUAL',
  });
  assert.equal(calls[0]?.actor, 'user:9');
  assert.equal(calls[1]?.actor, 'user:9');
  assert.equal(calls[2]?.actor, 'user:9');
  assert.equal(calls[2]?.body?.verificationId, 'verification-1');
  assert.equal(calls[2]?.body?.contextPackageId, 'brain-context-1');
});

test('Parallel Schedule commands stay inside the resolved Control Project boundary', async () => {
  const calls: Array<{
    path: string;
    method: string;
    actor: string | null;
    authorization: string | null;
    body: Record<string, unknown> | null;
  }> = [];
  let resolutionCount = 0;
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
        resolutionCount += 1;
        return jsonResponse({
          schemaVersion: '1.0', resolution: 'MATCHED_BY_LOCAL_PROJECT_ID',
          project: { projectId: 'control-project-1', identityVersion: 1 },
          binding: { workspaceId: 'workspace-1' }, proposal: null,
          executionRegistration: {
            projectId: 'control-project-1', profileId: 'profile-1',
            projectRef: 'D:\\workspace\\demo', profileName: 'Default',
          },
        });
      }
      const headers = new Headers(init?.headers);
      calls.push({
        path: new URL(url).pathname,
        method: init?.method ?? 'GET',
        actor: headers.get('X-Zhishu-Actor'),
        authorization: headers.get('Authorization'),
        body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null,
      });
      if ((init?.method ?? 'GET') === 'GET') return jsonResponse([]);
      return jsonResponse({ scheduleId: 'schedule-1', status: 'PENDING_APPROVAL' }, 201);
    }) as typeof globalThis.fetch,
  });

  await service.getSchedulerCapabilityMatrix('local-project-1', 'plan-1');
  await service.getSchedulerCandidatePairs('local-project-1', 'plan-1');
  await service.getSchedulerRecommendation('local-project-1', 'plan-1');
  await service.listParallelSchedules('local-project-1', 'plan-1');
  await service.createParallelSchedule('local-project-1', 'plan-1', 'user:11', {
    clientRequestId: 'parallel-create-1', baseStateRevision: 7,
    basePlanVersion: 3, nodeKeys: ['alpha', 'beta'],
  });
  await service.confirmParallelSchedule(
    'local-project-1', 'plan-1', 'schedule-1', 'user:11', 'parallel-confirm-1',
  );
  await service.rejectParallelSchedule(
    'local-project-1', 'plan-1', 'schedule-1', 'user:11', 'parallel-reject-1', 'Replan scopes',
  );
  await service.provisionParallelSchedule(
    'local-project-1', 'plan-1', 'schedule-1', 'lease-1', 'user:11',
    { clientRequestId: 'parallel-provision-1' },
  );
  await service.dispatchParallelSchedule(
    'local-project-1', 'plan-1', 'schedule-1', 'user:11', 'parallel-dispatch-1',
  );
  await service.listIntegrationGates('local-project-1', 'plan-1');
  await service.createIntegrationGate('local-project-1', 'plan-1', 'user:11', {
    clientRequestId: 'gate-create-1', scheduleId: 'schedule-1',
    baseStateRevision: 7, basePlanVersion: 3, evidenceReferenceIds: [],
  });
  await service.confirmIntegrationGate(
    'local-project-1', 'plan-1', 'gate-1', 'user:11', 'gate-confirm-1',
  );
  await service.rejectIntegrationGate(
    'local-project-1', 'plan-1', 'gate-1', 'user:11', 'gate-reject-1', 'Needs evidence',
  );

  assert.equal(resolutionCount, 13);
  assert.ok(calls.every((call) => call.path.includes('/projects/control-project-1/plans/plan-1/')));
  assert.ok(calls.every((call) => call.authorization === 'Bearer project-control-secret'));
  assert.deepEqual(calls.map((call) => [call.method, call.actor, call.path]), [
    ['GET', null, '/internal/project-control/v1/projects/control-project-1/plans/plan-1/capability-matrix'],
    ['GET', null, '/internal/project-control/v1/projects/control-project-1/plans/plan-1/parallel-schedule-candidates'],
    ['GET', null, '/internal/project-control/v1/projects/control-project-1/plans/plan-1/parallel-schedule-recommendation'],
    ['GET', null, '/internal/project-control/v1/projects/control-project-1/plans/plan-1/parallel-schedules'],
    ['POST', 'user:11', '/internal/project-control/v1/projects/control-project-1/plans/plan-1/parallel-schedules'],
    ['POST', 'user:11', '/internal/project-control/v1/projects/control-project-1/plans/plan-1/parallel-schedules/schedule-1/confirm'],
    ['POST', 'user:11', '/internal/project-control/v1/projects/control-project-1/plans/plan-1/parallel-schedules/schedule-1/reject'],
    ['POST', 'user:11', '/internal/project-control/v1/projects/control-project-1/plans/plan-1/parallel-schedules/schedule-1/workspace-leases/lease-1/provision'],
    ['POST', 'user:11', '/internal/project-control/v1/projects/control-project-1/plans/plan-1/parallel-schedules/schedule-1/dispatch'],
    ['GET', null, '/internal/project-control/v1/projects/control-project-1/plans/plan-1/integration-gates'],
    ['POST', 'user:11', '/internal/project-control/v1/projects/control-project-1/plans/plan-1/integration-gates'],
    ['POST', 'user:11', '/internal/project-control/v1/projects/control-project-1/plans/plan-1/integration-gates/gate-1/confirm'],
    ['POST', 'user:11', '/internal/project-control/v1/projects/control-project-1/plans/plan-1/integration-gates/gate-1/reject'],
  ]);
  assert.deepEqual(calls[4]?.body, {
    clientRequestId: 'parallel-create-1', baseStateRevision: 7,
    basePlanVersion: 3, nodeKeys: ['alpha', 'beta'],
  });
  assert.deepEqual(calls[5]?.body, { clientRequestId: 'parallel-confirm-1' });
  assert.deepEqual(calls[6]?.body, {
    clientRequestId: 'parallel-reject-1', reason: 'Replan scopes',
  });
  assert.deepEqual(calls[7]?.body, { clientRequestId: 'parallel-provision-1' });
  assert.deepEqual(calls[8]?.body, { clientRequestId: 'parallel-dispatch-1' });
  assert.deepEqual(calls[10]?.body, {
    clientRequestId: 'gate-create-1', scheduleId: 'schedule-1',
    baseStateRevision: 7, basePlanVersion: 3, evidenceReferenceIds: [],
  });
  assert.deepEqual(calls[11]?.body, { clientRequestId: 'gate-confirm-1' });
  assert.deepEqual(calls[12]?.body, { clientRequestId: 'gate-reject-1', reason: 'Needs evidence' });
});
