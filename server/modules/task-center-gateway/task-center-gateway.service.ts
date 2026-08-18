import {
  createProjectWorkspaceObservation,
  getProjectIdentityById,
} from '@/modules/projects/index.js';
import {
  runProjectBrain,
  runProjectPlanner,
  type BrainContextPackage,
  type PlannerContextPackage,
} from '@/modules/project-intelligence/index.js';
import { getRuntimeEventDeliveryHealth } from '@/modules/runtime/index.js';
import { AppError } from '@/shared/utils.js';

type LocalProjectIdentity = {
  projectId: string;
  displayName: string;
  projectRef: string;
};

type ControlProjectRegistration = {
  projectId: string;
  profileId: string;
  projectRef: string;
  profileName: string;
};

type ControlProjectIdentityResolution = {
  schemaVersion: '1.0';
  resolution: 'MATCHED_BY_LOCAL_PROJECT_ID' | 'MATCHED_BY_WORKSPACE_PATH'
    | 'MATCHED_BY_REMOTE_FINGERPRINT' | 'PROPOSAL_REQUIRED' | 'AMBIGUOUS' | 'NOT_FOUND';
  project: { projectId: string; identityVersion: number } | null;
  binding: { workspaceId: string } | null;
  proposal: {
    proposalId: string;
    action: 'MOVE_WORKSPACE' | 'REBIND_LOCAL_PROJECT';
    machineId: string;
    localProjectId: string | null;
    workspacePath: string;
    targetProjectId: string;
    baseIdentityVersion: number;
    status: 'PENDING';
  } | null;
  executionRegistration: ControlProjectRegistration | null;
};

type ConfirmWorkspaceBindingInput = {
  workspaceId: string;
  proposalId: string;
  action: 'MOVE_WORKSPACE' | 'REBIND_LOCAL_PROJECT';
  machineId: string;
  localProjectId: string | null;
  workspacePath: string;
  baseIdentityVersion: number;
  clientRequestId: string;
};

type InitialStateEntryInput = {
  title: string;
  content: string;
  rationale?: string | null;
  evidenceReferenceIds: string[];
};

type InitialStateProposalInput = {
  goal: string;
  stage: string;
  summary?: string | null;
  blocker?: string | null;
  decisions: InitialStateEntryInput[];
  constraints: InitialStateEntryInput[];
  risks: InitialStateEntryInput[];
};

type CreateParallelScheduleInput = {
  clientRequestId: string;
  baseStateRevision: number;
  basePlanVersion: number;
  nodeKeys: [string, string];
  physicalWorkspaceKind?: 'DIRECTORY_ONLY' | 'GIT_WORKTREE';
};

type ProvisionParallelScheduleInput = {
  clientRequestId: string;
};

type CreateIntegrationGateInput = {
  clientRequestId: string;
  scheduleId: string;
  baseStateRevision: number;
  basePlanVersion: number;
  evidenceReferenceIds: string[];
};

type StartIntegrationAgentInput = {
  clientRequestId: string;
  profileId?: string | null;
};

type FinalizeIntegrationInput = {
  clientRequestId: string;
  candidateCommit: string;
};

type BrainRunResponse = {
  runId: string;
  threadId: string;
  contextPackageId: string;
  status: 'SUCCEEDED';
  message: string;
  citations: Array<{ sourceType: string; sourceId: string; label: string }>;
  generatedProposal: Record<string, unknown> | null;
};

type WorkOrderVerificationResponse = {
  verificationId: string;
  replayed: boolean;
  workOrder: Record<string, unknown>;
  brainHandoff: {
    threadId: string;
    triggerId: string;
    context: BrainContextPackage;
    question: string;
  };
};

type ControlTask = {
  taskId: string;
  projectId: string;
  profileId: string;
  title: string;
  objective: string;
  status: string;
  attemptStatus?: string | null;
  resolutionStatus: string;
  attemptId?: string | null;
  attemptNumber?: number | null;
  runtimeRunId?: string | null;
  runtimeHealthStatus?: string | null;
  lastHeartbeatAt?: string | null;
  leaseExpiresAt?: string | null;
  unknownSince?: string | null;
  lostAt?: string | null;
  lostReason?: string | null;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  archivedAt?: string | null;
  archivedBy?: string | null;
  archiveReason?: string | null;
};

type ControlTaskPage = {
  items: ControlTask[];
  nextCursor?: string | null;
  hasMore: boolean;
};

type ControlApproval = {
  id: string;
  taskId: string;
  attemptId: string;
  runtimeRunId: string;
  runtimeApprovalId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  riskLevel?: string | null;
  status: string;
  attemptStatus: string;
  expiresAt?: string | null;
  decidedAt?: string | null;
  createdAt: string;
  decisionSource?: string | null;
  policy?: string | null;
  rule?: string | null;
  reason?: string | null;
};

type ControlArtifact = {
  id: string;
  taskId: string;
  attemptId: string;
  artifactType: string;
  producer: string;
  contentPlain?: string | null;
  storagePath?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  hash?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

type ControlTaskAttempt = {
  attemptId: string;
  attemptNumber: number;
  runtimeRunId?: string | null;
  status: string;
  runtimeHealthStatus?: string | null;
  lastHeartbeatAt?: string | null;
  leaseExpiresAt?: string | null;
  unknownSince?: string | null;
  lostAt?: string | null;
  lostReason?: string | null;
  executor?: string | null;
  modelAlias?: string | null;
  connectionRef?: string | null;
  approvalMode?: string | null;
  requestedApprovalMode?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  followUpId?: string | null;
  parentAttemptId?: string | null;
  followUpFeedback?: string | null;
  requestedAcceptance?: string | null;
  acceptanceDecision?: string | null;
  acceptanceReason?: string | null;
  acceptanceAt?: string | null;
};

type ControlFollowUp = {
  id: string;
  taskId: string;
  parentAttemptId: string;
  attemptId: string;
  clientRequestId: string;
  actor: string;
  feedback: string;
  requestedAcceptance: string;
  additionalContext: Record<string, unknown>;
  attemptNumber: number;
  attemptStatus: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  acceptanceDecision?: string | null;
  acceptanceReason?: string | null;
  acceptanceAt?: string | null;
  createdAt: string;
};

type ControlApprovalPolicy = {
  projectId: string;
  projectRoot: string;
  mode: string;
  allowedDirectories: string[];
  trustedCommands: string[][];
  approvalTimeoutSeconds: number;
  updatedAt: string;
};

type RuntimeDeliverySnapshot = ReturnType<typeof getRuntimeEventDeliveryHealth>;

type ControlProjectActivityPage = {
  schemaVersion: '1.0';
  projectId: string;
  status: 'READY' | 'RESYNC_REQUIRED';
  requestedAfterCursor: number | null;
  latestCursor: number;
  retentionFloorCursor: number;
  nextCursor: number;
  hasMore: boolean;
  events: Array<{
    cursor: number;
    eventId: string;
    projectId: string;
    changeType: string;
    resourceType: string;
    resourceId: string;
    taskId: string | null;
    attemptId: string | null;
    sourceEventId: string | null;
    occurredAt: string;
  }>;
};

type ControlProjectMetrics = {
  schemaVersion: '1.0';
  projectId: string;
  windowHours: number;
  generatedAt: string;
  attempts: {
    total: number;
    terminal: number;
    succeeded: number;
    failed: number;
    lost: number;
    aborted: number;
    active: number;
    unknownHealth: number;
    lostHealth: number;
    failureRate: number;
    p50DurationMs: number;
    p95DurationMs: number;
  };
  tokens: { brainRuns: number; inputTokens: number; outputTokens: number; totalTokens: number };
  activity: {
    eventCount: number;
    latestCursor: number;
    retentionFloorCursor: number;
    latestEventAt: string | null;
    latestEventLagMs: number | null;
  };
};

type TaskCenterGatewayDependencies = {
  fetch: typeof globalThis.fetch;
  getControlPlaneBaseUrl(): string | null;
  getProjectControlToken(): string | null;
  getProjectById(projectId: string): LocalProjectIdentity | null;
  getWorkspaceObservation(project: LocalProjectIdentity): {
    machineId: string;
    localProjectId: string;
    normalizedWorkspacePath: string;
  };
  getRuntimeDeliveryHealth(): RuntimeDeliverySnapshot;
  now(): number;
};

type DashboardWarning = {
  code: string;
  message: string;
};

const CONTROL_REQUEST_TIMEOUT_MS = 5_000;
const TASK_LIMIT = 50;
const DETAIL_TASK_LIMIT = 12;
const STALE_AFTER_MS = 30_000;
const ACTIVE_STATUSES = new Set(['PENDING', 'STARTING', 'RUNNING', 'WAITING_APPROVAL', 'CANCELLING']);
const TERMINAL_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'LOST', 'ABORTED']);

const defaultDependencies: TaskCenterGatewayDependencies = {
  fetch: globalThis.fetch,
  getControlPlaneBaseUrl: () => process.env.ZHISHU_CONTROL_BASE_URL?.trim() || null,
  getProjectControlToken: () => process.env.ZS_PROJECT_CONTROL_TOKEN?.trim() || null,
  getProjectById: getProjectIdentityById,
  getWorkspaceObservation: createProjectWorkspaceObservation,
  getRuntimeDeliveryHealth: getRuntimeEventDeliveryHealth,
  now: () => Date.now(),
};

class ControlPlaneRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function excerpt(value: string | null | undefined, maximumLength = 240): string | null {
  if (!value) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.length <= maximumLength
    ? normalized
    : `${normalized.slice(0, maximumLength)}…`;
}

function sortNewest<T extends { createdAt: string }>(values: T[]): T[] {
  return [...values].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function chooseDetailTasks(tasks: ControlTask[]): ControlTask[] {
  const prioritized = [
    ...tasks.filter((task) => task.status === 'WAITING_APPROVAL'),
    ...tasks.filter((task) => ACTIVE_STATUSES.has(task.status)),
    ...tasks,
  ];
  const seen = new Set<string>();
  return prioritized.filter((task) => {
    if (seen.has(task.taskId)) return false;
    seen.add(task.taskId);
    return true;
  }).slice(0, DETAIL_TASK_LIMIT);
}

function mapTask(task: ControlTask) {
  return {
    taskId: task.taskId,
    title: task.title,
    objective: task.objective,
    status: task.status,
    attemptStatus: task.attemptStatus ?? task.status,
    resolutionStatus: task.resolutionStatus,
    attemptId: task.attemptId ?? null,
    attemptNumber: task.attemptNumber ?? null,
    runtimeRunId: task.runtimeRunId ?? null,
    runtimeHealthStatus: task.runtimeHealthStatus ?? 'NOT_MONITORED',
    lastHeartbeatAt: task.lastHeartbeatAt ?? null,
    leaseExpiresAt: task.leaseExpiresAt ?? null,
    unknownSince: task.unknownSince ?? null,
    lostAt: task.lostAt ?? null,
    lostReason: task.lostReason ?? null,
    createdAt: task.createdAt,
    startedAt: task.startedAt ?? null,
    completedAt: task.completedAt ?? null,
    errorCode: task.errorCode ?? null,
    errorMessage: task.errorMessage ?? null,
    archivedAt: task.archivedAt ?? null,
    archivedBy: task.archivedBy ?? null,
    archiveReason: task.archiveReason ?? null,
  };
}

/**
 * Creates the Task Center Gateway service consumed by its routes and module tests.
 *
 * Dashboard/detail methods perform bounded aggregation. Commands validate the
 * stable project ownership before forwarding a user-derived actor through the
 * service-credential boundary.
 */
export function createTaskCenterGatewayService(
  dependencyOverrides: Partial<TaskCenterGatewayDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };

  async function requestControlJson<T>(path: string, serviceCredential?: string): Promise<T> {
    const baseUrl = dependencies.getControlPlaneBaseUrl();
    if (!baseUrl) {
      throw new ControlPlaneRequestError('Control Plane base URL is not configured.', null);
    }

    const configuredCredential = serviceCredential ?? dependencies.getProjectControlToken() ?? undefined;
    const effectivePath = configuredCredential && path.startsWith('/api/v1/')
      ? path.replace('/api/v1/', '/internal/project-control/v1/')
      : path;
    let response: Response;
    try {
      response = await dependencies.fetch(`${baseUrl.replace(/\/+$/, '')}${effectivePath}`, {
        headers: {
          Accept: 'application/json',
          ...(configuredCredential ? { Authorization: `Bearer ${configuredCredential}` } : {}),
        },
        signal: AbortSignal.timeout(CONTROL_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new ControlPlaneRequestError(`Control Plane request failed: ${errorMessage(error)}`, null);
    }

    const body = await response.json().catch(() => null) as unknown;
    if (!response.ok) {
      const message = body && typeof body === 'object' && 'message' in body
        ? String((body as { message: unknown }).message)
        : `Control Plane returned HTTP ${response.status}.`;
      throw new ControlPlaneRequestError(message, response.status);
    }
    return body as T;
  }

  /** Registers a local project through the public catalog bootstrap endpoint. */
  async function ensureControlRegistration(
    project: LocalProjectIdentity,
    actor: string,
  ): Promise<ControlProjectRegistration> {
    const baseUrl = dependencies.getControlPlaneBaseUrl();
    if (!baseUrl) {
      throw new ControlPlaneRequestError('Control Plane base URL is not configured.', null);
    }

    let response: Response;
    try {
      response = await dependencies.fetch(`${baseUrl.replace(/\/+$/, '')}/api/v1/projects/ensure`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Zhishu-Actor': actor,
        },
        body: JSON.stringify({
          candidateProjectId: project.projectId,
          projectRef: project.projectRef,
          displayName: project.displayName,
        }),
        signal: AbortSignal.timeout(CONTROL_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new ControlPlaneRequestError(`Control Plane registration failed: ${errorMessage(error)}`, null);
    }

    const body = await response.json().catch(() => null) as unknown;
    if (!response.ok) {
      const message = body && typeof body === 'object' && 'message' in body
        ? String((body as { message: unknown }).message)
        : `Control Plane returned HTTP ${response.status}.`;
      throw new ControlPlaneRequestError(message, response.status);
    }
    return body as ControlProjectRegistration;
  }

  async function resolveControlRegistration(project: LocalProjectIdentity): Promise<ControlProjectRegistration> {
    const serviceCredential = dependencies.getProjectControlToken();
    if (!serviceCredential) {
      throw new ControlPlaneRequestError('Project Control service credential is not configured.', 503);
    }

    const resolution = await resolveWorkspaceIdentity(project, serviceCredential);
    if (!resolution.executionRegistration) {
      throw new ControlPlaneRequestError(
        resolution.resolution === 'AMBIGUOUS'
          ? 'Workspace identity is ambiguous.'
          : 'Workspace identity was not found.',
        resolution.resolution === 'AMBIGUOUS' ? 409 : 404,
      );
    }
    return resolution.executionRegistration;
  }

  async function resolveWorkspaceIdentity(
    project: LocalProjectIdentity,
    serviceCredential = dependencies.getProjectControlToken(),
  ): Promise<ControlProjectIdentityResolution> {
    if (!serviceCredential) {
      throw new AppError('Project Control service credential is not configured.', {
        code: 'PROJECT_CONTROL_CREDENTIAL_MISSING',
        statusCode: 503,
      });
    }
    const observation = dependencies.getWorkspaceObservation(project);
    const query = new URLSearchParams({
      machineId: observation.machineId,
      localProjectId: observation.localProjectId,
      normalizedWorkspacePath: observation.normalizedWorkspacePath,
    });
    return requestControlJson<ControlProjectIdentityResolution>(
      `/internal/project-control/v1/workspaces/resolve?${query.toString()}`,
      serviceCredential,
    );
  }

  async function requestProjectControlCommand<T>(
    path: string,
    actor: string,
    body: unknown,
  ): Promise<T> {
    const baseUrl = dependencies.getControlPlaneBaseUrl();
    const serviceCredential = dependencies.getProjectControlToken();
    if (!baseUrl || !serviceCredential) {
      throw new AppError('Project Control command boundary is not configured.', {
        code: 'PROJECT_CONTROL_CREDENTIAL_MISSING',
        statusCode: 503,
      });
    }
    let response: Response;
    try {
      response = await dependencies.fetch(`${baseUrl.replace(/\/+$/, '')}${path}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceCredential}`,
          'X-Zhishu-Actor': actor,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(CONTROL_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new AppError(`Project Control command failed: ${errorMessage(error)}`, {
        code: 'PROJECT_CONTROL_UNAVAILABLE',
        statusCode: 503,
      });
    }
    const responseBody = await response.json().catch(() => null) as unknown;
    if (!response.ok) {
      const message = responseBody && typeof responseBody === 'object' && 'message' in responseBody
        ? String((responseBody as { message: unknown }).message)
        : `Project Control returned HTTP ${response.status}.`;
      const responseCode = responseBody && typeof responseBody === 'object' && 'code' in responseBody
        ? String((responseBody as { code: unknown }).code)
        : null;
      throw new AppError(message, {
        code: response.status === 409
          ? responseCode ?? 'PROJECT_CONTROL_CONFLICT'
          : 'PROJECT_CONTROL_COMMAND_FAILED',
        statusCode: response.status === 409 ? 409 : 502,
      });
    }
    return responseBody as T;
  }

  function runtimeDependency() {
    const health = dependencies.getRuntimeDeliveryHealth();
    return {
      status: health.status,
      configurationReady: health.configurationReady,
      pendingEvents: health.pendingEvents,
      dueEvents: health.dueEvents,
      oldestEventAgeMs: health.oldestEventAgeMs,
      lastError: health.lastError,
    };
  }

  function requireLocalProject(localProjectId: string): LocalProjectIdentity {
    const project = dependencies.getProjectById(localProjectId);
    if (!project) {
      throw new AppError(`Project "${localProjectId}" was not found.`, {
        code: 'PROJECT_NOT_FOUND',
        statusCode: 404,
      });
    }
    return project;
  }

  async function requireControlRegistration(project: LocalProjectIdentity) {
    try {
      return await resolveControlRegistration(project);
    } catch (error) {
      const requestError = error instanceof ControlPlaneRequestError ? error : null;
      if (requestError?.status === 404) {
        throw new AppError('The project is not registered in the Control Plane.', {
          code: 'PROJECT_NOT_REGISTERED',
          statusCode: 404,
        });
      }
      throw new AppError('The Control Plane is unavailable.', {
        code: 'CONTROL_PLANE_UNAVAILABLE',
        statusCode: 503,
      });
    }
  }

  async function requireOwnedTask(localProjectId: string, taskId: string, includeArchived = false) {
    const project = requireLocalProject(localProjectId);
    const registration = await requireControlRegistration(project);
    let task: ControlTask;
    try {
      task = await requestControlJson<ControlTask>(
        includeArchived
          ? `/internal/project-control/v1/projects/${encodeURIComponent(registration.projectId)}`
            + `/tasks/${encodeURIComponent(taskId)}`
          : `/internal/project-control/v1/tasks/${encodeURIComponent(taskId)}`,
      );
    } catch (error) {
      const requestError = error instanceof ControlPlaneRequestError ? error : null;
      throw new AppError(
        requestError?.status === 404 ? 'The task was not found.' : 'Task details are unavailable.',
        {
          code: requestError?.status === 404 ? 'TASK_NOT_FOUND' : 'TASK_DETAIL_UNAVAILABLE',
          statusCode: requestError?.status === 404 ? 404 : 503,
        },
      );
    }
    if (task.projectId !== registration.projectId) {
      throw new AppError('The task does not belong to this project.', {
        code: 'TASK_PROJECT_MISMATCH', statusCode: 404,
      });
    }
    return { registration, task };
  }

  return {
    async getWorkspaceIdentity(localProjectId: string) {
      return resolveWorkspaceIdentity(requireLocalProject(localProjectId));
    },

    async registerProject(localProjectId: string, actor: string) {
      const project = requireLocalProject(localProjectId);
      try {
        await ensureControlRegistration(project, actor);
        const resolution = await resolveWorkspaceIdentity(project);
        if (!resolution.executionRegistration) {
          throw new ControlPlaneRequestError('Project registration did not produce an execution profile.', 502);
        }
        return resolution;
      } catch (error) {
        const requestError = error instanceof ControlPlaneRequestError ? error : null;
        throw new AppError(requestError?.message ?? 'Project registration failed.', {
          code: 'PROJECT_REGISTRATION_FAILED',
          statusCode: requestError?.status === 409 ? 409 : 503,
        });
      }
    },

    async confirmWorkspaceBinding(
      localProjectId: string,
      actor: string,
      input: ConfirmWorkspaceBindingInput,
    ) {
      const project = requireLocalProject(localProjectId);
      const resolution = await resolveWorkspaceIdentity(project);
      if (!resolution.project
        || !resolution.binding
        || !resolution.proposal
        || resolution.binding.workspaceId !== input.workspaceId
        || resolution.proposal.proposalId !== input.proposalId
        || resolution.proposal.action !== input.action
        || resolution.proposal.baseIdentityVersion !== input.baseIdentityVersion) {
        throw new AppError('Workspace proposal does not belong to this project.', {
          code: 'PROJECT_IDENTITY_CONFLICT',
          statusCode: 409,
        });
      }
      return requestProjectControlCommand(
        `/internal/project-control/v1/projects/${encodeURIComponent(resolution.project.projectId)}`
          + `/workspace-bindings/${encodeURIComponent(input.workspaceId)}/confirm`,
        actor,
        input,
      );
    },

    async getProjectState(localProjectId: string) {
      const project = requireLocalProject(localProjectId);
      const registration = await requireControlRegistration(project);
      return requestControlJson(
        `/internal/project-control/v1/projects/${encodeURIComponent(registration.projectId)}/state`,
      );
    },

    async createInitialStateProposal(
      localProjectId: string,
      actor: string,
      input: InitialStateProposalInput,
    ) {
      const project = requireLocalProject(localProjectId);
      const registration = await requireControlRegistration(project);
      return requestProjectControlCommand(
        `/internal/project-control/v1/projects/${encodeURIComponent(registration.projectId)}`
          + '/state/initial-proposals',
        actor,
        input,
      );
    },

    async confirmStateProposal(
      localProjectId: string,
      proposalId: string,
      actor: string,
      clientRequestId: string,
    ) {
      const project = requireLocalProject(localProjectId);
      const registration = await requireControlRegistration(project);
      return requestProjectControlCommand(
        `/internal/project-control/v1/projects/${encodeURIComponent(registration.projectId)}`
          + `/state/proposals/${encodeURIComponent(proposalId)}/confirm`,
        actor,
        { clientRequestId },
      );
    },

    async listStateProposals(localProjectId: string) {
      const project = requireLocalProject(localProjectId);
      const registration = await requireControlRegistration(project);
      return requestControlJson(
        `/internal/project-control/v1/projects/${encodeURIComponent(registration.projectId)}`
          + '/state/proposals?proposalType=STATE_CHANGE&limit=50',
      );
    },

    async createStateStewardProposalFromReport(
      localProjectId: string,
      reportId: string,
      actor: string,
    ) {
      const project = requireLocalProject(localProjectId);
      const registration = await requireControlRegistration(project);
      return requestProjectControlCommand(
        `/internal/project-control/v1/projects/${encodeURIComponent(registration.projectId)}`
          + `/state/steward/reports/${encodeURIComponent(reportId)}/proposal`,
        actor,
        {},
      );
    },

    async rejectStateProposal(
      localProjectId: string,
      proposalId: string,
      actor: string,
      clientRequestId: string,
      reason: string,
    ) {
      const project = requireLocalProject(localProjectId);
      const registration = await requireControlRegistration(project);
      return requestProjectControlCommand(
        `/internal/project-control/v1/projects/${encodeURIComponent(registration.projectId)}`
          + `/state/proposals/${encodeURIComponent(proposalId)}/reject`,
        actor,
        { clientRequestId, reason },
      );
    },

    async getProjectChanges(localProjectId: string, afterRevision: number) {
      const project = requireLocalProject(localProjectId);
      const registration = await requireControlRegistration(project);
      const query = new URLSearchParams({ afterRevision: String(afterRevision), limit: '100' });
      return requestControlJson(
        `/internal/project-control/v1/projects/${encodeURIComponent(registration.projectId)}/changes?${query}`,
      );
    },

    async getProjectActivity(
      localProjectId: string,
      input: { after?: number; limit: number },
    ): Promise<ControlProjectActivityPage> {
      const project = requireLocalProject(localProjectId);
      const registration = await requireControlRegistration(project);
      const query = new URLSearchParams({ limit: String(input.limit) });
      if (input.after !== undefined) query.set('after', String(input.after));
      return requestControlJson<ControlProjectActivityPage>(
        `/internal/project-control/v1/projects/${encodeURIComponent(registration.projectId)}`
          + `/activity?${query.toString()}`,
      );
    },

    async getProjectMetrics(
      localProjectId: string,
      windowHours: number,
    ): Promise<ControlProjectMetrics> {
      const project = requireLocalProject(localProjectId);
      const registration = await requireControlRegistration(project);
      return requestControlJson<ControlProjectMetrics>(
        `/internal/project-control/v1/projects/${encodeURIComponent(registration.projectId)}`
          + `/metrics?windowHours=${windowHours}`,
      );
    },

    async listBrainThreads(localProjectId: string) {
      const project = requireLocalProject(localProjectId);
      const registration = await requireControlRegistration(project);
      return requestControlJson(
        `/internal/project-control/v1/projects/${encodeURIComponent(registration.projectId)}/brain/threads`,
      );
    },

    async listBrainMessages(localProjectId: string, threadId: string) {
      const project = requireLocalProject(localProjectId);
      const registration = await requireControlRegistration(project);
      return requestControlJson(
        `/internal/project-control/v1/projects/${encodeURIComponent(registration.projectId)}`
          + `/brain/threads/${encodeURIComponent(threadId)}/messages`,
      );
    },

    async askProjectBrain(
      localProjectId: string,
      actor: string,
      question: string,
      existingThreadId?: string | null,
    ) {
      const project = requireLocalProject(localProjectId);
      const registration = await requireControlRegistration(project);
      const basePath = `/internal/project-control/v1/projects/${encodeURIComponent(registration.projectId)}`;
      let threadId = existingThreadId?.trim() || null;
      if (!threadId) {
        const thread = await requestProjectControlCommand<{ threadId: string }>(
          `${basePath}/brain/threads`, actor,
          { title: question.trim().slice(0, 80) },
        );
        threadId = thread.threadId;
      }
      const context = await requestProjectControlCommand<BrainContextPackage>(
        `${basePath}/contexts`, actor, { packageType: 'BRAIN' },
      );
      const result = runProjectBrain(context, question);
      return requestProjectControlCommand<BrainRunResponse>(
        `${basePath}/brain/threads/${encodeURIComponent(threadId)}/runs`,
        actor,
        {
          contextPackageId: context.packageId,
          provider: result.provider,
          model: result.model,
          permissions: result.permissions,
          compositeContextVersion: context.version,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          userMessage: question,
          brainMessage: result.message,
          citations: result.citations,
          generatedProposal: result.generatedProposal,
        },
      );
    },

    async listPlans(localProjectId: string) {
      const project = requireLocalProject(localProjectId);
      const registration = await requireControlRegistration(project);
      return requestControlJson(
        `/internal/project-control/v1/projects/${encodeURIComponent(registration.projectId)}/plans`,
      );
    },

    async getSchedulerCapabilityMatrix(localProjectId: string, planId: string) {
      const project = requireLocalProject(localProjectId);
      const registration = await requireControlRegistration(project);
      return requestControlJson(
        `/internal/project-control/v1/projects/${encodeURIComponent(registration.projectId)}`
          + `/plans/${encodeURIComponent(planId)}/capability-matrix`,
      );
    },

    async getSchedulerCandidatePairs(localProjectId: string, planId: string) {
      const project = requireLocalProject(localProjectId);
      const registration = await requireControlRegistration(project);
      return requestControlJson(
        `/internal/project-control/v1/projects/${encodeURIComponent(registration.projectId)}`
          + `/plans/${encodeURIComponent(planId)}/parallel-schedule-candidates?limit=200`,
      );
    },

    async getSchedulerRecommendation(localProjectId: string, planId: string) {
      const project = requireLocalProject(localProjectId);
      const registration = await requireControlRegistration(project);
      return requestControlJson(
        `/internal/project-control/v1/projects/${encodeURIComponent(registration.projectId)}`
          + `/plans/${encodeURIComponent(planId)}/parallel-schedule-recommendation`,
      );
    },

    async listParallelSchedules(localProjectId: string, planId: string) {
      const project = requireLocalProject(localProjectId);
      const registration = await requireControlRegistration(project);
      return requestControlJson(
        `/internal/project-control/v1/projects/${encodeURIComponent(registration.projectId)}`
          + `/plans/${encodeURIComponent(planId)}/parallel-schedules?limit=50`,
      );
    },

    async createParallelSchedule(
      localProjectId: string,
      planId: string,
      actor: string,
      input: CreateParallelScheduleInput,
    ) {
      const project = requireLocalProject(localProjectId);
      const registration = await requireControlRegistration(project);
      return requestProjectControlCommand(
        `/internal/project-control/v1/projects/${encodeURIComponent(registration.projectId)}`
          + `/plans/${encodeURIComponent(planId)}/parallel-schedules`,
        actor,
        input,
      );
    },

    async confirmParallelSchedule(
      localProjectId: string,
      planId: string,
      scheduleId: string,
      actor: string,
      clientRequestId: string,
    ) {
      const project = requireLocalProject(localProjectId);
      const registration = await requireControlRegistration(project);
      return requestProjectControlCommand(
        `/internal/project-control/v1/projects/${encodeURIComponent(registration.projectId)}`
          + `/plans/${encodeURIComponent(planId)}/parallel-schedules/${encodeURIComponent(scheduleId)}/confirm`,
        actor,
        { clientRequestId },
      );
    },

    async rejectParallelSchedule(
      localProjectId: string,
      planId: string,
      scheduleId: string,
      actor: string,
      clientRequestId: string,
      reason: string,
    ) {
      const project = requireLocalProject(localProjectId);
      const registration = await requireControlRegistration(project);
      return requestProjectControlCommand(
        `/internal/project-control/v1/projects/${encodeURIComponent(registration.projectId)}`
          + `/plans/${encodeURIComponent(planId)}/parallel-schedules/${encodeURIComponent(scheduleId)}/reject`,
        actor,
        { clientRequestId, reason },
      );
    },

    async provisionParallelSchedule(
      localProjectId: string,
      planId: string,
      scheduleId: string,
      leaseId: string,
      actor: string,
      input: ProvisionParallelScheduleInput,
    ) {
      const project = requireLocalProject(localProjectId);
      const registration = await requireControlRegistration(project);
      return requestProjectControlCommand(
        `/internal/project-control/v1/projects/${encodeURIComponent(registration.projectId)}`
          + `/plans/${encodeURIComponent(planId)}/parallel-schedules/${encodeURIComponent(scheduleId)}`
          + `/workspace-leases/${encodeURIComponent(leaseId)}/provision`,
        actor,
        input,
      );
    },

    async dispatchParallelSchedule(
      localProjectId: string,
      planId: string,
      scheduleId: string,
      actor: string,
      clientRequestId: string,
    ) {
      const project = requireLocalProject(localProjectId);
      const registration = await requireControlRegistration(project);
      return requestProjectControlCommand(
        `/internal/project-control/v1/projects/${encodeURIComponent(registration.projectId)}`
          + `/plans/${encodeURIComponent(planId)}/parallel-schedules/${encodeURIComponent(scheduleId)}/dispatch`,
        actor,
        { clientRequestId: clientRequestId.trim() },
      );
    },

    async listIntegrationGates(localProjectId: string, planId: string) {
      const project = requireLocalProject(localProjectId);
      const registration = await requireControlRegistration(project);
      return requestControlJson(
        `/internal/project-control/v1/projects/${encodeURIComponent(registration.projectId)}`
          + `/plans/${encodeURIComponent(planId)}/integration-gates?limit=50`,
      );
    },

    async createIntegrationGate(
      localProjectId: string,
      planId: string,
      actor: string,
      input: CreateIntegrationGateInput,
    ) {
      const project = requireLocalProject(localProjectId);
      const registration = await requireControlRegistration(project);
      return requestProjectControlCommand(
        `/internal/project-control/v1/projects/${encodeURIComponent(registration.projectId)}`
          + `/plans/${encodeURIComponent(planId)}/integration-gates`,
        actor,
        input,
      );
    },

    async confirmIntegrationGate(
      localProjectId: string,
      planId: string,
      gateId: string,
      actor: string,
      clientRequestId: string,
    ) {
      const project = requireLocalProject(localProjectId);
      const registration = await requireControlRegistration(project);
      return requestProjectControlCommand(
        `/internal/project-control/v1/projects/${encodeURIComponent(registration.projectId)}`
          + `/plans/${encodeURIComponent(planId)}/integration-gates/${encodeURIComponent(gateId)}/confirm`,
        actor,
        { clientRequestId },
      );
    },

    async rejectIntegrationGate(
      localProjectId: string,
      planId: string,
      gateId: string,
      actor: string,
      clientRequestId: string,
      reason: string,
    ) {
      const project = requireLocalProject(localProjectId);
      const registration = await requireControlRegistration(project);
      return requestProjectControlCommand(
        `/internal/project-control/v1/projects/${encodeURIComponent(registration.projectId)}`
          + `/plans/${encodeURIComponent(planId)}/integration-gates/${encodeURIComponent(gateId)}/reject`,
        actor,
        { clientRequestId, reason },
      );
    },

    async executeIntegrationGate(
      localProjectId: string,
      planId: string,
      gateId: string,
      actor: string,
      clientRequestId: string,
    ) {
      const project = requireLocalProject(localProjectId);
      const registration = await requireControlRegistration(project);
      return requestProjectControlCommand(
        `/internal/project-control/v1/projects/${encodeURIComponent(registration.projectId)}`
          + `/plans/${encodeURIComponent(planId)}/integration-gates/${encodeURIComponent(gateId)}/executions`,
        actor,
        { clientRequestId: clientRequestId.trim() },
      );
    },

    async finalizeIntegrationExecution(
      localProjectId: string,
      planId: string,
      gateId: string,
      runId: string,
      actor: string,
      input: FinalizeIntegrationInput,
    ) {
      const project = requireLocalProject(localProjectId);
      const registration = await requireControlRegistration(project);
      return requestProjectControlCommand(
        `/internal/project-control/v1/projects/${encodeURIComponent(registration.projectId)}`
          + `/plans/${encodeURIComponent(planId)}/integration-gates/${encodeURIComponent(gateId)}`
          + `/executions/${encodeURIComponent(runId)}/finalize`,
        actor,
        input,
      );
    },

    async startIntegrationAgent(
      localProjectId: string,
      planId: string,
      gateId: string,
      runId: string,
      actor: string,
      input: StartIntegrationAgentInput,
    ) {
      const project = requireLocalProject(localProjectId);
      const registration = await requireControlRegistration(project);
      return requestProjectControlCommand(
        `/internal/project-control/v1/projects/${encodeURIComponent(registration.projectId)}`
          + `/plans/${encodeURIComponent(planId)}/integration-gates/${encodeURIComponent(gateId)}`
          + `/executions/${encodeURIComponent(runId)}/agent`,
        actor,
        input,
      );
    },

    async listWorkOrders(localProjectId: string, planId?: string, nodeKey?: string) {
      const project = requireLocalProject(localProjectId);
      const registration = await requireControlRegistration(project);
      const query = new URLSearchParams();
      if (planId?.trim()) query.set('planId', planId.trim());
      if (nodeKey?.trim()) query.set('nodeKey', nodeKey.trim());
      const suffix = query.size > 0 ? `?${query}` : '';
      return requestControlJson(
        `/internal/project-control/v1/projects/${encodeURIComponent(registration.projectId)}`
          + `/work-orders${suffix}`,
      );
    },

    async claimWorkOrder(
      localProjectId: string,
      actor: string,
      planId: string,
      nodeKey: string,
      clientRequestId: string,
    ) {
      const project = requireLocalProject(localProjectId);
      const registration = await requireControlRegistration(project);
      return requestProjectControlCommand(
        `/internal/project-control/v1/projects/${encodeURIComponent(registration.projectId)}`
          + '/work-orders/claims',
        actor,
        {
          clientRequestId: clientRequestId.trim(),
          planId: planId.trim(),
          nodeKey: nodeKey.trim(),
          profileId: registration.profileId,
          approvalMode: 'MANUAL',
        },
      );
    },

    async verifyWorkOrder(
      localProjectId: string,
      workOrderId: string,
      actor: string,
      reportId: string,
      decision: 'PASSED' | 'FAILED',
      reason: string,
    ) {
      const project = requireLocalProject(localProjectId);
      const registration = await requireControlRegistration(project);
      const basePath = `/internal/project-control/v1/projects/${encodeURIComponent(registration.projectId)}`
        + `/work-orders/${encodeURIComponent(workOrderId)}`;
      const verification = await requestProjectControlCommand<WorkOrderVerificationResponse>(
        `${basePath}/verifications`, actor, { reportId, decision, reason },
      );
      const brainResult = runProjectBrain(
        verification.brainHandoff.context,
        verification.brainHandoff.question,
      );
      const brainRun = await requestProjectControlCommand<BrainRunResponse & { replayed: boolean }>(
        `${basePath}/brain-handoff`,
        actor,
        {
          verificationId: verification.verificationId,
          threadId: verification.brainHandoff.threadId,
          contextPackageId: verification.brainHandoff.context.packageId,
          provider: brainResult.provider,
          model: brainResult.model,
          permissions: brainResult.permissions,
          compositeContextVersion: verification.brainHandoff.context.version,
          inputTokens: brainResult.inputTokens,
          outputTokens: brainResult.outputTokens,
          userMessage: verification.brainHandoff.question,
          brainMessage: brainResult.message,
          citations: brainResult.citations,
          generatedProposal: brainResult.generatedProposal,
        },
      );
      return { ...verification, brainRun };
    },

    async listPlanProposals(localProjectId: string) {
      const project = requireLocalProject(localProjectId);
      const registration = await requireControlRegistration(project);
      return requestControlJson(
        `/internal/project-control/v1/projects/${encodeURIComponent(registration.projectId)}/plans/proposals`,
      );
    },

    async createPlannerProposal(localProjectId: string, actor: string, objective: string) {
      const project = requireLocalProject(localProjectId);
      const registration = await requireControlRegistration(project);
      const basePath = `/internal/project-control/v1/projects/${encodeURIComponent(registration.projectId)}`;
      const context = await requestProjectControlCommand<PlannerContextPackage>(
        `${basePath}/contexts`, actor, { packageType: 'PLANNER' },
      );
      const result = runProjectPlanner(context, objective);
      return requestProjectControlCommand(
        `${basePath}/plans/proposals`, actor, result.proposal,
      );
    },

    async publishPlanProposal(
      localProjectId: string,
      proposalId: string,
      actor: string,
      approvedNodeKeys: string[],
    ) {
      const project = requireLocalProject(localProjectId);
      const registration = await requireControlRegistration(project);
      return requestProjectControlCommand(
        `/internal/project-control/v1/projects/${encodeURIComponent(registration.projectId)}`
          + `/plans/proposals/${encodeURIComponent(proposalId)}/publish`,
        actor, { approvedNodeKeys },
      );
    },

    async rejectPlanProposal(localProjectId: string, proposalId: string, actor: string, reason: string) {
      const project = requireLocalProject(localProjectId);
      const registration = await requireControlRegistration(project);
      return requestProjectControlCommand(
        `/internal/project-control/v1/projects/${encodeURIComponent(registration.projectId)}`
          + `/plans/proposals/${encodeURIComponent(proposalId)}/reject`,
        actor, { reason },
      );
    },

    async getDashboard(localProjectId: string) {
      const project = requireLocalProject(localProjectId);

      const fetchedAt = new Date(dependencies.now()).toISOString();
      let registration: ControlProjectRegistration;
      try {
        registration = await resolveControlRegistration(project);
      } catch (error) {
        const requestError = error instanceof ControlPlaneRequestError ? error : null;
        const projectWasNotRegistered = requestError?.status === 404;
        return {
          availability: 'unavailable' as const,
          unavailableReason: projectWasNotRegistered
            ? 'PROJECT_NOT_REGISTERED' as const
            : 'CONTROL_PLANE_UNAVAILABLE' as const,
          fetchedAt,
          staleAfterMs: STALE_AFTER_MS,
          project: { ...project, controlProjectId: null, profileId: null, profileName: null },
          dependencies: {
            controlPlane: { status: projectWasNotRegistered ? 'up' as const : 'down' as const },
            runtimeDelivery: runtimeDependency(),
          },
          summary: {
            totalTasks: 0,
            activeTasks: 0,
            waitingApproval: 0,
            succeededTasks: 0,
            failedTasks: 0,
            lostTasks: 0,
            abortedTasks: 0,
            awaitingAcceptance: 0,
          },
          tasks: [],
          approvals: [],
          recentArtifacts: [],
          recentFollowUps: [],
          approvalPolicy: null,
          warnings: [{
            code: projectWasNotRegistered ? 'PROJECT_NOT_REGISTERED' : 'CONTROL_PLANE_UNAVAILABLE',
            message: projectWasNotRegistered
              ? '当前工作区尚未登记到执行控制面。只读驾驶台不会自动创建登记。'
              : '执行控制面当前不可用，无法读取任务事实。',
          }],
        };
      }

      const [tasksResult, policyResult] = await Promise.allSettled([
        requestControlJson<ControlTask[]>(
          `/api/v1/tasks?projectId=${encodeURIComponent(registration.projectId)}&limit=${TASK_LIMIT}`,
        ),
        requestControlJson<ControlApprovalPolicy>(
          `/api/v1/projects/${encodeURIComponent(registration.projectId)}/approval-policy`,
        ),
      ]);

      if (tasksResult.status === 'rejected') {
        return {
          availability: 'unavailable' as const,
          unavailableReason: 'TASK_DATA_UNAVAILABLE' as const,
          fetchedAt,
          staleAfterMs: STALE_AFTER_MS,
          project: {
            ...project,
            controlProjectId: registration.projectId,
            profileId: registration.profileId,
            profileName: registration.profileName,
          },
          dependencies: {
            controlPlane: { status: 'degraded' as const },
            runtimeDelivery: runtimeDependency(),
          },
          summary: {
            totalTasks: 0,
            activeTasks: 0,
            waitingApproval: 0,
            succeededTasks: 0,
            failedTasks: 0,
            lostTasks: 0,
            abortedTasks: 0,
            awaitingAcceptance: 0,
          },
          tasks: [],
          approvals: [],
          recentArtifacts: [],
          recentFollowUps: [],
          approvalPolicy: policyResult.status === 'fulfilled' ? policyResult.value : null,
          warnings: [{ code: 'TASK_DATA_UNAVAILABLE', message: '项目已登记，但任务列表暂时无法读取。' }],
        };
      }

      const tasks = Array.isArray(tasksResult.value) ? tasksResult.value : [];
      const warnings: DashboardWarning[] = [];
      if (policyResult.status === 'rejected') {
        warnings.push({ code: 'APPROVAL_POLICY_UNAVAILABLE', message: '项目审批策略暂时无法读取。' });
      }

      const detailResults = await Promise.all(chooseDetailTasks(tasks).map(async (task) => {
        const [approvals, artifacts, followUps] = await Promise.allSettled([
          requestControlJson<ControlApproval[]>(`/api/v1/tasks/${encodeURIComponent(task.taskId)}/approvals`),
          requestControlJson<ControlArtifact[]>(`/api/v1/tasks/${encodeURIComponent(task.taskId)}/artifacts`),
          requestControlJson<ControlFollowUp[]>(`/api/v1/tasks/${encodeURIComponent(task.taskId)}/follow-ups`),
        ]);
        return { task, approvals, artifacts, followUps };
      }));

      const approvals: ControlApproval[] = [];
      const artifacts: ControlArtifact[] = [];
      const followUps: ControlFollowUp[] = [];
      for (const detail of detailResults) {
        for (const [name, result] of [
          ['approvals', detail.approvals],
          ['artifacts', detail.artifacts],
          ['follow-ups', detail.followUps],
        ] as const) {
          if (result.status === 'rejected') {
            warnings.push({
              code: 'TASK_DETAIL_PARTIAL',
              message: `任务 ${detail.task.title} 的 ${name} 暂时无法读取。`,
            });
          }
        }
        if (detail.approvals.status === 'fulfilled' && Array.isArray(detail.approvals.value)) {
          approvals.push(...detail.approvals.value);
        }
        if (detail.artifacts.status === 'fulfilled' && Array.isArray(detail.artifacts.value)) {
          artifacts.push(...detail.artifacts.value);
        }
        if (detail.followUps.status === 'fulfilled' && Array.isArray(detail.followUps.value)) {
          followUps.push(...detail.followUps.value);
        }
      }

      const taskItems = tasks.map(mapTask);

      return {
        availability: warnings.length > 0 ? 'partial' as const : 'ready' as const,
        unavailableReason: null,
        fetchedAt,
        staleAfterMs: STALE_AFTER_MS,
        project: {
          ...project,
          controlProjectId: registration.projectId,
          profileId: registration.profileId,
          profileName: registration.profileName,
        },
        dependencies: {
          controlPlane: { status: warnings.length > 0 ? 'degraded' as const : 'up' as const },
          runtimeDelivery: runtimeDependency(),
        },
        summary: {
          totalTasks: tasks.length,
          activeTasks: tasks.filter((task) => ACTIVE_STATUSES.has(task.status)).length,
          waitingApproval: tasks.filter((task) => task.status === 'WAITING_APPROVAL').length,
          succeededTasks: tasks.filter((task) => task.status === 'SUCCEEDED').length,
          failedTasks: tasks.filter((task) => task.status === 'FAILED').length,
          lostTasks: tasks.filter((task) => task.status === 'LOST').length,
          abortedTasks: tasks.filter((task) => task.status === 'ABORTED').length,
          awaitingAcceptance: tasks.filter((task) => task.resolutionStatus === 'WAITING_ACCEPTANCE').length,
        },
        tasks: taskItems,
        approvals: sortNewest(approvals)
          .filter((approval) => approval.status === 'PENDING')
          .map((approval) => ({
            approvalId: approval.id,
            taskId: approval.taskId,
            attemptId: approval.attemptId,
            toolName: approval.toolName,
            riskLevel: approval.riskLevel ?? 'UNKNOWN',
            expiresAt: approval.expiresAt,
            createdAt: approval.createdAt,
          })),
        recentArtifacts: sortNewest(artifacts).slice(0, 12).map((artifact) => ({
          artifactId: artifact.id,
          taskId: artifact.taskId,
          attemptId: artifact.attemptId,
          artifactType: artifact.artifactType,
          producer: artifact.producer,
          contentExcerpt: excerpt(artifact.contentPlain),
          mimeType: artifact.mimeType ?? null,
          sizeBytes: artifact.sizeBytes ?? null,
          createdAt: artifact.createdAt,
        })),
        recentFollowUps: sortNewest(followUps).slice(0, 12).map((followUp) => ({
          followUpId: followUp.id,
          taskId: followUp.taskId,
          parentAttemptId: followUp.parentAttemptId,
          attemptId: followUp.attemptId,
          actor: followUp.actor,
          feedbackExcerpt: excerpt(followUp.feedback),
          requestedAcceptanceExcerpt: excerpt(followUp.requestedAcceptance),
          attemptNumber: followUp.attemptNumber,
          attemptStatus: followUp.attemptStatus,
          createdAt: followUp.createdAt,
        })),
        approvalPolicy: policyResult.status === 'fulfilled' ? policyResult.value : null,
        warnings,
      };
    },

    async listTaskHistory(
      localProjectId: string,
      input: {
        archive: 'ACTIVE' | 'ARCHIVED' | 'ALL';
        status?: string;
        resolutionStatus?: string;
        search?: string;
        cursor?: string;
        limit: number;
      },
    ) {
      const project = requireLocalProject(localProjectId);
      const registration = await requireControlRegistration(project);
      const query = new URLSearchParams({
        archive: input.archive,
        limit: String(input.limit),
      });
      if (input.status) query.set('status', input.status);
      if (input.resolutionStatus) query.set('resolutionStatus', input.resolutionStatus);
      if (input.search) query.set('search', input.search);
      if (input.cursor) query.set('cursor', input.cursor);
      const page = await requestControlJson<ControlTaskPage>(
        `/internal/project-control/v1/projects/${encodeURIComponent(registration.projectId)}`
          + `/tasks?${query.toString()}`,
      );
      return {
        items: Array.isArray(page.items) ? page.items.map(mapTask) : [],
        nextCursor: page.nextCursor ?? null,
        hasMore: Boolean(page.hasMore),
      };
    },

    async getTaskDetail(localProjectId: string, taskId: string) {
      const project = requireLocalProject(localProjectId);
      const { registration, task } = await requireOwnedTask(localProjectId, taskId, true);

      const [attemptsResult, approvalsResult, artifactsResult, followUpsResult] = await Promise.allSettled([
        requestControlJson<ControlTaskAttempt[]>(
          `/internal/project-control/v1/projects/${encodeURIComponent(registration.projectId)}`
            + `/tasks/${encodeURIComponent(taskId)}/attempts`,
        ),
        requestControlJson<ControlApproval[]>(`/api/v1/tasks/${encodeURIComponent(taskId)}/approvals`),
        requestControlJson<ControlArtifact[]>(`/api/v1/tasks/${encodeURIComponent(taskId)}/artifacts`),
        requestControlJson<ControlFollowUp[]>(`/api/v1/tasks/${encodeURIComponent(taskId)}/follow-ups`),
      ]);
      const warnings: DashboardWarning[] = [];
      for (const [source, result] of [
        ['Attempt 历史', attemptsResult],
        ['待审批', approvalsResult],
        ['Artifact', artifactsResult],
        ['Follow-up', followUpsResult],
      ] as const) {
        if (result.status === 'rejected') {
          warnings.push({ code: 'TASK_DETAIL_PARTIAL', message: `${source}暂时无法读取。` });
        }
      }

      const attempts = attemptsResult.status === 'fulfilled' && Array.isArray(attemptsResult.value)
        ? attemptsResult.value
        : [];
      const approvals = approvalsResult.status === 'fulfilled' && Array.isArray(approvalsResult.value)
        ? approvalsResult.value
        : [];
      const artifacts = artifactsResult.status === 'fulfilled' && Array.isArray(artifactsResult.value)
        ? artifactsResult.value
        : [];
      const followUps = followUpsResult.status === 'fulfilled' && Array.isArray(followUpsResult.value)
        ? followUpsResult.value
        : [];

      return {
        availability: warnings.length > 0 ? 'partial' as const : 'ready' as const,
        fetchedAt: new Date(dependencies.now()).toISOString(),
        staleAfterMs: STALE_AFTER_MS,
        project: {
          ...project,
          controlProjectId: registration.projectId,
          profileId: registration.profileId,
          profileName: registration.profileName,
        },
        task: mapTask(task),
        attempts: [...attempts]
          .sort((left, right) => right.attemptNumber - left.attemptNumber)
          .map((attempt) => ({
            ...attempt,
            runtimeRunId: attempt.runtimeRunId ?? null,
            runtimeHealthStatus: attempt.runtimeHealthStatus ?? 'NOT_MONITORED',
            lastHeartbeatAt: attempt.lastHeartbeatAt ?? null,
            leaseExpiresAt: attempt.leaseExpiresAt ?? null,
            unknownSince: attempt.unknownSince ?? null,
            lostAt: attempt.lostAt ?? null,
            lostReason: attempt.lostReason ?? null,
            executor: attempt.executor ?? null,
            modelAlias: attempt.modelAlias ?? null,
            connectionRef: attempt.connectionRef ?? null,
            approvalMode: attempt.approvalMode ?? null,
            requestedApprovalMode: attempt.requestedApprovalMode ?? null,
            startedAt: attempt.startedAt ?? null,
            completedAt: attempt.completedAt ?? null,
            errorCode: attempt.errorCode ?? null,
            errorMessage: attempt.errorMessage ?? null,
            followUpId: attempt.followUpId ?? null,
            parentAttemptId: attempt.parentAttemptId ?? null,
            followUpFeedback: attempt.followUpFeedback ?? null,
            requestedAcceptance: attempt.requestedAcceptance ?? null,
            acceptanceDecision: attempt.acceptanceDecision ?? null,
            acceptanceReason: attempt.acceptanceReason ?? null,
            acceptanceAt: attempt.acceptanceAt ?? null,
          })),
        approvals: sortNewest(approvals).map((approval) => ({
          approvalId: approval.id,
          attemptId: approval.attemptId,
          runtimeRunId: approval.runtimeRunId,
          runtimeApprovalId: approval.runtimeApprovalId,
          toolName: approval.toolName,
          toolInput: approval.toolInput,
          riskLevel: approval.riskLevel ?? null,
          status: approval.status,
          attemptStatus: approval.attemptStatus,
          expiresAt: approval.expiresAt ?? null,
          decidedAt: approval.decidedAt ?? null,
          decisionSource: approval.decisionSource ?? null,
          policy: approval.policy ?? null,
          rule: approval.rule ?? null,
          reason: approval.reason ?? null,
          createdAt: approval.createdAt,
        })),
        artifacts: sortNewest(artifacts).map((artifact) => ({
          artifactId: artifact.id,
          attemptId: artifact.attemptId,
          artifactType: artifact.artifactType,
          producer: artifact.producer,
          contentPlain: artifact.contentPlain ?? null,
          storagePath: artifact.storagePath ?? null,
          mimeType: artifact.mimeType ?? null,
          sizeBytes: artifact.sizeBytes ?? null,
          hash: artifact.hash ?? null,
          metadata: artifact.metadata ?? {},
          createdAt: artifact.createdAt,
        })),
        followUps: sortNewest(followUps).map((followUp) => ({
          followUpId: followUp.id,
          parentAttemptId: followUp.parentAttemptId,
          attemptId: followUp.attemptId,
          actor: followUp.actor,
          feedback: followUp.feedback,
          requestedAcceptance: followUp.requestedAcceptance,
          additionalContext: followUp.additionalContext,
          attemptNumber: followUp.attemptNumber,
          attemptStatus: followUp.attemptStatus,
          errorCode: followUp.errorCode ?? null,
          errorMessage: followUp.errorMessage ?? null,
          acceptanceDecision: followUp.acceptanceDecision ?? null,
          acceptanceReason: followUp.acceptanceReason ?? null,
          acceptanceAt: followUp.acceptanceAt ?? null,
          createdAt: followUp.createdAt,
        })),
        warnings,
      };
    },

    async retryLostTask(localProjectId: string, taskId: string, actor: string) {
      const { task } = await requireOwnedTask(localProjectId, taskId);
      const encodedTaskId = encodeURIComponent(taskId);
      if (task.status !== 'LOST') {
        throw new AppError('Only a LOST task can be recovered through this entry.', {
          code: 'TASK_NOT_LOST', statusCode: 409,
        });
      }
      return requestProjectControlCommand(
        `/internal/project-control/v1/tasks/${encodedTaskId}/retry`,
        actor,
        {},
      );
    },

    async cancelTask(localProjectId: string, taskId: string, actor: string) {
      const { task } = await requireOwnedTask(localProjectId, taskId);
      if (TERMINAL_STATUSES.has(task.status)) return task;
      return requestProjectControlCommand(
        `/internal/project-control/v1/tasks/${encodeURIComponent(taskId)}/cancel`,
        actor,
        {},
      );
    },

    async retryTask(localProjectId: string, taskId: string, actor: string) {
      const { task } = await requireOwnedTask(localProjectId, taskId);
      if (!TERMINAL_STATUSES.has(task.status)) {
        throw new AppError('Retry requires the current Attempt to be terminal.', {
          code: 'TASK_NOT_TERMINAL', statusCode: 409,
        });
      }
      return requestProjectControlCommand(
        `/internal/project-control/v1/tasks/${encodeURIComponent(taskId)}/retry`,
        actor,
        {},
      );
    },

    async archiveTask(localProjectId: string, taskId: string, actor: string, reason: string) {
      const { task } = await requireOwnedTask(localProjectId, taskId, true);
      if (task.archivedAt) return mapTask(task);
      if (!TERMINAL_STATUSES.has(task.status)) {
        throw new AppError('Only a terminal task can be archived.', {
          code: 'TASK_NOT_TERMINAL', statusCode: 409,
        });
      }
      const archived = await requestProjectControlCommand<ControlTask>(
        `/internal/project-control/v1/tasks/${encodeURIComponent(taskId)}/archive`,
        actor,
        { reason: reason.trim() },
      );
      return mapTask(archived);
    },

    async createTaskFollowUp(
      localProjectId: string,
      taskId: string,
      actor: string,
      input: {
        parentAttemptId: string;
        clientRequestId: string;
        feedback: string;
        requestedAcceptance: string;
      },
    ) {
      const { task } = await requireOwnedTask(localProjectId, taskId);
      if (!TERMINAL_STATUSES.has(task.status)
        || task.attemptId !== input.parentAttemptId
        || task.resolutionStatus === 'RESOLVED'
        || task.resolutionStatus === 'CLOSED') {
        throw new AppError('Follow-up requires the current terminal Attempt and an open task.', {
          code: 'FOLLOW_UP_NOT_ALLOWED', statusCode: 409,
        });
      }
      return requestProjectControlCommand(
        `/internal/project-control/v1/tasks/${encodeURIComponent(taskId)}/follow-ups`,
        actor,
        {
          parentAttemptId: input.parentAttemptId,
          clientRequestId: input.clientRequestId,
          feedback: input.feedback,
          requestedAcceptance: input.requestedAcceptance,
          additionalContext: {},
        },
      );
    },

    async acceptTaskResult(
      localProjectId: string,
      taskId: string,
      actor: string,
      input: {
        attemptId: string;
        clientRequestId: string;
        decision: 'RESOLVED' | 'NEEDS_FOLLOW_UP' | 'CLOSED';
        reason: string;
      },
    ) {
      const { task } = await requireOwnedTask(localProjectId, taskId);
      if (!TERMINAL_STATUSES.has(task.status) || task.attemptId !== input.attemptId) {
        throw new AppError('Acceptance must target the current terminal Attempt.', {
          code: 'ACCEPTANCE_NOT_ALLOWED', statusCode: 409,
        });
      }
      return requestProjectControlCommand(
        `/internal/project-control/v1/tasks/${encodeURIComponent(taskId)}/acceptance`,
        actor,
        input,
      );
    },

    async decideTaskApproval(
      localProjectId: string,
      taskId: string,
      approvalId: string,
      actor: string,
      decision: 'APPROVED' | 'DENIED',
      message: string | null,
    ) {
      await requireOwnedTask(localProjectId, taskId);
      const approvals = await requestControlJson<ControlApproval[]>(
        `/internal/project-control/v1/tasks/${encodeURIComponent(taskId)}/approvals`,
      );
      if (!approvals.some((approval) => approval.id === approvalId && approval.status === 'PENDING')) {
        throw new AppError('The approval is no longer pending for this task.', {
          code: 'APPROVAL_NOT_PENDING', statusCode: 409,
        });
      }
      return requestProjectControlCommand(
        `/internal/project-control/v1/approvals/${encodeURIComponent(approvalId)}/decision`,
        actor,
        { decision, message },
      );
    },
  };
}
