import { GitBranch, GitMerge, ListChecks, PlayCircle, Plus, ShieldAlert, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '../../../../shared/view/ui';
import {
  createPlannerProposal,
  extractStateCandidates,
  claimWorkOrder,
  fetchPlanProposals,
  fetchPlans,
  fetchWorkOrders,
  publishPlanProposal,
  rejectPlanProposal,
  verifyWorkOrder,
} from '../../api/taskCenterApi';
import type { PlanNodeView, PlanProposalView, ProjectPlanView, WorkOrderView } from '../../model/taskCenterModel';
import { capabilityLabel, planNodeStateLabel, proposalChangeLabel } from '../taskCenterLabels';

import { WorkOrderHistory } from './WorkOrderHistory';
import { IntegrationGateHistory } from './IntegrationGateHistory';
import { IntegrationGateControl } from './IntegrationGateControl';
import { IntegrationExecutionControl } from './IntegrationExecutionControl';
import { ParallelScheduleHistory } from './ParallelScheduleHistory';
import { ParallelScheduleProposalComposer } from './ParallelScheduleProposalComposer';
import { ParallelScheduleProposalDecision } from './ParallelScheduleProposalDecision';
import { WorkspaceProvision } from './DirectoryOnlyWorkspaceProvision';
import { ParallelScheduleExecution } from './DirectoryOnlyScheduleExecution';
import { SchedulerCandidatePairs } from './SchedulerCandidatePairs';
import { SchedulerRecommendation } from './SchedulerRecommendation';
import { WorkerCapabilityMatrix } from './WorkerCapabilityMatrix';

type AdvancedSection = 'readiness' | 'schedule' | 'integration';

const advancedSections = [
  { id: 'readiness', label: '调度准备', description: '执行能力、节点阻塞和并行建议' },
  { id: 'schedule', label: '并行执行', description: '调度提案、隔离工作区和执行记录' },
  { id: 'integration', label: '集成验证', description: '集成门禁、构建测试和最终应用' },
] satisfies Array<{ id: AdvancedSection; label: string; description: string }>;

function dependencySafeSelection(
  nodes: PlanNodeView[],
  current: Record<string, boolean>,
  nodeKey: string,
  checked: boolean,
): Record<string, boolean> {
  const next = { ...current, [nodeKey]: checked };
  const byKey = new Map(nodes.map((node) => [node.nodeKey, node]));
  if (checked) {
    const includeDependencies = (key: string) => {
      next[key] = true;
      byKey.get(key)?.dependsOn.forEach(includeDependencies);
    };
    includeDependencies(nodeKey);
  } else {
    const removeDependents = (key: string) => {
      next[key] = false;
      nodes.filter((node) => node.dependsOn.includes(key)).forEach((node) => removeDependents(node.nodeKey));
    };
    removeDependents(nodeKey);
  }
  return next;
}

export function PlanCenterPanel({
  mode = 'plan',
  projectId,
  onExecutionChanged,
  refreshToken = 0,
}: {
  mode?: 'plan' | 'advanced';
  projectId: string;
  onExecutionChanged?: () => void;
  refreshToken?: number;
}) {
  const [plans, setPlans] = useState<ProjectPlanView[]>([]);
  const [proposals, setProposals] = useState<PlanProposalView[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrderView[]>([]);
  const [objective, setObjective] = useState('');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [advancedSection, setAdvancedSection] = useState<AdvancedSection>('readiness');
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initializedProposalId = useRef<string | null>(null);
  const pending = proposals.find((proposal) => proposal.status === 'PENDING_APPROVAL') ?? null;

  const reload = useCallback(async () => {
    const [planValues, proposalValues, workOrderValues] = await Promise.all([
      fetchPlans(projectId), fetchPlanProposals(projectId), fetchWorkOrders(projectId),
    ]);
    setPlans(planValues);
    setProposals(proposalValues);
    setWorkOrders(workOrderValues);
    const nextPending = proposalValues.find((proposal) => proposal.status === 'PENDING_APPROVAL');
    if (nextPending && initializedProposalId.current !== nextPending.proposalId) {
      setSelected(Object.fromEntries(nextPending.payload.nodes.map((node) => [node.nodeKey, true])));
      initializedProposalId.current = nextPending.proposalId;
    } else if (!nextPending && initializedProposalId.current !== null) {
      initializedProposalId.current = null;
      setSelected({});
    }
  }, [projectId]);

  useEffect(() => {
    void reload().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [reload, refreshToken]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void reload().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [reload]);

  const selectedKeys = useMemo(
    () => Object.entries(selected).filter(([, value]) => value).map(([key]) => key),
    [selected],
  );

  const act = async (action: () => Promise<unknown>) => {
    setIsWorking(true);
    setError(null);
    try { await action(); await reload(); onExecutionChanged?.(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setIsWorking(false); }
  };

  return (
    <Card className="rounded-none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {mode === 'plan'
            ? <ListChecks className="h-4 w-4 text-primary" />
            : <GitMerge className="h-4 w-4 text-amber-600" />}
          {mode === 'plan' ? '新建与执行' : '高级功能'}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {mode === 'plan'
            ? '描述你想完成的事情，知枢会先整理执行步骤。确认步骤后，再逐项开始执行。'
            : '多 Agent 并行、隔离工作区和代码集成设置。普通任务不需要进入这里。'}
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {mode === 'advanced' && plans.length > 0 && (
          <div>
            <div
              className="grid gap-1 rounded-md border bg-muted/30 p-1 sm:grid-cols-3"
              role="tablist"
              aria-label="高级调度与集成功能"
            >
              {advancedSections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  role="tab"
                  aria-selected={advancedSection === section.id}
                  onClick={() => setAdvancedSection(section.id)}
                  className={`min-h-10 rounded px-3 py-2 text-left transition-colors ${
                    advancedSection === section.id
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <span className="block text-sm font-medium">{section.label}</span>
                  <span className="mt-0.5 block text-[11px] leading-4">{section.description}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {mode === 'plan' && !pending && (
          <form
            className="border border-border/70 bg-muted/10 p-4 sm:p-5"
            onSubmit={(event) => {
              event.preventDefault();
              if (objective.trim()) void act(() => createPlannerProposal(projectId, objective.trim()));
            }}
          >
            <label htmlFor="task-objective" className="text-sm font-semibold">你想让知枢完成什么？</label>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              可以直接使用自然语言描述目标、范围和完成标准。此操作只会生成执行步骤，不会立即修改项目。
            </p>
            <textarea
              id="task-objective"
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              placeholder="例如：为登录页面增加忘记密码功能，补充接口校验和测试，不修改现有登录流程。"
              className="mt-4 min-h-28 w-full resize-y border border-input bg-background/70 px-3 py-2.5 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
              maxLength={4000}
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">下一步：查看并确认知枢整理的执行步骤</span>
              <Button type="submit" disabled={isWorking || !objective.trim()}>
                <Plus className="mr-2 h-4 w-4" />生成执行步骤
              </Button>
            </div>
          </form>
        )}

        {mode === 'plan' && pending && (
          <div className="border border-primary/30 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-xs font-semibold text-primary">第 2 步：确认执行步骤</div>
                <div className="mt-1 font-semibold">{pending.payload.name}</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  勾选准备执行的步骤。依赖步骤会自动保持选中；确认后才会创建正式任务。
                </p>
              </div>
              <Badge variant="outline">等待确认</Badge>
            </div>
            <div className="mt-4 space-y-2">
              {pending.payload.nodes.map((node) => {
                const diff = pending.diff.find((item) => item.nodeKey === node.nodeKey);
                return (
                  <label key={node.nodeKey} className="flex cursor-pointer gap-3 rounded-md border p-3">
                    <input
                      type="checkbox"
                      checked={selected[node.nodeKey] ?? false}
                      onChange={(event) => setSelected((value) => dependencySafeSelection(
                        pending.payload.nodes, value, node.nodeKey, event.target.checked,
                      ))}
                      className="mt-1"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {node.title}<Badge variant="secondary">{proposalChangeLabel(diff?.changeType ?? 'NEW')}</Badge>
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">{node.objective}</span>
                      <span className="mt-2 flex flex-wrap gap-1">
                        {node.dependsOn.map((dependency) => (
                          <Badge key={dependency} variant="outline" className="gap-1 text-[10px]">
                            <GitBranch className="h-3 w-3" />依赖 {dependency}
                          </Badge>
                        ))}
                        {node.requiredCapabilities.map((capability) => (
                          <Badge key={capability} variant="outline" className="text-[10px]">{capabilityLabel(capability)}</Badge>
                        ))}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                disabled={isWorking || selectedKeys.length === 0}
                onClick={() => void act(() => publishPlanProposal(projectId, pending.proposalId, selectedKeys))}
              >
                <ListChecks className="mr-2 h-4 w-4" />确认所选步骤
              </Button>
              <Button
                variant="outline"
                disabled={isWorking}
                onClick={() => void act(() => rejectPlanProposal(projectId, pending.proposalId))}
              >
                <X className="mr-2 h-4 w-4" />重新描述任务
              </Button>
            </div>
          </div>
        )}

        {plans.length === 0 && !pending && (
          <div className="border border-dashed bg-muted/10 px-4 py-8 text-center text-sm text-muted-foreground">
            {mode === 'plan'
              ? '还没有已确认的任务步骤。请先在上方描述要完成的事情。'
              : '当前没有可以使用高级功能的执行计划。'}
          </div>
        )}

        {plans.map((plan) => (
          <div key={plan.planId} className="rounded-md border p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-xs font-semibold text-emerald-600">已确认的执行步骤</div>
                <div className="mt-1 font-medium">{plan.name}</div>
                <p className="mt-1 text-xs text-muted-foreground">{plan.objective}</p>
              </div>
              <Badge variant="outline">版本 {plan.versionNumber}</Badge>
            </div>
            <div className="mt-3">
              {mode === 'plan' && plan.nodes.map((node, index) => (
                <div key={node.nodeKey} className="border-t py-4 first:border-t-0 first:pt-2 last:pb-1">
                  <div className="flex gap-3 text-sm">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{node.title}</span>
                        <Badge variant="secondary">{planNodeStateLabel(node.executionState)}</Badge>
                    {node.executable
                      && ['READY', 'FAILED', 'BLOCKED'].includes(node.executionState)
                      && !workOrders.some((item) => item.planId === plan.planId
                        && item.nodeKey === node.nodeKey
                        && ['CLAIMED', 'DISPATCHING', 'DISPATCHED', 'RUNNING',
                          'WAITING_APPROVAL', 'AWAITING_VERIFICATION'].includes(item.status)) && (
                        <Button
                        size="sm"
                        className="ml-auto"
                        disabled={isWorking}
                        onClick={() => void act(() => claimWorkOrder(
                          projectId, plan.planId, node.nodeKey, crypto.randomUUID(),
                        ))}
                        >
                          <PlayCircle className="mr-1 h-3.5 w-3.5" />开始执行
                        </Button>
                    )}
                    {!node.executable && <Badge variant="destructive"><ShieldAlert className="mr-1 h-3 w-3" />能力不足</Badge>}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{node.objective}</p>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                        {node.dependsOn.length > 0 && <span>依赖：{node.dependsOn.join('、')}</span>}
                        <span>完成标准：{node.acceptanceCriteria.length} 条</span>
                      </div>
                      {node.capabilityWarnings.map((warning) => (
                        <p key={warning} className="mt-1 text-[11px] text-destructive">{warning}</p>
                      ))}
                      <WorkOrderHistory
                        workOrders={workOrders.filter((item) => item.planId === plan.planId && item.nodeKey === node.nodeKey)}
                        isWorking={isWorking}
                        onVerify={(workOrderId, reportId, decision, reason) => act(() => verifyWorkOrder(
                          projectId, workOrderId, reportId, decision, reason,
                        ))}
                        onExtractStateCandidates={(reportId) => act(() => extractStateCandidates(projectId, reportId))}
                      />
                    </div>
                  </div>
                </div>
              ))}
              {mode === 'advanced' && advancedSection === 'readiness' && (
                <>
                  <WorkerCapabilityMatrix
                    projectId={projectId}
                    planId={plan.planId}
                    currentPlanVersionId={plan.currentVersionId}
                    currentPlanVersionNumber={plan.versionNumber}
                    planBaseStateRevision={plan.baseStateRevision}
                    refreshToken={refreshToken}
                  />
                  <SchedulerRecommendation
                    projectId={projectId}
                    planId={plan.planId}
                    currentPlanVersionId={plan.currentVersionId}
                    currentPlanVersionNumber={plan.versionNumber}
                    planBaseStateRevision={plan.baseStateRevision}
                    refreshToken={refreshToken}
                  />
                  <SchedulerCandidatePairs
                    projectId={projectId}
                    planId={plan.planId}
                    currentPlanVersionId={plan.currentVersionId}
                    currentPlanVersionNumber={plan.versionNumber}
                    planBaseStateRevision={plan.baseStateRevision}
                    refreshToken={refreshToken}
                  />
                </>
              )}
              {mode === 'advanced' && advancedSection === 'schedule' && (
                <>
                  <ParallelScheduleProposalComposer
                    projectId={projectId}
                    planId={plan.planId}
                    currentPlanVersionId={plan.currentVersionId}
                    currentPlanVersionNumber={plan.versionNumber}
                    refreshToken={refreshToken}
                    onCreated={onExecutionChanged}
                  />
                  <ParallelScheduleProposalDecision
                    projectId={projectId}
                    planId={plan.planId}
                    refreshToken={refreshToken}
                    onDecided={onExecutionChanged}
                  />
                  <WorkspaceProvision
                    projectId={projectId}
                    planId={plan.planId}
                    refreshToken={refreshToken}
                    onProvisioned={onExecutionChanged}
                  />
                  <ParallelScheduleExecution
                    projectId={projectId}
                    planId={plan.planId}
                    refreshToken={refreshToken}
                    onDispatched={onExecutionChanged}
                  />
                  <ParallelScheduleHistory
                    projectId={projectId}
                    planId={plan.planId}
                    currentPlanVersionId={plan.currentVersionId}
                    currentPlanVersionNumber={plan.versionNumber}
                    planBaseStateRevision={plan.baseStateRevision}
                    refreshToken={refreshToken}
                  />
                </>
              )}
              {mode === 'advanced' && advancedSection === 'integration' && (
                <>
                  <IntegrationGateControl
                    projectId={projectId}
                    planId={plan.planId}
                    currentPlanVersionId={plan.currentVersionId}
                    currentPlanVersionNumber={plan.versionNumber}
                    refreshToken={refreshToken}
                    onChanged={onExecutionChanged}
                  />
                  <IntegrationGateHistory
                    projectId={projectId}
                    planId={plan.planId}
                    currentPlanVersionId={plan.currentVersionId}
                    currentPlanVersionNumber={plan.versionNumber}
                    planBaseStateRevision={plan.baseStateRevision}
                    refreshToken={refreshToken}
                  />
                  <IntegrationExecutionControl
                    projectId={projectId}
                    planId={plan.planId}
                    refreshToken={refreshToken}
                    onChanged={onExecutionChanged}
                  />
                </>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
