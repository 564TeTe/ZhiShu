export type TaskCenterAvailability = 'ready' | 'partial' | 'unavailable';

export type ProjectActivityEvent = {
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
};

export type ProjectActivityPage = {
  schemaVersion: '1.0';
  projectId: string;
  status: 'READY' | 'RESYNC_REQUIRED';
  requestedAfterCursor: number | null;
  latestCursor: number;
  retentionFloorCursor: number;
  nextCursor: number;
  hasMore: boolean;
  events: ProjectActivityEvent[];
};

export type ProjectActivitySubscriptionState = {
  status: 'CONNECTING' | 'LIVE' | 'RECONNECTING' | 'FALLBACK';
  lastCursor: number | null;
  lastEventAt: string | null;
  error: string | null;
};

export type ProjectMetrics = {
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

export type TaskCenterWarning = {
  code: string;
  message: string;
};

export type ProjectStateEntry = {
  entryId: string;
  entryType: 'GOAL' | 'STAGE' | 'FACT' | 'DECISION' | 'CONSTRAINT' | 'DISCOVERY' | 'RISK' | 'ASSUMPTION';
  title: string;
  content: string;
  authorityLevel: 'SYSTEM_VERIFIED' | 'USER_CONFIRMED' | 'AGENT_OBSERVED' | 'AGENT_INFERRED';
  sourceType: string;
  sourceId: string;
  createdBy: string;
  rationale: string | null;
  observedAt: string | null;
  confirmedAt: string | null;
  status: 'ACTIVE' | 'SUPERSEDED' | 'STALE' | 'DISMISSED';
  supersedesId: string | null;
  createdRevision: number;
  evidenceReferenceIds: string[];
  createdAt: string;
};

export type ProjectStateSnapshot = {
  schemaVersion: '1.0';
  projectId: string;
  stateRevision: number;
  goal: ProjectStateEntry | null;
  stage: ProjectStateEntry | null;
  summary: string | null;
  blocker: string | null;
  entries: ProjectStateEntry[];
  updatedAt: string;
};

export type InitialProjectStateInput = {
  goal: string;
  stage: string;
  summary: string | null;
  blocker: string | null;
  decisions: Array<{ title: string; content: string; rationale: string | null; evidenceReferenceIds: string[] }>;
  constraints: Array<{ title: string; content: string; rationale: string | null; evidenceReferenceIds: string[] }>;
  risks: Array<{ title: string; content: string; rationale: string | null; evidenceReferenceIds: string[] }>;
};

export type StateChangeCandidate = {
  candidateKey: string;
  entryType: 'DISCOVERY' | 'DECISION' | 'CONSTRAINT' | 'RISK';
  title: string;
  content: string;
  rationale: string | null;
  disposition: 'NEW' | 'STALE' | 'CONFLICT';
  mergedCandidateCount: number;
  existingEntryId: string | null;
  evidenceReferenceIds: string[];
};

export type StateChangeProposalPayload = {
  schemaVersion: '1.0';
  proposalType: 'STATE_CHANGE';
  roleVersion: 'state-steward:v1';
  promptVersion: string;
  reportId: string;
  result: 'SUCCESS' | 'PARTIAL' | 'BLOCKED' | 'FAILED';
  candidates: StateChangeCandidate[];
  summary: {
    extracted: number;
    newCandidates: number;
    staleCandidates: number;
    conflictCandidates: number;
    mergedCandidates: number;
  };
  permissions: Record<string, boolean>;
};

type ProjectStateProposalAudit = {
  proposalId: string;
  projectId: string;
  schemaVersion: '1.0';
  status: 'PENDING_APPROVAL' | 'APPLIED' | 'STALE' | 'REJECTED' | 'FAILED';
  baseStateRevision: number;
  validationResult: Record<string, unknown>;
  sourceType: string;
  sourceId: string;
  createdBy: string;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  appliedRevision: number | null;
};

export type InitialProjectStateProposal = ProjectStateProposalAudit & {
  proposalType: 'INITIAL_STATE';
  payload: InitialProjectStateInput;
};

export type StateChangeProposal = ProjectStateProposalAudit & {
  proposalType: 'STATE_CHANGE';
  payload: StateChangeProposalPayload;
};

export type ProjectStateProposal = InitialProjectStateProposal | StateChangeProposal;

export type BrainThread = {
  threadId: string;
  projectId: string;
  title: string;
  status: 'ACTIVE' | 'ARCHIVED';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type BrainMessage = {
  messageId: string;
  threadId: string;
  runId: string | null;
  role: 'USER' | 'BRAIN';
  content: string;
  contextPackageId: string;
  citations: Array<{ sourceType: string; sourceId: string; label: string }>;
  createdAt: string;
};

export type BrainRunResult = {
  runId: string;
  threadId: string;
  contextPackageId: string;
  status: 'SUCCEEDED';
  message: string;
  citations: BrainMessage['citations'];
  generatedProposal: Record<string, unknown> | null;
};

export type PlanNodeView = {
  nodeKey: string;
  title: string;
  objective: string;
  acceptanceCriteria: string[];
  priority: number;
  requiredCapabilities: string[];
  requiresHumanApproval: boolean;
  executable: boolean;
  capabilityWarnings: string[];
  executionState: string;
  dependsOn: string[];
};

export type ProjectPlanView = {
  planId: string;
  projectId: string;
  name: string;
  status: string;
  currentVersionId: string;
  versionNumber: number;
  objective: string;
  baseStateRevision: number;
  approvedBy: string;
  publishedAt: string;
  nodes: PlanNodeView[];
};

export type PlanProposalView = {
  proposalId: string;
  projectId: string;
  planId: string | null;
  proposalType: 'PLAN_PROPOSAL_V1' | 'PLAN_PATCH_PROPOSAL_V1';
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'PARTIALLY_APPROVED' | 'REJECTED' | 'STALE';
  baseStateRevision: number;
  payload: {
    name: string;
    objective: string;
    nodes: PlanNodeView[];
  };
  createdBy: string;
  createdAt: string;
  contextPackageId: string;
  sourceRoleVersion: string;
  diff: Array<{
    nodeKey: string;
    changeType: 'NEW' | 'INHERITED' | 'MODIFIED' | 'SUPERSEDED' | 'CANCELLED';
    previousNodeKey: string | null;
  }>;
};

export type IntegrationGateEvidence = {
  evidenceReferenceId: string;
  projectId: string;
  artifactId: string;
  artifactHash: string | null;
  sourceType: string;
  sourceId: string | null;
  purpose: string;
  referenceCreatedAt: string;
  capturedAt: string;
};

export type IntegrationGateEvent = {
  eventId: number;
  eventType: string;
  actor: string;
  payload: Record<string, unknown>;
  occurredAt: string;
};

export type IntegrationExecutionStepView = {
  stepId: string;
  ordinal: number;
  stepType: 'APPLY_WORKER' | 'CREATE_CANDIDATE' | 'BUILD' | 'TEST' | string;
  assignmentId: string | null;
  status: string;
  commandSummary: string;
  exitCode: number | null;
  stdoutSummary: string;
  stderrSummary: string;
  startedAt: string;
  completedAt: string | null;
};

export type IntegrationExecutionView = {
  runId: string;
  projectId: string;
  planId: string;
  gateId: string;
  attemptNumber: number;
  status: string;
  repositoryRoot: string;
  baseCommit: string;
  candidateCommit: string | null;
  integrationWorkspacePath: string;
  integrationBranchRef: string;
  workspaceState: string;
  failureCode: string | null;
  failureMessage: string | null;
  buildExitCode: number | null;
  testExitCode: number | null;
  replanProposalId: string | null;
  finalizationState: 'NOT_REQUESTED' | 'APPLYING' | 'APPLIED' | 'APPLY_FAILED' | 'CLEANUP_PENDING' | 'CLEANED';
  finalizedTargetRef: string | null;
  finalizedAt: string | null;
  finalizationFailureMessage: string | null;
  policyPreset: 'NPM' | 'MAVEN' | null;
  buildCommandSummary: string | null;
  testCommandSummary: string | null;
  createdBy: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  replayed: boolean;
  steps: IntegrationExecutionStepView[];
};

export type IntegrationAgentRunView = {
  agentRunId: string;
  projectId: string;
  gateId: string;
  integrationRunId: string;
  profileId: string;
  taskId: string | null;
  attemptId: string | null;
  status: string;
  objective: string;
  createdBy: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  failureMessage: string | null;
  replayed: boolean;
};

export type IntegrationGateView = {
  gateId: string;
  projectId: string;
  planId: string;
  planVersionId: string;
  scheduleId: string;
  schemaVersion: string;
  status: string;
  gateMode: string;
  applyState: string;
  evidenceStatus: string;
  evidenceCount: number;
  baseStateRevision: number;
  basePlanVersion: number;
  proposal: Record<string, unknown>;
  conflictAssessment: Record<string, unknown>;
  evidenceReferenceIds: string[];
  evidence: IntegrationGateEvidence[];
  clientRequestId: string;
  createdBy: string;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  events: IntegrationGateEvent[];
  executions: IntegrationExecutionView[];
};

export type WorkspaceLeaseView = {
  leaseId: string;
  workspaceMode: string;
  physicalWorkspaceKind: 'DIRECTORY_ONLY' | 'GIT_WORKTREE' | string;
  workspaceRef: string;
  branchRef: string;
  status: string;
  provisioningState: string;
  workspacePath: string | null;
  leaseExpiresAt: string | null;
  provisioningStartedAt: string | null;
  provisionedAt: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  cleanedAt: string | null;
  createdAt: string;
  releasedAt: string | null;
};

export type ParallelScheduleAssignmentView = {
  assignmentId: string;
  nodeKey: string;
  workerSlot: number;
  profileId: string;
  profileName: string;
  executor: string;
  status: string;
  scope: string[];
  requiredCapabilities: string[];
  profileCapabilities: string[];
  workspaceLease: WorkspaceLeaseView;
};

export type ParallelScheduleEvent = {
  eventId: number;
  eventType: string;
  actor: string;
  payload: Record<string, unknown>;
  occurredAt: string;
};

export type ParallelScheduleView = {
  scheduleId: string;
  projectId: string;
  planId: string;
  planVersionId: string;
  schemaVersion: string;
  status: string;
  baseStateRevision: number;
  basePlanVersion: number;
  maxWorkers: number;
  conflictAssessment: Record<string, unknown>;
  clientRequestId: string;
  createdBy: string;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  assignments: ParallelScheduleAssignmentView[];
  events: ParallelScheduleEvent[];
};

export type ParallelScheduleDispatchView = {
  dispatchId: string;
  scheduleId: string;
  planId: string;
  replayed: boolean;
  workOrders: WorkOrderView[];
};

export type SchedulerCapabilityProfileView = {
  profileId: string;
  profileName: string;
  executor: string;
  enabled: boolean;
  capabilities: string[];
};

export type SchedulerCapabilityProfileMatchView = SchedulerCapabilityProfileView & {
  missingCapabilities: string[];
  eligible: boolean;
};

export type SchedulerCapabilityNodeView = {
  nodeKey: string;
  title: string;
  executionState: string;
  executable: boolean;
  scope: string[];
  requiredCapabilities: string[];
  eligibleProfileCount: number;
  schedulable: boolean;
  activeSchedule: boolean;
  blockers: string[];
  profileMatches: SchedulerCapabilityProfileMatchView[];
};

export type SchedulerCapabilityMatrixView = {
  projectId: string;
  planId: string;
  planVersionId: string;
  schemaVersion: string;
  baseStateRevision: number;
  basePlanVersion: number;
  maxWorkers: number;
  summary: {
    profileCount: number;
    enabledProfileCount: number;
    nodeCount: number;
    schedulableNodeCount: number;
    blockedNodeCount: number;
  };
  profiles: SchedulerCapabilityProfileView[];
  nodes: SchedulerCapabilityNodeView[];
  generatedAt: string;
};

export type SchedulerCandidateMatchedProfileView = {
  profileId: string;
  profileName: string;
  executor: string;
};

export type SchedulerCandidateNodeView = {
  nodeKey: string;
  title: string;
  executionState: string;
  scope: string[];
  requiredCapabilities: string[];
  matchedProfile: SchedulerCandidateMatchedProfileView | null;
  schedulable: boolean;
  blockers: string[];
};

export type SchedulerCandidatePairView = {
  pairKey: string;
  leftNode: SchedulerCandidateNodeView;
  rightNode: SchedulerCandidateNodeView;
  dependencyAssessment: 'CLEAR' | 'CONFLICT';
  dependencyDirection: 'NONE' | 'LEFT_DEPENDS_ON_RIGHT' | 'RIGHT_DEPENDS_ON_LEFT' | 'BIDIRECTIONAL';
  scopeAssessment: 'DISJOINT' | 'OVERLAP' | 'MISSING' | 'TOO_BROAD';
  scopeConflicts: Array<{ leftScope: string; rightScope: string }>;
  workspaceIsolation: 'REQUIRED';
  activeScheduleConflict: boolean;
  eligible: boolean;
  blockers: string[];
};

export type SchedulerCandidatePairMatrixView = {
  projectId: string;
  planId: string;
  planVersionId: string;
  schemaVersion: '1.0';
  baseStateRevision: number;
  basePlanVersion: number;
  maxWorkers: number;
  summary: {
    nodeCount: number;
    totalPairCount: number;
    evaluatedPairCount: number;
    eligiblePairCount: number;
    blockedPairCount: number;
    truncated: boolean;
  };
  candidates: SchedulerCandidatePairView[];
  generatedAt: string;
};

export type SchedulerScoreBreakdownView = {
  eligibility: number;
  nodeReadiness: number;
  planPriority: number;
  dependency: number;
  scope: number;
  profileMatch: number;
  scheduleAvailability: number;
  blockerPenalty: number;
};

export type SchedulerRankedCandidateView = {
  rank: number;
  pairKey: string;
  leftNodeKey: string;
  rightNodeKey: string;
  eligible: boolean;
  score: number;
  scoreBreakdown: SchedulerScoreBreakdownView;
  reasons: string[];
  blockers: string[];
};

export type SchedulerRecommendationView = {
  projectId: string;
  planId: string;
  planVersionId: string;
  schemaVersion: '1.0';
  baseStateRevision: number;
  basePlanVersion: number;
  maxWorkers: number;
  recommendationFingerprint: string;
  baseline: {
    planVersionId: string;
    planVersion: number;
    stateRevision: number;
    status: 'CURRENT_SNAPSHOT';
  };
  determinism: {
    orderingRule: string;
    scoreModelVersion: string;
    candidateEvaluationLimit: number;
    rankLimit: number;
    stable: boolean;
  };
  summary: {
    evaluatedPairCount: number;
    eligiblePairCount: number;
    blockedPairCount: number;
    rankedCandidateCount: number;
    truncated: boolean;
  };
  recommendation: {
    status: 'RECOMMENDED' | 'NO_ELIGIBLE_CANDIDATE' | 'EVALUATION_TRUNCATED';
    pairKey: string | null;
    rank: number | null;
    score: number | null;
    reasons: string[];
  };
  rankedCandidates: SchedulerRankedCandidateView[];
  generatedAt: string;
};

export type WorkOrderStatus = 'CLAIMED' | 'DISPATCHING' | 'DISPATCHED' | 'RUNNING'
  | 'WAITING_APPROVAL' | 'AWAITING_VERIFICATION' | 'VERIFIED' | 'REJECTED'
  | 'FAILED' | 'LOST' | 'ABORTED';

export type ExecutionEvidenceSnapshot = {
  artifactId: string;
  artifactType: string;
  producer: string;
  content: string | null;
  hash: string | null;
  metadata: Record<string, unknown>;
  observedAt: string;
};

export type ExecutionReportView = {
  reportId: string;
  taskId: string;
  attemptId: string;
  schemaVersion: '1.0';
  attemptStatus: 'SUCCEEDED' | 'FAILED' | 'LOST' | 'ABORTED';
  agentClaims: ExecutionEvidenceSnapshot[];
  systemEvidence: ExecutionEvidenceSnapshot[];
  generatedAt: string;
  verificationId: string | null;
  decision: 'PASSED' | 'FAILED' | null;
  reason: string | null;
  verifiedBy: string | null;
  systemEvidenceCount: number | null;
  stateEntryId: string | null;
  brainThreadId: string | null;
  brainRunId: string | null;
  brainContextPackageId: string | null;
  brainSummary: string | null;
  verifiedAt: string | null;
};

export type WorkOrderView = {
  workOrderId: string;
  projectId: string;
  planId: string;
  planVersionId: string;
  versionNumber: number;
  nodeKey: string;
  schemaVersion: '1.0';
  clientRequestId: string;
  profileId: string;
  title: string;
  objective: string;
  acceptanceCriteria: string[];
  requiredCapabilities: string[];
  contextVersion: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
  status: WorkOrderStatus;
  statusReason: string | null;
  updatedAt: string;
  taskId: string;
  initialAttemptId: string;
  scheduleDispatchId?: string | null;
  scheduleId?: string | null;
  scheduleAssignmentId?: string | null;
  workspaceLeaseId?: string | null;
  executionWorkspacePath?: string | null;
  boundAt: string;
  reports: ExecutionReportView[];
  events: Array<{
    eventId: number;
    eventType: string;
    actor: string;
    payload: Record<string, unknown>;
    occurredAt: string;
  }>;
  replayed?: boolean;
};

export type WorkOrderVerificationResult = {
  verificationId: string;
  replayed: boolean;
  workOrder: WorkOrderView;
  brainRun: BrainRunResult & { replayed: boolean };
};

export type TaskCenterTask = {
  taskId: string;
  title: string;
  objective: string;
  status: string;
  attemptStatus: string;
  resolutionStatus: string;
  attemptId: string | null;
  attemptNumber: number | null;
  runtimeRunId: string | null;
  runtimeHealthStatus: 'NOT_MONITORED' | 'HEALTHY' | 'UNKNOWN' | 'LOST' | 'TERMINATED';
  lastHeartbeatAt: string | null;
  leaseExpiresAt: string | null;
  unknownSince: string | null;
  lostAt: string | null;
  lostReason: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  archivedAt: string | null;
  archivedBy: string | null;
  archiveReason: string | null;
};

export type TaskCenterTaskArchiveScope = 'ACTIVE' | 'ARCHIVED' | 'ALL';

export type TaskCenterTaskHistoryQuery = {
  archive: TaskCenterTaskArchiveScope;
  status: string | null;
  resolutionStatus: string | null;
  search: string;
  cursor?: string | null;
  limit?: number;
};

export type TaskCenterTaskPage = {
  items: TaskCenterTask[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type TaskCenterApproval = {
  approvalId: string;
  taskId: string;
  attemptId: string;
  toolName: string;
  riskLevel: string;
  expiresAt: string;
  createdAt: string;
};

export type TaskCenterArtifact = {
  artifactId: string;
  taskId: string;
  attemptId: string;
  artifactType: string;
  producer: string;
  contentExcerpt: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string;
};

export type TaskCenterFollowUp = {
  followUpId: string;
  taskId: string;
  parentAttemptId: string;
  attemptId: string;
  actor: string;
  feedbackExcerpt: string | null;
  requestedAcceptanceExcerpt: string | null;
  attemptNumber: number;
  attemptStatus: string;
  createdAt: string;
};

export type TaskCenterDashboard = {
  availability: TaskCenterAvailability;
  unavailableReason: 'PROJECT_NOT_REGISTERED' | 'CONTROL_PLANE_UNAVAILABLE' | 'TASK_DATA_UNAVAILABLE' | null;
  fetchedAt: string;
  staleAfterMs: number;
  project: {
    projectId: string;
    displayName: string;
    projectRef: string;
    controlProjectId: string | null;
    profileId: string | null;
    profileName: string | null;
  };
  dependencies: {
    controlPlane: { status: 'up' | 'degraded' | 'down' };
    runtimeDelivery: {
      status: 'up' | 'degraded' | 'misconfigured';
      configurationReady: boolean;
      pendingEvents: number;
      dueEvents: number;
      oldestEventAgeMs: number | null;
      lastError: string | null;
    };
  };
  summary: {
    totalTasks: number;
    activeTasks: number;
    waitingApproval: number;
    succeededTasks: number;
    failedTasks: number;
    lostTasks: number;
    abortedTasks: number;
    awaitingAcceptance: number;
  };
  tasks: TaskCenterTask[];
  approvals: TaskCenterApproval[];
  recentArtifacts: TaskCenterArtifact[];
  recentFollowUps: TaskCenterFollowUp[];
  approvalPolicy: {
    projectId: string;
    projectRoot: string;
    mode: string;
    allowedDirectories: string[];
    trustedCommands: string[][];
    approvalTimeoutSeconds: number;
    updatedAt: string;
  } | null;
  warnings: TaskCenterWarning[];
};

export type ProjectWorkspaceIdentity = {
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
    baseIdentityVersion: number;
  } | null;
  executionRegistration: {
    projectId: string;
    profileId: string;
    projectRef: string;
    profileName: string;
  } | null;
};

export type TaskCenterAttempt = {
  attemptId: string;
  attemptNumber: number;
  runtimeRunId: string | null;
  status: string;
  runtimeHealthStatus: 'NOT_MONITORED' | 'HEALTHY' | 'UNKNOWN' | 'LOST' | 'TERMINATED';
  lastHeartbeatAt: string | null;
  leaseExpiresAt: string | null;
  unknownSince: string | null;
  lostAt: string | null;
  lostReason: string | null;
  executor: string | null;
  modelAlias: string | null;
  connectionRef: string | null;
  approvalMode: string | null;
  requestedApprovalMode: string | null;
  startedAt: string | null;
  completedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  followUpId: string | null;
  parentAttemptId: string | null;
  followUpFeedback: string | null;
  requestedAcceptance: string | null;
  acceptanceDecision: string | null;
  acceptanceReason: string | null;
  acceptanceAt: string | null;
};

export type TaskCenterDetailApproval = {
  approvalId: string;
  attemptId: string;
  runtimeRunId: string;
  runtimeApprovalId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  riskLevel: string | null;
  status: string;
  attemptStatus: string;
  expiresAt: string | null;
  decidedAt: string | null;
  decisionSource: string | null;
  policy: string | null;
  rule: string | null;
  reason: string | null;
  createdAt: string;
};

export type TaskCenterDetailArtifact = {
  artifactId: string;
  attemptId: string;
  artifactType: string;
  producer: string;
  contentPlain: string | null;
  storagePath: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  hash: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type TaskCenterDetailFollowUp = {
  followUpId: string;
  parentAttemptId: string;
  attemptId: string;
  actor: string;
  feedback: string;
  requestedAcceptance: string;
  additionalContext: Record<string, unknown>;
  attemptNumber: number;
  attemptStatus: string;
  errorCode: string | null;
  errorMessage: string | null;
  acceptanceDecision: string | null;
  acceptanceReason: string | null;
  acceptanceAt: string | null;
  createdAt: string;
};

export type TaskCenterAcceptance = {
  id: string;
  taskId: string;
  attemptId: string;
  clientRequestId: string;
  actor: string;
  decision: 'RESOLVED' | 'NEEDS_FOLLOW_UP' | 'CLOSED';
  reason: string;
  createdAt: string;
};

export type TaskCenterTaskDetail = {
  availability: 'ready' | 'partial';
  fetchedAt: string;
  staleAfterMs: number;
  project: TaskCenterDashboard['project'];
  task: TaskCenterTask;
  attempts: TaskCenterAttempt[];
  approvals: TaskCenterDetailApproval[];
  artifacts: TaskCenterDetailArtifact[];
  followUps: TaskCenterDetailFollowUp[];
  warnings: TaskCenterWarning[];
};
