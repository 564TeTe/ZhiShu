import express from 'express';

import { AppError, asyncHandler } from '@/shared/utils.js';

import { createTaskCenterGatewayService } from './task-center-gateway.service.js';

type AuthenticatedRequest = express.Request & {
  user?: { id?: unknown; username?: unknown };
};

function requiredProjectId(request: express.Request): string {
  const projectId = typeof request.params.projectId === 'string'
    ? request.params.projectId.trim()
    : '';
  if (!projectId) {
    throw new AppError('projectId is required', {
      code: 'PROJECT_ID_REQUIRED',
      statusCode: 400,
    });
  }
  return projectId;
}

function authenticatedActor(request: express.Request): string {
  const user = (request as AuthenticatedRequest).user;
  const id = typeof user?.id === 'number' || typeof user?.id === 'string' ? String(user.id) : '';
  if (!id) {
    throw new AppError('Authenticated user identity is required.', {
      code: 'AUTH_USER_REQUIRED',
      statusCode: 401,
    });
  }
  return `user:${id}`;
}

function requiredText(value: unknown, field: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    throw new AppError(`${field} is required`, { code: 'INVALID_PROJECT_STATE', statusCode: 400 });
  }
  return text;
}

function optionalQueryValue(request: express.Request, name: string): string | undefined {
  const value = request.query[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function taskHistoryQuery(request: express.Request) {
  const archive = (optionalQueryValue(request, 'archive') ?? 'ACTIVE').toUpperCase();
  const status = optionalQueryValue(request, 'status')?.toUpperCase();
  const resolutionStatus = optionalQueryValue(request, 'resolutionStatus')?.toUpperCase();
  const search = optionalQueryValue(request, 'search');
  const cursor = optionalQueryValue(request, 'cursor');
  const rawLimit = optionalQueryValue(request, 'limit') ?? '25';
  const limit = Number(rawLimit);
  const attemptStatuses = new Set([
    'PENDING', 'STARTING', 'RUNNING', 'WAITING_APPROVAL', 'CANCELLING',
    'SUCCEEDED', 'FAILED', 'LOST', 'ABORTED',
  ]);
  const resolutionStatuses = new Set([
    'OPEN', 'IN_PROGRESS', 'WAITING_ACCEPTANCE', 'NEEDS_FOLLOW_UP', 'RESOLVED', 'CLOSED',
  ]);
  if (!['ACTIVE', 'ARCHIVED', 'ALL'].includes(archive)
    || (status && !attemptStatuses.has(status))
    || (resolutionStatus && !resolutionStatuses.has(resolutionStatus))
    || !Number.isInteger(limit) || limit < 1 || limit > 100
    || (search && search.length > 200)
    || (cursor && cursor.length > 500)) {
    throw new AppError('Invalid task history query.', {
      code: 'INVALID_TASK_HISTORY_QUERY', statusCode: 400,
    });
  }
  return {
    archive: archive as 'ACTIVE' | 'ARCHIVED' | 'ALL',
    status,
    resolutionStatus,
    search,
    cursor,
    limit,
  };
}

function projectActivityQuery(request: express.Request) {
  const afterValue = optionalQueryValue(request, 'after');
  const limitValue = optionalQueryValue(request, 'limit') ?? '100';
  const after = afterValue === undefined ? undefined : Number(afterValue);
  const limit = Number(limitValue);
  if ((after !== undefined && (!Number.isSafeInteger(after) || after < 0))
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    throw new AppError('Invalid project activity query.', {
      code: 'INVALID_PROJECT_ACTIVITY_QUERY', statusCode: 400,
    });
  }
  return { after, limit };
}

function projectMetricsWindow(request: express.Request): number {
  const windowHours = Number(optionalQueryValue(request, 'windowHours') ?? '168');
  if (!Number.isSafeInteger(windowHours) || windowHours < 1 || windowHours > 24 * 90) {
    throw new AppError('Invalid project metrics window.', {
      code: 'INVALID_PROJECT_METRICS_WINDOW', statusCode: 400,
    });
  }
  return windowHours;
}

function stateEntries(value: unknown, field: string) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new AppError(`${field} must be an array`, { code: 'INVALID_PROJECT_STATE', statusCode: 400 });
  }
  return value.map((item, index) => {
    const entry = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const evidenceReferenceIds = entry.evidenceReferenceIds === undefined ? [] : entry.evidenceReferenceIds;
    if (!Array.isArray(evidenceReferenceIds)
      || evidenceReferenceIds.some((id) => typeof id !== 'string' || !id.trim())) {
      throw new AppError(`${field}[${index}].evidenceReferenceIds must contain ids`, {
        code: 'INVALID_PROJECT_STATE', statusCode: 400,
      });
    }
    return {
      title: requiredText(entry.title, `${field}[${index}].title`),
      content: requiredText(entry.content, `${field}[${index}].content`),
      rationale: typeof entry.rationale === 'string' ? entry.rationale.trim() || null : null,
      evidenceReferenceIds: evidenceReferenceIds.map((id) => String(id).trim()),
    };
  });
}

/**
 * Creates the Task Center Gateway router used by the server entrypoint and focused route tests.
 * Routes only validate transport/auth input and delegate reads or explicit identity confirmations.
 */
export function createTaskCenterGatewayRoutes(
  service = createTaskCenterGatewayService(),
) {
  const router = express.Router();

  router.get(
    '/projects/:projectId/dashboard',
    asyncHandler(async (request, response) => {
      const projectId = requiredProjectId(request);

      response.json(await service.getDashboard(projectId));
    }),
  );

  router.get(
    '/projects/:projectId/activity',
    asyncHandler(async (request, response) => {
      response.json(await service.getProjectActivity(
        requiredProjectId(request), projectActivityQuery(request),
      ));
    }),
  );

  router.get(
    '/projects/:projectId/metrics',
    asyncHandler(async (request, response) => {
      response.json(await service.getProjectMetrics(
        requiredProjectId(request), projectMetricsWindow(request),
      ));
    }),
  );

  router.get(
    '/projects/:projectId/tasks',
    asyncHandler(async (request, response) => {
      response.json(await service.listTaskHistory(
        requiredProjectId(request), taskHistoryQuery(request),
      ));
    }),
  );

  router.get(
    '/projects/:projectId/tasks/:taskId',
    asyncHandler(async (request, response) => {
      const projectId = requiredProjectId(request);
      const taskId = typeof request.params.taskId === 'string'
        ? request.params.taskId.trim()
        : '';
      if (!taskId) {
        throw new AppError('taskId is required', {
          code: 'TASK_ID_REQUIRED',
          statusCode: 400,
        });
      }

      response.json(await service.getTaskDetail(projectId, taskId));
    }),
  );

  router.post(
    '/projects/:projectId/tasks/:taskId/retry-lost',
    express.json(),
    asyncHandler(async (request, response) => {
      const taskId = requiredText(request.params.taskId, 'taskId');
      response.status(202).json(await service.retryLostTask(
        requiredProjectId(request), taskId, authenticatedActor(request),
      ));
    }),
  );

  router.post(
    '/projects/:projectId/tasks/:taskId/cancel',
    express.json(),
    asyncHandler(async (request, response) => {
      response.status(202).json(await service.cancelTask(
        requiredProjectId(request), requiredText(request.params.taskId, 'taskId'),
        authenticatedActor(request),
      ));
    }),
  );

  router.post(
    '/projects/:projectId/tasks/:taskId/retry',
    express.json(),
    asyncHandler(async (request, response) => {
      response.status(202).json(await service.retryTask(
        requiredProjectId(request), requiredText(request.params.taskId, 'taskId'),
        authenticatedActor(request),
      ));
    }),
  );

  router.post(
    '/projects/:projectId/tasks/:taskId/archive',
    express.json(),
    asyncHandler(async (request, response) => {
      const body = request.body as Record<string, unknown>;
      response.json(await service.archiveTask(
        requiredProjectId(request), requiredText(request.params.taskId, 'taskId'),
        authenticatedActor(request), requiredText(body.reason, 'reason'),
      ));
    }),
  );

  router.post(
    '/projects/:projectId/tasks/:taskId/follow-ups',
    express.json(),
    asyncHandler(async (request, response) => {
      const body = request.body as Record<string, unknown>;
      response.status(202).json(await service.createTaskFollowUp(
        requiredProjectId(request), requiredText(request.params.taskId, 'taskId'),
        authenticatedActor(request),
        {
          parentAttemptId: requiredText(body.parentAttemptId, 'parentAttemptId'),
          clientRequestId: requiredText(body.clientRequestId, 'clientRequestId'),
          feedback: requiredText(body.feedback, 'feedback'),
          requestedAcceptance: requiredText(body.requestedAcceptance, 'requestedAcceptance'),
        },
      ));
    }),
  );

  router.post(
    '/projects/:projectId/tasks/:taskId/acceptance',
    express.json(),
    asyncHandler(async (request, response) => {
      const body = request.body as Record<string, unknown>;
      const decision = requiredText(body.decision, 'decision').toUpperCase();
      if (!['RESOLVED', 'NEEDS_FOLLOW_UP', 'CLOSED'].includes(decision)) {
        throw new AppError('decision must be RESOLVED, NEEDS_FOLLOW_UP, or CLOSED', {
          code: 'INVALID_ACCEPTANCE_DECISION', statusCode: 400,
        });
      }
      response.json(await service.acceptTaskResult(
        requiredProjectId(request), requiredText(request.params.taskId, 'taskId'),
        authenticatedActor(request),
        {
          attemptId: requiredText(body.attemptId, 'attemptId'),
          clientRequestId: requiredText(body.clientRequestId, 'clientRequestId'),
          decision: decision as 'RESOLVED' | 'NEEDS_FOLLOW_UP' | 'CLOSED',
          reason: requiredText(body.reason, 'reason'),
        },
      ));
    }),
  );

  router.post(
    '/projects/:projectId/tasks/:taskId/approvals/:approvalId/decision',
    express.json(),
    asyncHandler(async (request, response) => {
      const body = request.body as Record<string, unknown>;
      const decision = requiredText(body.decision, 'decision').toUpperCase();
      if (decision !== 'APPROVED' && decision !== 'DENIED') {
        throw new AppError('decision must be APPROVED or DENIED', {
          code: 'INVALID_APPROVAL_DECISION', statusCode: 400,
        });
      }
      response.json(await service.decideTaskApproval(
        requiredProjectId(request), requiredText(request.params.taskId, 'taskId'),
        requiredText(request.params.approvalId, 'approvalId'), authenticatedActor(request),
        decision, typeof body.message === 'string' ? body.message.trim() || null : null,
      ));
    }),
  );

  router.get(
    '/projects/:projectId/workspace-identity',
    asyncHandler(async (request, response) => {
      response.json(await service.getWorkspaceIdentity(requiredProjectId(request)));
    }),
  );

  router.post(
    '/projects/:projectId/registration',
    express.json(),
    asyncHandler(async (request, response) => {
      response.json(await service.registerProject(
        requiredProjectId(request), authenticatedActor(request),
      ));
    }),
  );

  router.post(
    '/projects/:projectId/workspace-binding/confirm',
    express.json(),
    asyncHandler(async (request, response) => {
      const body = request.body as Record<string, unknown>;
      const action = body.action === 'MOVE_WORKSPACE' || body.action === 'REBIND_LOCAL_PROJECT'
        ? body.action
        : null;
      const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
      const baseIdentityVersion = typeof body.baseIdentityVersion === 'number'
        ? body.baseIdentityVersion
        : Number.NaN;
      if (!action || !text(body.workspaceId) || !text(body.proposalId)
        || !text(body.machineId) || !text(body.workspacePath) || !text(body.clientRequestId)
        || !Number.isSafeInteger(baseIdentityVersion) || baseIdentityVersion < 1) {
        throw new AppError('A complete current workspace proposal is required.', {
          code: 'INVALID_WORKSPACE_PROPOSAL',
          statusCode: 400,
        });
      }
      response.json(await service.confirmWorkspaceBinding(
        requiredProjectId(request),
        authenticatedActor(request),
        {
          workspaceId: text(body.workspaceId),
          proposalId: text(body.proposalId),
          action,
          machineId: text(body.machineId),
          localProjectId: text(body.localProjectId) || null,
          workspacePath: text(body.workspacePath),
          baseIdentityVersion,
          clientRequestId: text(body.clientRequestId),
        },
      ));
    }),
  );

  router.get(
    '/projects/:projectId/state',
    asyncHandler(async (request, response) => {
      response.json(await service.getProjectState(requiredProjectId(request)));
    }),
  );

  router.post(
    '/projects/:projectId/state/initial-proposals',
    express.json(),
    asyncHandler(async (request, response) => {
      const body = request.body as Record<string, unknown>;
      const optionalText = (value: unknown) => typeof value === 'string' ? value.trim() || null : null;
      const proposal = await service.createInitialStateProposal(
        requiredProjectId(request),
        authenticatedActor(request),
        {
          goal: requiredText(body.goal, 'goal'),
          stage: requiredText(body.stage, 'stage'),
          summary: optionalText(body.summary),
          blocker: optionalText(body.blocker),
          decisions: stateEntries(body.decisions, 'decisions'),
          constraints: stateEntries(body.constraints, 'constraints'),
          risks: stateEntries(body.risks, 'risks'),
        },
      );
      response.status(201).json(proposal);
    }),
  );

  router.post(
    '/projects/:projectId/state/proposals/:proposalId/confirm',
    express.json(),
    asyncHandler(async (request, response) => {
      const body = request.body as Record<string, unknown>;
      response.json(await service.confirmStateProposal(
        requiredProjectId(request),
        requiredText(request.params.proposalId, 'proposalId'),
        authenticatedActor(request),
        requiredText(body.clientRequestId, 'clientRequestId'),
      ));
    }),
  );

  router.post(
    '/projects/:projectId/state/steward/reports/:reportId/proposal',
    asyncHandler(async (request, response) => {
      response.status(201).json(await service.createStateStewardProposalFromReport(
        requiredProjectId(request), requiredText(request.params.reportId, 'reportId'),
        authenticatedActor(request),
      ));
    }),
  );

  router.get(
    '/projects/:projectId/state/proposals',
    asyncHandler(async (request, response) => {
      response.json(await service.listStateProposals(requiredProjectId(request)));
    }),
  );

  router.post(
    '/projects/:projectId/state/proposals/:proposalId/reject',
    express.json(),
    asyncHandler(async (request, response) => {
      const body = request.body as Record<string, unknown>;
      response.json(await service.rejectStateProposal(
        requiredProjectId(request), requiredText(request.params.proposalId, 'proposalId'),
        authenticatedActor(request), requiredText(body.clientRequestId, 'clientRequestId'),
        requiredText(body.reason, 'reason'),
      ));
    }),
  );

  router.get(
    '/projects/:projectId/changes',
    asyncHandler(async (request, response) => {
      const raw = typeof request.query.afterRevision === 'string' ? Number(request.query.afterRevision) : 0;
      if (!Number.isSafeInteger(raw) || raw < 0) {
        throw new AppError('afterRevision must be a non-negative integer', {
          code: 'INVALID_PROJECT_REVISION', statusCode: 400,
        });
      }
      response.json(await service.getProjectChanges(requiredProjectId(request), raw));
    }),
  );

  router.get(
    '/projects/:projectId/brain/threads',
    asyncHandler(async (request, response) => {
      response.json(await service.listBrainThreads(requiredProjectId(request)));
    }),
  );

  router.get(
    '/projects/:projectId/brain/threads/:threadId/messages',
    asyncHandler(async (request, response) => {
      response.json(await service.listBrainMessages(
        requiredProjectId(request), requiredText(request.params.threadId, 'threadId'),
      ));
    }),
  );

  router.post(
    '/projects/:projectId/brain/ask',
    express.json(),
    asyncHandler(async (request, response) => {
      const body = request.body as Record<string, unknown>;
      response.status(201).json(await service.askProjectBrain(
        requiredProjectId(request),
        authenticatedActor(request),
        requiredText(body.question, 'question'),
        typeof body.threadId === 'string' ? body.threadId.trim() || null : null,
      ));
    }),
  );

  router.post(
    '/projects/:projectId/brain/ask/stream',
    express.json(),
    asyncHandler(async (request, response) => {
      const body = request.body as Record<string, unknown>;
      const result = await service.askProjectBrain(
        requiredProjectId(request),
        authenticatedActor(request),
        requiredText(body.question, 'question'),
        typeof body.threadId === 'string' ? body.threadId.trim() || null : null,
      );
      response.status(201);
      response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      response.setHeader('Cache-Control', 'no-cache, no-transform');
      response.write(`event: meta\ndata: ${JSON.stringify({
        runId: result.runId, threadId: result.threadId, contextPackageId: result.contextPackageId,
      })}\n\n`);
      for (const paragraph of result.message.split('\n')) {
        response.write(`event: delta\ndata: ${JSON.stringify({ text: `${paragraph}\n` })}\n\n`);
      }
      response.end(`event: done\ndata: ${JSON.stringify({
        status: result.status, citations: result.citations, generatedProposal: result.generatedProposal,
      })}\n\n`);
    }),
  );

  router.get(
    '/projects/:projectId/plans',
    asyncHandler(async (request, response) => {
      response.json(await service.listPlans(requiredProjectId(request)));
    }),
  );

  router.get(
    '/projects/:projectId/plans/:planId/capability-matrix',
    asyncHandler(async (request, response) => {
      response.json(await service.getSchedulerCapabilityMatrix(
        requiredProjectId(request), requiredText(request.params.planId, 'planId'),
      ));
    }),
  );

  router.get(
    '/projects/:projectId/plans/:planId/parallel-schedule-candidates',
    asyncHandler(async (request, response) => {
      response.json(await service.getSchedulerCandidatePairs(
        requiredProjectId(request), requiredText(request.params.planId, 'planId'),
      ));
    }),
  );

  router.get(
    '/projects/:projectId/plans/:planId/parallel-schedule-recommendation',
    asyncHandler(async (request, response) => {
      response.json(await service.getSchedulerRecommendation(
        requiredProjectId(request), requiredText(request.params.planId, 'planId'),
      ));
    }),
  );

  router.get(
    '/projects/:projectId/plans/:planId/parallel-schedules',
    asyncHandler(async (request, response) => {
      response.json(await service.listParallelSchedules(
        requiredProjectId(request), requiredText(request.params.planId, 'planId'),
      ));
    }),
  );

  router.post(
    '/projects/:projectId/plans/:planId/parallel-schedules',
    express.json(),
    asyncHandler(async (request, response) => {
      const body = request.body as Record<string, unknown>;
      const baseStateRevision = Number(body.baseStateRevision);
      const basePlanVersion = Number(body.basePlanVersion);
      const rawNodeKeys = body.nodeKeys;
      const physicalWorkspaceKind = body.physicalWorkspaceKind === undefined
        ? 'DIRECTORY_ONLY'
        : String(body.physicalWorkspaceKind).trim().toUpperCase();
      if (!Number.isSafeInteger(baseStateRevision) || baseStateRevision < 0
        || !Number.isSafeInteger(basePlanVersion) || basePlanVersion < 1
        || !Array.isArray(rawNodeKeys) || rawNodeKeys.length !== 2
        || rawNodeKeys.some((key) => typeof key !== 'string' || !key.trim())
        || new Set(rawNodeKeys.map((key) => String(key).trim())).size !== 2
        || !['DIRECTORY_ONLY', 'GIT_WORKTREE'].includes(physicalWorkspaceKind)) {
        throw new AppError('Parallel Schedule requires current versions and two distinct nodeKeys.', {
          code: 'INVALID_PARALLEL_SCHEDULE', statusCode: 400,
        });
      }
      const nodeKeys = rawNodeKeys.map((key) => String(key).trim()) as [string, string];
      response.status(201).json(await service.createParallelSchedule(
        requiredProjectId(request), requiredText(request.params.planId, 'planId'),
        authenticatedActor(request), {
          clientRequestId: requiredText(body.clientRequestId, 'clientRequestId'),
          baseStateRevision,
          basePlanVersion,
          nodeKeys,
          physicalWorkspaceKind: physicalWorkspaceKind as 'DIRECTORY_ONLY' | 'GIT_WORKTREE',
        },
      ));
    }),
  );

  router.post(
    '/projects/:projectId/plans/:planId/parallel-schedules/:scheduleId/confirm',
    express.json(),
    asyncHandler(async (request, response) => {
      const body = request.body as Record<string, unknown>;
      response.json(await service.confirmParallelSchedule(
        requiredProjectId(request), requiredText(request.params.planId, 'planId'),
        requiredText(request.params.scheduleId, 'scheduleId'), authenticatedActor(request),
        requiredText(body.clientRequestId, 'clientRequestId'),
      ));
    }),
  );

  router.post(
    '/projects/:projectId/plans/:planId/integration-gates/:gateId/executions',
    express.json(),
    asyncHandler(async (request, response) => {
      const body = request.body as Record<string, unknown>;
      response.status(201).json(await service.executeIntegrationGate(
        requiredProjectId(request), requiredText(request.params.planId, 'planId'),
        requiredText(request.params.gateId, 'gateId'), authenticatedActor(request),
        requiredText(body.clientRequestId, 'clientRequestId'),
      ));
    }),
  );

  router.post(
    '/projects/:projectId/plans/:planId/integration-gates/:gateId/executions/:runId/agent',
    express.json(),
    asyncHandler(async (request, response) => {
      const body = request.body as Record<string, unknown>;
      const profileId = body.profileId === undefined || body.profileId === null
        ? null
        : requiredText(body.profileId, 'profileId');
      response.status(201).json(await service.startIntegrationAgent(
        requiredProjectId(request), requiredText(request.params.planId, 'planId'),
        requiredText(request.params.gateId, 'gateId'), requiredText(request.params.runId, 'runId'),
        authenticatedActor(request), {
          clientRequestId: requiredText(body.clientRequestId, 'clientRequestId'),
          profileId,
        },
      ));
    }),
  );

  router.post(
    '/projects/:projectId/plans/:planId/integration-gates/:gateId/executions/:runId/finalize',
    express.json(),
    asyncHandler(async (request, response) => {
      const body = request.body as Record<string, unknown>;
      const candidateCommit = requiredText(body.candidateCommit, 'candidateCommit');
      if (!/^[0-9a-f]{40,64}$/.test(candidateCommit)) {
        throw new AppError('candidateCommit must be a full lowercase object id.', {
          code: 'INVALID_INTEGRATION_CANDIDATE', statusCode: 400,
        });
      }
      response.json(await service.finalizeIntegrationExecution(
        requiredProjectId(request), requiredText(request.params.planId, 'planId'),
        requiredText(request.params.gateId, 'gateId'), requiredText(request.params.runId, 'runId'),
        authenticatedActor(request), {
          clientRequestId: requiredText(body.clientRequestId, 'clientRequestId'),
          candidateCommit,
        },
      ));
    }),
  );

  router.post(
    '/projects/:projectId/plans/:planId/parallel-schedules/:scheduleId/reject',
    express.json(),
    asyncHandler(async (request, response) => {
      const body = request.body as Record<string, unknown>;
      response.json(await service.rejectParallelSchedule(
        requiredProjectId(request), requiredText(request.params.planId, 'planId'),
        requiredText(request.params.scheduleId, 'scheduleId'), authenticatedActor(request),
        requiredText(body.clientRequestId, 'clientRequestId'), requiredText(body.reason, 'reason'),
      ));
    }),
  );

  router.post(
    '/projects/:projectId/plans/:planId/parallel-schedules/:scheduleId/workspace-leases/:leaseId/provision',
    express.json(),
    asyncHandler(async (request, response) => {
      const body = request.body as Record<string, unknown>;
      response.json(await service.provisionParallelSchedule(
        requiredProjectId(request), requiredText(request.params.planId, 'planId'),
        requiredText(request.params.scheduleId, 'scheduleId'),
        requiredText(request.params.leaseId, 'leaseId'), authenticatedActor(request),
        { clientRequestId: requiredText(body.clientRequestId, 'clientRequestId') },
      ));
    }),
  );

  router.post(
    '/projects/:projectId/plans/:planId/parallel-schedules/:scheduleId/dispatch',
    express.json(),
    asyncHandler(async (request, response) => {
      const body = request.body as Record<string, unknown>;
      response.status(201).json(await service.dispatchParallelSchedule(
        requiredProjectId(request), requiredText(request.params.planId, 'planId'),
        requiredText(request.params.scheduleId, 'scheduleId'), authenticatedActor(request),
        requiredText(body.clientRequestId, 'clientRequestId'),
      ));
    }),
  );

  router.get(
    '/projects/:projectId/plans/:planId/integration-gates',
    asyncHandler(async (request, response) => {
      response.json(await service.listIntegrationGates(
        requiredProjectId(request), requiredText(request.params.planId, 'planId'),
      ));
    }),
  );

  router.post(
    '/projects/:projectId/plans/:planId/integration-gates',
    express.json(),
    asyncHandler(async (request, response) => {
      const body = request.body as Record<string, unknown>;
      const baseStateRevision = Number(body.baseStateRevision);
      const basePlanVersion = Number(body.basePlanVersion);
      const rawEvidence = body.evidenceReferenceIds === undefined ? [] : body.evidenceReferenceIds;
      if (!Number.isSafeInteger(baseStateRevision) || baseStateRevision < 0
        || !Number.isSafeInteger(basePlanVersion) || basePlanVersion < 1
        || typeof body.scheduleId !== 'string' || !body.scheduleId.trim()
        || !Array.isArray(rawEvidence) || rawEvidence.length > 100
        || rawEvidence.some((id) => typeof id !== 'string' || !id.trim())
        || new Set(rawEvidence.map((id) => String(id).trim())).size !== rawEvidence.length) {
        throw new AppError('Integration Gate requires current versions, a scheduleId, and unique evidenceReferenceIds.', {
          code: 'INVALID_INTEGRATION_GATE', statusCode: 400,
        });
      }
      response.status(201).json(await service.createIntegrationGate(
        requiredProjectId(request), requiredText(request.params.planId, 'planId'),
        authenticatedActor(request), {
          clientRequestId: requiredText(body.clientRequestId, 'clientRequestId'),
          scheduleId: String(body.scheduleId).trim(), baseStateRevision, basePlanVersion,
          evidenceReferenceIds: rawEvidence.map((id) => String(id).trim()),
        },
      ));
    }),
  );

  router.post(
    '/projects/:projectId/plans/:planId/integration-gates/:gateId/confirm',
    express.json(),
    asyncHandler(async (request, response) => {
      const body = request.body as Record<string, unknown>;
      response.json(await service.confirmIntegrationGate(
        requiredProjectId(request), requiredText(request.params.planId, 'planId'),
        requiredText(request.params.gateId, 'gateId'), authenticatedActor(request),
        requiredText(body.clientRequestId, 'clientRequestId'),
      ));
    }),
  );

  router.post(
    '/projects/:projectId/plans/:planId/integration-gates/:gateId/reject',
    express.json(),
    asyncHandler(async (request, response) => {
      const body = request.body as Record<string, unknown>;
      response.json(await service.rejectIntegrationGate(
        requiredProjectId(request), requiredText(request.params.planId, 'planId'),
        requiredText(request.params.gateId, 'gateId'), authenticatedActor(request),
        requiredText(body.clientRequestId, 'clientRequestId'), requiredText(body.reason, 'reason'),
      ));
    }),
  );

  router.get(
    '/projects/:projectId/work-orders',
    asyncHandler(async (request, response) => {
      response.json(await service.listWorkOrders(
        requiredProjectId(request),
        typeof request.query.planId === 'string' ? request.query.planId : undefined,
        typeof request.query.nodeKey === 'string' ? request.query.nodeKey : undefined,
      ));
    }),
  );

  router.post(
    '/projects/:projectId/work-orders/claims',
    express.json(),
    asyncHandler(async (request, response) => {
      const body = request.body as Record<string, unknown>;
      response.status(201).json(await service.claimWorkOrder(
        requiredProjectId(request), authenticatedActor(request),
        requiredText(body.planId, 'planId'), requiredText(body.nodeKey, 'nodeKey'),
        requiredText(body.clientRequestId, 'clientRequestId'),
      ));
    }),
  );

  router.post(
    '/projects/:projectId/work-orders/:workOrderId/verifications',
    express.json(),
    asyncHandler(async (request, response) => {
      const body = request.body as Record<string, unknown>;
      const decision = requiredText(body.decision, 'decision').toUpperCase();
      if (decision !== 'PASSED' && decision !== 'FAILED') {
        throw new AppError('decision must be PASSED or FAILED', {
          code: 'INVALID_VERIFICATION_DECISION', statusCode: 400,
        });
      }
      response.status(201).json(await service.verifyWorkOrder(
        requiredProjectId(request), requiredText(request.params.workOrderId, 'workOrderId'),
        authenticatedActor(request), requiredText(body.reportId, 'reportId'),
        decision, requiredText(body.reason, 'reason'),
      ));
    }),
  );

  router.get(
    '/projects/:projectId/plans/proposals',
    asyncHandler(async (request, response) => {
      response.json(await service.listPlanProposals(requiredProjectId(request)));
    }),
  );

  router.post(
    '/projects/:projectId/plans/proposals',
    express.json(),
    asyncHandler(async (request, response) => {
      const body = request.body as Record<string, unknown>;
      response.status(201).json(await service.createPlannerProposal(
        requiredProjectId(request), authenticatedActor(request), requiredText(body.objective, 'objective'),
      ));
    }),
  );

  router.post(
    '/projects/:projectId/plans/proposals/:proposalId/publish',
    express.json(),
    asyncHandler(async (request, response) => {
      const body = request.body as Record<string, unknown>;
      const keys = body.approvedNodeKeys === undefined ? [] : body.approvedNodeKeys;
      if (!Array.isArray(keys) || keys.some((key) => typeof key !== 'string' || !key.trim())) {
        throw new AppError('approvedNodeKeys must contain node keys', {
          code: 'INVALID_PLAN_APPROVAL', statusCode: 400,
        });
      }
      response.status(201).json(await service.publishPlanProposal(
        requiredProjectId(request), requiredText(request.params.proposalId, 'proposalId'),
        authenticatedActor(request), keys.map((key) => String(key).trim()),
      ));
    }),
  );

  router.post(
    '/projects/:projectId/plans/proposals/:proposalId/reject',
    express.json(),
    asyncHandler(async (request, response) => {
      const body = request.body as Record<string, unknown>;
      response.json(await service.rejectPlanProposal(
        requiredProjectId(request), requiredText(request.params.proposalId, 'proposalId'),
        authenticatedActor(request), requiredText(body.reason, 'reason'),
      ));
    }),
  );

  return router;
}
