type StateEntry = {
  entryId: string;
  entryType: string;
  title: string;
  content: string;
  authorityLevel: string;
  evidenceReferenceIds: string[];
};

export type BrainContextPackage = {
  packageId: string;
  packageType: 'BRAIN';
  version: {
    stateRevision: number;
    planVersion: number | null;
    executionWatermark: number;
    contextGeneratedAt: string;
    contextPackageVersion: '1.0';
  };
  project: { projectId: string; displayName: string };
  state: {
    goal: StateEntry | null;
    stage: StateEntry | null;
    summary: string | null;
    blocker: string | null;
    entries: StateEntry[];
  };
  decisions: StateEntry[];
  constraints: StateEntry[];
  risks: StateEntry[];
  derivedSystemFacts: Array<Record<string, unknown>>;
  activePlan?: {
    planId: string;
    name: string;
    versionNumber: number;
    objective: string;
    nodes: Array<{
      nodeKey: string;
      title: string;
      objective: string;
      executionState: string;
    }>;
  } | null;
};

export type ProjectBrainResult = {
  provider: 'zhishu-grounded';
  model: 'grounded-context-v1';
  permissions: typeof PROJECT_BRAIN_PERMISSIONS;
  message: string;
  citations: Array<{ sourceType: string; sourceId: string; label: string }>;
  generatedProposal: Record<string, unknown> | null;
  inputTokens: number;
  outputTokens: number;
};

const PROJECT_BRAIN_PERMISSIONS = {
  readPrebuiltContext: true,
  generateTypedProposal: true,
  shell: false,
  git: false,
  filesystemRead: false,
  filesystemWrite: false,
  runtimeDispatch: false,
  stateWrite: false,
  planPublish: false,
} as const;

function approximateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

/**
 * Runs the no-tool Project Brain over one prebuilt, versioned context package.
 * This runtime has no provider/runtime adapters and therefore cannot access shell,
 * files, Git, Task commands, State writes, or Plan publication.
 */
export function runProjectBrain(context: BrainContextPackage, question: string): ProjectBrainResult {
  const normalizedQuestion = question.trim();
  if (!normalizedQuestion) throw new Error('A Project Brain question is required.');
  if (context.packageType !== 'BRAIN' || context.version.contextPackageVersion !== '1.0') {
    throw new Error('Project Brain requires BrainContextPackageV1.');
  }

  const goal = context.state.goal?.content ?? '尚未确认目标';
  const stage = context.state.stage?.content ?? '尚未确认阶段';
  const summary = context.state.summary ?? '暂无状态摘要';
  const blocker = context.state.blocker ?? '未记录阻塞';
  const decisions = context.decisions.length > 0
    ? context.decisions.map((entry) => entry.title).join('、')
    : '暂无正式决策';
  const constraints = context.constraints.length > 0
    ? context.constraints.map((entry) => entry.title).join('、')
    : '暂无正式约束';
  const nextNode = context.activePlan?.nodes.find((node) => node.executionState === 'READY')
    ?? context.activePlan?.nodes.find((node) => [
      'VERIFYING', 'WAITING_APPROVAL', 'RUNNING', 'DISPATCHING',
    ].includes(node.executionState));
  const nextStep = nextNode
    ? `${nextNode.title}（${nextNode.nodeKey}，${nextNode.executionState}）：${nextNode.objective}`
    : context.activePlan
      ? '当前 Plan 没有 READY 或进行中的节点；请核对是否已全部完成，或由 Planner 提出下一版本。'
      : '当前没有已发布 Plan；下一步应先形成并批准 Plan Proposal。';
  const message = [
    `下一步：${nextStep}`,
    `当前目标：${goal}。`,
    `当前阶段：${stage}。`,
    `状态摘要：${summary}。`,
    `当前阻塞：${blocker}。`,
    `关键决策：${decisions}。`,
    `有效约束：${constraints}。`,
    `以上结论来自 State Revision ${context.version.stateRevision}、执行水位 ${context.version.executionWatermark}；未记录的信息没有从聊天记忆推断。`,
  ].join('\n');
  const citations = [context.state.goal, context.state.stage, ...context.decisions, ...context.constraints]
    .filter((entry): entry is StateEntry => Boolean(entry))
    .map((entry) => ({ sourceType: 'PROJECT_STATE_ENTRY', sourceId: entry.entryId, label: entry.title }));
  if (nextNode && context.activePlan) {
    citations.push({
      sourceType: 'PLAN_NODE',
      sourceId: `${context.activePlan.planId}:${nextNode.nodeKey}`,
      label: nextNode.title,
    });
  }
  const asksForSuggestion = /建议|下一步|should|recommend/i.test(normalizedQuestion);
  const generatedProposal = asksForSuggestion ? {
    schemaVersion: '1.0',
    proposalType: 'DiscoveryProposalV1',
    status: 'DRAFT',
    baseContextVersion: context.version,
    payload: {
      title: 'Project Brain 建议',
      content: '请基于当前目标、阻塞和有效约束，由用户进一步编辑并确认下一步。',
      authorityLevel: 'AGENT_INFERRED',
    },
  } : null;
  return {
    provider: 'zhishu-grounded',
    model: 'grounded-context-v1',
    permissions: PROJECT_BRAIN_PERMISSIONS,
    message,
    citations,
    generatedProposal,
    inputTokens: approximateTokens(JSON.stringify(context) + normalizedQuestion),
    outputTokens: approximateTokens(message),
  };
}
