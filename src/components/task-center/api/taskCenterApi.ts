import { authenticatedFetch } from '../../../utils/api';
import type {
  BrainMessage,
  BrainRunResult,
  BrainThread,
  InitialProjectStateInput,
  IntegrationGateView,
  IntegrationExecutionView,
  IntegrationAgentRunView,
  ParallelScheduleView,
  PlanProposalView,
  ParallelScheduleDispatchView,
  ProjectActivityPage,
  ProjectMetrics,
  ProjectWorkspaceIdentity,
  ProjectPlanView,
  ProjectStateProposal,
  ProjectStateSnapshot,
  SchedulerCandidatePairMatrixView,
  SchedulerCapabilityMatrixView,
  SchedulerRecommendationView,
  TaskCenterAcceptance,
  TaskCenterDashboard,
  TaskCenterDetailApproval,
  TaskCenterDetailFollowUp,
  TaskCenterTask,
  TaskCenterTaskDetail,
  TaskCenterTaskHistoryQuery,
  TaskCenterTaskPage,
  WorkOrderVerificationResult,
  WorkOrderView,
} from '../model/taskCenterModel';

function responseError(body: unknown, status: number, label: string): Error {
  const message = body && typeof body === 'object'
    ? String(
      (body as { error?: { message?: unknown }; message?: unknown }).error?.message
        ?? (body as { message?: unknown }).message
        ?? `${label}（${status}）`,
    )
    : `${label}（${status}）`;
  return new Error(message);
}

export async function fetchTaskCenterDashboard(
  projectId: string,
  signal?: AbortSignal,
): Promise<TaskCenterDashboard> {
  const response = await authenticatedFetch(
    `/api/task-center/projects/${encodeURIComponent(projectId)}/dashboard`,
    { signal },
  );
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    throw responseError(body, response.status, '驾驶台请求失败');
  }
  return body as TaskCenterDashboard;
}

export async function registerTaskCenterProject(projectId: string): Promise<ProjectWorkspaceIdentity> {
  const response = await authenticatedFetch(
    `/api/task-center/projects/${encodeURIComponent(projectId)}/registration`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
  );
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw responseError(body, response.status, '项目登记失败');
  return body as ProjectWorkspaceIdentity;
}

export async function confirmTaskCenterWorkspaceBinding(
  projectId: string,
  identity: ProjectWorkspaceIdentity,
): Promise<void> {
  if (!identity.binding || !identity.proposal) {
    throw new Error('当前项目没有可确认的 Workspace Binding 提案');
  }
  const response = await authenticatedFetch(
    `/api/task-center/projects/${encodeURIComponent(projectId)}/workspace-binding/confirm`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: identity.binding.workspaceId,
        proposalId: identity.proposal.proposalId,
        action: identity.proposal.action,
        machineId: identity.proposal.machineId,
        localProjectId: identity.proposal.localProjectId,
        workspacePath: identity.proposal.workspacePath,
        baseIdentityVersion: identity.proposal.baseIdentityVersion,
        clientRequestId: `workspace-binding-${crypto.randomUUID()}`,
      }),
    },
  );
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw responseError(body, response.status, 'Workspace Binding 确认失败');
}

export async function fetchProjectActivity(
  projectId: string,
  after?: number,
  signal?: AbortSignal,
): Promise<ProjectActivityPage> {
  const query = new URLSearchParams({ limit: '100' });
  if (after !== undefined) query.set('after', String(after));
  const response = await authenticatedFetch(
    `/api/task-center/projects/${encodeURIComponent(projectId)}/activity?${query.toString()}`,
    { signal },
  );
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw responseError(body, response.status, '项目变化订阅读取失败');
  return body as ProjectActivityPage;
}

export async function fetchProjectMetrics(
  projectId: string,
  windowHours = 168,
  signal?: AbortSignal,
): Promise<ProjectMetrics> {
  const response = await authenticatedFetch(
    `/api/task-center/projects/${encodeURIComponent(projectId)}/metrics?windowHours=${windowHours}`,
    { signal },
  );
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw responseError(body, response.status, '项目运行指标读取失败');
  return body as ProjectMetrics;
}

export async function fetchTaskCenterTaskDetail(
  projectId: string,
  taskId: string,
  signal?: AbortSignal,
): Promise<TaskCenterTaskDetail> {
  const response = await authenticatedFetch(
    `/api/task-center/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`,
    { signal },
  );
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    throw responseError(body, response.status, '任务详情请求失败');
  }
  return body as TaskCenterTaskDetail;
}

export async function fetchTaskCenterTaskHistory(
  projectId: string,
  query: TaskCenterTaskHistoryQuery,
  signal?: AbortSignal,
): Promise<TaskCenterTaskPage> {
  const parameters = new URLSearchParams({
    archive: query.archive,
    limit: String(query.limit ?? 25),
  });
  if (query.status) parameters.set('status', query.status);
  if (query.resolutionStatus) parameters.set('resolutionStatus', query.resolutionStatus);
  if (query.search.trim()) parameters.set('search', query.search.trim());
  if (query.cursor) parameters.set('cursor', query.cursor);
  const response = await authenticatedFetch(
    `/api/task-center/projects/${encodeURIComponent(projectId)}/tasks?${parameters.toString()}`,
    { signal },
  );
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw responseError(body, response.status, '任务历史请求失败');
  return body as TaskCenterTaskPage;
}

export async function retryLostTask(projectId: string, taskId: string): Promise<void> {
  const response = await authenticatedFetch(
    `/api/task-center/projects/${encodeURIComponent(projectId)}`
      + `/tasks/${encodeURIComponent(taskId)}/retry-lost`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
  );
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw responseError(body, response.status, 'LOST Attempt recovery failed');
}

async function postTaskCommand<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  const response = await authenticatedFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const responseBody = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw responseError(responseBody, response.status, '任务操作失败');
  return responseBody as T;
}

function clientRequestId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function cancelTask(projectId: string, taskId: string): Promise<TaskCenterTask> {
  return postTaskCommand<TaskCenterTask>(
    `/api/task-center/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/cancel`,
  );
}

export function retryTask(projectId: string, taskId: string): Promise<TaskCenterTask> {
  return postTaskCommand<TaskCenterTask>(
    `/api/task-center/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/retry`,
  );
}

export function archiveTask(projectId: string, taskId: string, reason: string): Promise<TaskCenterTask> {
  return postTaskCommand<TaskCenterTask>(
    `/api/task-center/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/archive`,
    { reason },
  );
}

export function createTaskFollowUp(
  projectId: string,
  taskId: string,
  input: {
    parentAttemptId: string;
    feedback: string;
    requestedAcceptance: string;
    clientRequestId?: string;
  },
): Promise<TaskCenterDetailFollowUp> {
  return postTaskCommand<TaskCenterDetailFollowUp>(
    `/api/task-center/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/follow-ups`,
    { ...input, clientRequestId: input.clientRequestId ?? clientRequestId('follow-up') },
  );
}

export function acceptTaskResult(
  projectId: string,
  taskId: string,
  input: {
    attemptId: string;
    decision: 'RESOLVED' | 'NEEDS_FOLLOW_UP' | 'CLOSED';
    reason: string;
    clientRequestId?: string;
  },
): Promise<TaskCenterAcceptance> {
  return postTaskCommand<TaskCenterAcceptance>(
    `/api/task-center/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/acceptance`,
    { ...input, clientRequestId: input.clientRequestId ?? clientRequestId('acceptance') },
  );
}

export function decideTaskApproval(
  projectId: string,
  taskId: string,
  approvalId: string,
  decision: 'APPROVED' | 'DENIED',
  message?: string,
): Promise<TaskCenterDetailApproval> {
  return postTaskCommand<TaskCenterDetailApproval>(
    `/api/task-center/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`
      + `/approvals/${encodeURIComponent(approvalId)}/decision`,
    { decision, message: message?.trim() || null },
  );
}

export async function fetchProjectState(
  projectId: string,
  signal?: AbortSignal,
): Promise<ProjectStateSnapshot> {
  const response = await authenticatedFetch(
    `/api/task-center/projects/${encodeURIComponent(projectId)}/state`,
    { signal },
  );
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw responseError(body, response.status, '项目状态读取失败');
  return body as ProjectStateSnapshot;
}

export async function createInitialProjectStateProposal(
  projectId: string,
  input: InitialProjectStateInput,
): Promise<ProjectStateProposal> {
  const response = await authenticatedFetch(
    `/api/task-center/projects/${encodeURIComponent(projectId)}/state/initial-proposals`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw responseError(body, response.status, '初始状态提案创建失败');
  return body as ProjectStateProposal;
}

export async function confirmProjectStateProposal(
  projectId: string,
  proposalId: string,
  clientRequestId: string,
): Promise<void> {
  const response = await authenticatedFetch(
    `/api/task-center/projects/${encodeURIComponent(projectId)}`
      + `/state/proposals/${encodeURIComponent(proposalId)}/confirm`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientRequestId }),
    },
  );
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw responseError(body, response.status, '状态提案确认失败');
}

export async function rejectProjectStateProposal(
  projectId: string,
  proposalId: string,
  clientRequestId: string,
  reason: string,
): Promise<void> {
  const response = await authenticatedFetch(
    `/api/task-center/projects/${encodeURIComponent(projectId)}`
      + `/state/proposals/${encodeURIComponent(proposalId)}/reject`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientRequestId, reason }),
    },
  );
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw responseError(body, response.status, '状态提案拒绝失败');
}

export async function fetchProjectStateProposals(
  projectId: string,
  signal?: AbortSignal,
): Promise<ProjectStateProposal[]> {
  const response = await authenticatedFetch(
    `/api/task-center/projects/${encodeURIComponent(projectId)}/state/proposals`,
    { signal },
  );
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw responseError(body, response.status, 'State Steward 提案历史读取失败');
  return body as ProjectStateProposal[];
}

export async function extractStateCandidates(
  projectId: string,
  reportId: string,
): Promise<ProjectStateProposal> {
  const response = await authenticatedFetch(
    `/api/task-center/projects/${encodeURIComponent(projectId)}`
      + `/state/steward/reports/${encodeURIComponent(reportId)}/proposal`,
    { method: 'POST' },
  );
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw responseError(body, response.status, 'State 候选提取失败');
  return body as ProjectStateProposal;
}

export async function fetchBrainThreads(projectId: string): Promise<BrainThread[]> {
  const response = await authenticatedFetch(
    `/api/task-center/projects/${encodeURIComponent(projectId)}/brain/threads`,
  );
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw responseError(body, response.status, 'Brain 会话读取失败');
  return body as BrainThread[];
}

export async function fetchBrainMessages(projectId: string, threadId: string): Promise<BrainMessage[]> {
  const response = await authenticatedFetch(
    `/api/task-center/projects/${encodeURIComponent(projectId)}`
      + `/brain/threads/${encodeURIComponent(threadId)}/messages`,
  );
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw responseError(body, response.status, 'Brain 消息读取失败');
  return body as BrainMessage[];
}

export async function askProjectBrain(
  projectId: string,
  question: string,
  threadId: string | null,
): Promise<BrainRunResult> {
  const response = await authenticatedFetch(
    `/api/task-center/projects/${encodeURIComponent(projectId)}/brain/ask`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, threadId }),
    },
  );
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw responseError(body, response.status, 'Project Brain 运行失败');
  return body as BrainRunResult;
}

export async function fetchPlans(projectId: string): Promise<ProjectPlanView[]> {
  const response = await authenticatedFetch(`/api/task-center/projects/${encodeURIComponent(projectId)}/plans`);
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw responseError(body, response.status, '计划读取失败');
  return body as ProjectPlanView[];
}

export async function fetchPlanProposals(projectId: string): Promise<PlanProposalView[]> {
  const response = await authenticatedFetch(
    `/api/task-center/projects/${encodeURIComponent(projectId)}/plans/proposals`,
  );
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw responseError(body, response.status, '计划提案读取失败');
  return body as PlanProposalView[];
}

export async function fetchIntegrationGates(
  projectId: string,
  planId: string,
  signal?: AbortSignal,
): Promise<IntegrationGateView[]> {
  const response = await authenticatedFetch(
    `/api/task-center/projects/${encodeURIComponent(projectId)}`
      + `/plans/${encodeURIComponent(planId)}/integration-gates`,
    { signal },
  );
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw responseError(body, response.status, 'Integration Gate history request failed');
  return body as IntegrationGateView[];
}

export async function createIntegrationGate(
  projectId: string,
  planId: string,
  input: {
    clientRequestId: string;
    scheduleId: string;
    baseStateRevision: number;
    basePlanVersion: number;
    evidenceReferenceIds: string[];
  },
): Promise<IntegrationGateView> {
  const response = await authenticatedFetch(
    `/api/task-center/projects/${encodeURIComponent(projectId)}`
      + `/plans/${encodeURIComponent(planId)}/integration-gates`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw responseError(body, response.status, 'Integration Gate creation failed');
  return body as IntegrationGateView;
}

export async function confirmIntegrationGate(
  projectId: string,
  planId: string,
  gateId: string,
  clientRequestId: string,
): Promise<IntegrationGateView> {
  const response = await authenticatedFetch(
    `/api/task-center/projects/${encodeURIComponent(projectId)}`
      + `/plans/${encodeURIComponent(planId)}/integration-gates/${encodeURIComponent(gateId)}/confirm`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientRequestId }),
    },
  );
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw responseError(body, response.status, 'Integration Gate confirmation failed');
  return body as IntegrationGateView;
}

export async function rejectIntegrationGate(
  projectId: string,
  planId: string,
  gateId: string,
  clientRequestId: string,
  reason: string,
): Promise<IntegrationGateView> {
  const response = await authenticatedFetch(
    `/api/task-center/projects/${encodeURIComponent(projectId)}`
      + `/plans/${encodeURIComponent(planId)}/integration-gates/${encodeURIComponent(gateId)}/reject`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientRequestId, reason }),
    },
  );
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw responseError(body, response.status, 'Integration Gate rejection failed');
  return body as IntegrationGateView;
}

export async function fetchParallelSchedules(
  projectId: string,
  planId: string,
  signal?: AbortSignal,
): Promise<ParallelScheduleView[]> {
  const response = await authenticatedFetch(
    `/api/task-center/projects/${encodeURIComponent(projectId)}`
      + `/plans/${encodeURIComponent(planId)}/parallel-schedules`,
    { signal },
  );
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw responseError(body, response.status, 'Parallel Schedule history request failed');
  return body as ParallelScheduleView[];
}

export async function createParallelScheduleProposal(
  projectId: string,
  planId: string,
  input: {
    clientRequestId: string;
    baseStateRevision: number;
    basePlanVersion: number;
    nodeKeys: [string, string];
    physicalWorkspaceKind?: 'DIRECTORY_ONLY' | 'GIT_WORKTREE';
  },
): Promise<ParallelScheduleView> {
  const response = await authenticatedFetch(
    `/api/task-center/projects/${encodeURIComponent(projectId)}`
      + `/plans/${encodeURIComponent(planId)}/parallel-schedules`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw responseError(body, response.status, 'Parallel Schedule Proposal creation failed');
  return body as ParallelScheduleView;
}

export async function confirmParallelScheduleProposal(
  projectId: string,
  planId: string,
  scheduleId: string,
  clientRequestId: string,
): Promise<ParallelScheduleView> {
  const response = await authenticatedFetch(
    `/api/task-center/projects/${encodeURIComponent(projectId)}`
      + `/plans/${encodeURIComponent(planId)}/parallel-schedules/${encodeURIComponent(scheduleId)}/confirm`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientRequestId }),
    },
  );
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw responseError(body, response.status, 'Parallel Schedule Proposal confirmation failed');
  return body as ParallelScheduleView;
}

export async function rejectParallelScheduleProposal(
  projectId: string,
  planId: string,
  scheduleId: string,
  clientRequestId: string,
  reason: string,
): Promise<ParallelScheduleView> {
  const response = await authenticatedFetch(
    `/api/task-center/projects/${encodeURIComponent(projectId)}`
      + `/plans/${encodeURIComponent(planId)}/parallel-schedules/${encodeURIComponent(scheduleId)}/reject`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientRequestId, reason }),
    },
  );
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw responseError(body, response.status, 'Parallel Schedule Proposal rejection failed');
  return body as ParallelScheduleView;
}

export async function provisionParallelScheduleWorkspaceLease(
  projectId: string,
  planId: string,
  scheduleId: string,
  leaseId: string,
  clientRequestId: string,
): Promise<ParallelScheduleView> {
  const response = await authenticatedFetch(
    `/api/task-center/projects/${encodeURIComponent(projectId)}`
      + `/plans/${encodeURIComponent(planId)}/parallel-schedules/${encodeURIComponent(scheduleId)}`
      + `/workspace-leases/${encodeURIComponent(leaseId)}/provision`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientRequestId }),
    },
  );
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw responseError(body, response.status, 'Directory Workspace Provision failed');
  return body as ParallelScheduleView;
}

export async function dispatchParallelSchedule(
  projectId: string,
  planId: string,
  scheduleId: string,
  clientRequestId: string,
): Promise<ParallelScheduleDispatchView> {
  const response = await authenticatedFetch(
    `/api/task-center/projects/${encodeURIComponent(projectId)}`
      + `/plans/${encodeURIComponent(planId)}/parallel-schedules/${encodeURIComponent(scheduleId)}/dispatch`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientRequestId }),
    },
  );
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw responseError(body, response.status, 'Parallel Schedule dispatch failed');
  return body as ParallelScheduleDispatchView;
}

export async function executeIntegrationGate(
  projectId: string,
  planId: string,
  gateId: string,
  clientRequestId: string,
): Promise<IntegrationExecutionView> {
  const response = await authenticatedFetch(
    `/api/task-center/projects/${encodeURIComponent(projectId)}`
      + `/plans/${encodeURIComponent(planId)}/integration-gates/${encodeURIComponent(gateId)}/executions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientRequestId }),
    },
  );
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw responseError(body, response.status, 'Integration execution failed to start');
  return body as IntegrationExecutionView;
}

export async function finalizeIntegrationExecution(
  projectId: string,
  planId: string,
  gateId: string,
  runId: string,
  clientRequestId: string,
  candidateCommit: string,
): Promise<IntegrationExecutionView> {
  const response = await authenticatedFetch(
    `/api/task-center/projects/${encodeURIComponent(projectId)}`
      + `/plans/${encodeURIComponent(planId)}/integration-gates/${encodeURIComponent(gateId)}`
      + `/executions/${encodeURIComponent(runId)}/finalize`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientRequestId, candidateCommit }),
    },
  );
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw responseError(body, response.status, 'Integration finalization failed');
  return body as IntegrationExecutionView;
}

export async function startIntegrationAgent(
  projectId: string,
  planId: string,
  gateId: string,
  runId: string,
  clientRequestId: string,
  profileId?: string | null,
): Promise<IntegrationAgentRunView> {
  const response = await authenticatedFetch(
    `/api/task-center/projects/${encodeURIComponent(projectId)}`
      + `/plans/${encodeURIComponent(planId)}/integration-gates/${encodeURIComponent(gateId)}`
      + `/executions/${encodeURIComponent(runId)}/agent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientRequestId, profileId: profileId ?? null }),
    },
  );
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw responseError(body, response.status, 'Integration Agent failed to start');
  return body as IntegrationAgentRunView;
}

export async function fetchSchedulerCapabilityMatrix(
  projectId: string,
  planId: string,
  signal?: AbortSignal,
): Promise<SchedulerCapabilityMatrixView> {
  const response = await authenticatedFetch(
    `/api/task-center/projects/${encodeURIComponent(projectId)}`
      + `/plans/${encodeURIComponent(planId)}/capability-matrix`,
    { signal },
  );
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw responseError(body, response.status, 'Worker Capability Matrix request failed');
  return body as SchedulerCapabilityMatrixView;
}

export async function fetchSchedulerCandidatePairs(
  projectId: string,
  planId: string,
  signal?: AbortSignal,
): Promise<SchedulerCandidatePairMatrixView> {
  const response = await authenticatedFetch(
    `/api/task-center/projects/${encodeURIComponent(projectId)}`
      + `/plans/${encodeURIComponent(planId)}/parallel-schedule-candidates`,
    { signal },
  );
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw responseError(body, response.status, 'Parallel Schedule candidate request failed');
  return body as SchedulerCandidatePairMatrixView;
}

export async function fetchSchedulerRecommendation(
  projectId: string,
  planId: string,
  signal?: AbortSignal,
): Promise<SchedulerRecommendationView> {
  const response = await authenticatedFetch(
    `/api/task-center/projects/${encodeURIComponent(projectId)}`
      + `/plans/${encodeURIComponent(planId)}/parallel-schedule-recommendation`,
    { signal },
  );
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw responseError(body, response.status, 'Scheduler recommendation request failed');
  return body as SchedulerRecommendationView;
}

export async function createPlannerProposal(projectId: string, objective: string): Promise<PlanProposalView> {
  const response = await authenticatedFetch(
    `/api/task-center/projects/${encodeURIComponent(projectId)}/plans/proposals`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ objective }) },
  );
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw responseError(body, response.status, 'Planner 提案创建失败');
  return body as PlanProposalView;
}

export async function publishPlanProposal(
  projectId: string,
  proposalId: string,
  approvedNodeKeys: string[],
): Promise<ProjectPlanView> {
  const response = await authenticatedFetch(
    `/api/task-center/projects/${encodeURIComponent(projectId)}`
      + `/plans/proposals/${encodeURIComponent(proposalId)}/publish`,
    {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvedNodeKeys }),
    },
  );
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw responseError(body, response.status, '计划发布失败');
  return body as ProjectPlanView;
}

export async function rejectPlanProposal(projectId: string, proposalId: string): Promise<void> {
  const response = await authenticatedFetch(
    `/api/task-center/projects/${encodeURIComponent(projectId)}`
      + `/plans/proposals/${encodeURIComponent(proposalId)}/reject`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: '用户拒绝' }) },
  );
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw responseError(body, response.status, '计划提案拒绝失败');
}

export async function fetchWorkOrders(
  projectId: string,
  planId?: string,
): Promise<WorkOrderView[]> {
  const query = new URLSearchParams();
  if (planId) query.set('planId', planId);
  const suffix = query.size > 0 ? `?${query}` : '';
  const response = await authenticatedFetch(
    `/api/task-center/projects/${encodeURIComponent(projectId)}/work-orders${suffix}`,
  );
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw responseError(body, response.status, 'Work Order 读取失败');
  return body as WorkOrderView[];
}

export async function claimWorkOrder(
  projectId: string,
  planId: string,
  nodeKey: string,
  clientRequestId: string,
): Promise<WorkOrderView> {
  const response = await authenticatedFetch(
    `/api/task-center/projects/${encodeURIComponent(projectId)}/work-orders/claims`,
    {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId, nodeKey, clientRequestId }),
    },
  );
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw responseError(body, response.status, 'Work Order 执行派发失败');
  return body as WorkOrderView;
}

export async function verifyWorkOrder(
  projectId: string,
  workOrderId: string,
  reportId: string,
  decision: 'PASSED' | 'FAILED',
  reason: string,
): Promise<WorkOrderVerificationResult> {
  const response = await authenticatedFetch(
    `/api/task-center/projects/${encodeURIComponent(projectId)}`
      + `/work-orders/${encodeURIComponent(workOrderId)}/verifications`,
    {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportId, decision, reason }),
    },
  );
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw responseError(body, response.status, 'Execution Report 验证失败');
  return body as WorkOrderVerificationResult;
}
