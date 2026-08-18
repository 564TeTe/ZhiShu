export type PlannerContextPackage = {
  packageId: string;
  packageType: 'PLANNER';
  version: {
    stateRevision: number;
    planVersion: number | null;
    executionWatermark: number;
    contextGeneratedAt: string;
    contextPackageVersion: '1.0';
  };
  project: { projectId: string; displayName: string };
  state: { goal: { content: string } | null; stage: { content: string } | null; blocker: string | null };
  activePlan?: {
    planId: string;
    versionNumber: number;
    name: string;
    objective: string;
    nodes: Array<{ nodeKey: string; title: string; objective: string; executionState: string }>;
  } | null;
  constraints: Array<{ content: string }>;
};

const PLANNER_PERMISSIONS = {
  readPrebuiltContext: true,
  generatePlanProposal: true,
  shell: false,
  filesystemWrite: false,
  taskCreate: false,
  runtimeDispatch: false,
  planPublish: false,
} as const;

/** Generates a typed, non-authoritative plan proposal without creating Tasks or publishing a Plan Version. */
export function runProjectPlanner(context: PlannerContextPackage, objective: string) {
  const normalizedObjective = objective.trim();
  if (!normalizedObjective) throw new Error('Planner objective is required.');
  if (context.packageType !== 'PLANNER' || context.version.contextPackageVersion !== '1.0') {
    throw new Error('Project Planner requires PlannerContextPackageV1.');
  }
  const activeNodes = context.activePlan?.nodes ?? [];
  const scopePrevious = activeNodes.find((node) => node.nodeKey === 'scope')?.nodeKey;
  const implementationPrevious = activeNodes.find((node) => node.nodeKey.startsWith('implement'))?.nodeKey;
  const verificationPrevious = activeNodes.find((node) => node.nodeKey.startsWith('verify'))?.nodeKey;
  const nextVersion = (context.activePlan?.versionNumber ?? 0) + 1;
  const implementationKey = context.activePlan ? `implement-v${nextVersion}` : 'implement';
  const verificationKey = context.activePlan ? `verify-v${nextVersion}` : 'verify';
  return {
    roleVersion: 'project-planner:v1' as const,
    promptVersion: 'project-planner-prompt:v1' as const,
    permissions: PLANNER_PERMISSIONS,
    proposal: {
      schemaVersion: '1.0',
      name: normalizedObjective.slice(0, 80),
      objective: normalizedObjective,
      creationReason: '由 project-planner:v1 基于 PlannerContextPackageV1 生成，等待用户批准。',
      planId: context.activePlan?.planId ?? null,
      baseStateRevision: context.version.stateRevision,
      basePlanVersion: context.activePlan?.versionNumber ?? null,
      contextPackageId: context.packageId,
      provider: 'zhishu-grounded',
      model: 'grounded-planner-v1',
      permissions: PLANNER_PERMISSIONS,
      nodes: [
        {
          nodeKey: 'scope', title: '确认范围与约束',
          objective: scopePrevious
            ? activeNodes.find((node) => node.nodeKey === scopePrevious)?.objective ?? `确认“${normalizedObjective}”的范围、约束和依赖。`
            : `确认“${normalizedObjective}”的范围、约束和依赖。`,
          scope: [], acceptanceCriteria: ['范围、依赖和约束可由用户核对'], priority: 30,
          requiredCapabilities: ['READ_FILE'], requiresHumanApproval: false, dependsOn: [],
          ...(scopePrevious ? { relationType: 'INHERITED', previousNodeKey: scopePrevious } : {}),
        },
        {
          nodeKey: implementationKey, title: '实施目标变更', objective: normalizedObjective,
          scope: [], acceptanceCriteria: [
            '实现结果满足目标与已确认范围',
            '相关测试通过且系统证据可追溯',
          ], priority: 20,
          requiredCapabilities: ['READ_FILE', 'WRITE_FILE', 'TEST'],
          requiresHumanApproval: true,
          dependsOn: [],
          ...(implementationPrevious
            ? { relationType: 'SUPERSEDED', previousNodeKey: implementationPrevious }
            : {}),
        },
        {
          nodeKey: verificationKey, title: '验证并整理证据', objective: '运行验证并形成可追溯证据。',
          scope: [], acceptanceCriteria: ['相关测试通过', '验证结果与证据可追溯'], priority: 10,
          requiredCapabilities: ['TEST'], requiresHumanApproval: false, dependsOn: [implementationKey],
          ...(verificationPrevious
            ? { relationType: 'SUPERSEDED', previousNodeKey: verificationPrevious }
            : {}),
        },
      ],
    },
  };
}
