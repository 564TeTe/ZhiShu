import {
  AlertTriangle,
  CircleDashed,
  Loader2,
  Network,
  ShieldCheck,
  ShieldX,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { Badge } from '../../../../shared/view/ui';
import { fetchSchedulerCandidatePairs } from '../../api/taskCenterApi';
import { useReadOnlyPollingResource } from '../../hooks/useReadOnlyPollingResource';
import type {
  SchedulerCandidateNodeView,
  SchedulerCandidatePairMatrixView,
  SchedulerCandidatePairView,
} from '../../model/taskCenterModel';
import { capabilityLabel, planNodeStateLabel, schedulerBlockerLabel } from '../taskCenterLabels';

const CANDIDATE_FILTERS = ['ALL', 'ELIGIBLE', 'BLOCKED'] as const;

function formatDate(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : value;
}

function StringList({ values, emptyLabel = '暂无记录' }: { values: string[]; emptyLabel?: string }) {
  if (values.length === 0) return <span className="text-muted-foreground">{emptyLabel}</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {values.map((value) => <Badge key={value} variant="outline" className="text-[10px]">{value}</Badge>)}
    </div>
  );
}

function CandidateNode({ node, label }: { node: SchedulerCandidateNodeView; label: string }) {
  return (
    <section className="min-w-0 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase text-muted-foreground">{label}</span>
        <span className="font-medium">{node.title}</span>
        <Badge variant={node.schedulable ? 'secondary' : 'destructive'}>
          {node.schedulable ? '可调度' : '被阻塞'}
        </Badge>
        <Badge variant="outline">{planNodeStateLabel(node.executionState)}</Badge>
      </div>
      <div className="mt-1 break-words font-mono text-[10px] text-muted-foreground">{node.nodeKey}</div>
      <dl className="mt-3 grid gap-x-3 gap-y-2 sm:grid-cols-[auto_minmax(0,1fr)]">
        <dt className="text-muted-foreground">工作范围</dt>
        <dd><StringList values={node.scope} emptyLabel="未明确工作范围" /></dd>
        <dt className="text-muted-foreground">所需能力</dt>
        <dd><StringList values={node.requiredCapabilities.map(capabilityLabel)} /></dd>
        <dt className="text-muted-foreground">匹配配置</dt>
        <dd>
          {node.matchedProfile ? (
            <div className="flex flex-wrap items-center gap-1">
              <span>{node.matchedProfile.profileName}</span>
              <Badge variant="outline">{node.matchedProfile.executor}</Badge>
            </div>
          ) : <span className="text-muted-foreground">没有可用配置</span>}
        </dd>
        <dt className="text-muted-foreground">节点阻塞</dt>
        <dd><StringList values={node.blockers.map(schedulerBlockerLabel)} emptyLabel="无" /></dd>
      </dl>
    </section>
  );
}

function CandidatePair({ candidate }: { candidate: SchedulerCandidatePairView }) {
  return (
    <details className="rounded-md border bg-background/40" open={!candidate.eligible}>
      <summary className="cursor-pointer list-none p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs font-medium">
            {candidate.eligible
              ? <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              : <ShieldX className="h-3.5 w-3.5" aria-hidden="true" />}
            <span className="break-words">{candidate.leftNode.nodeKey} + {candidate.rightNode.nodeKey}</span>
            <Badge variant={candidate.eligible ? 'secondary' : 'destructive'}>
              {candidate.eligible ? '可用' : '被阻塞'}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-1">
            <Badge variant={candidate.dependencyAssessment === 'CLEAR' ? 'outline' : 'destructive'}>
              依赖 {candidate.dependencyAssessment === 'CLEAR' ? '清晰' : '冲突'}
            </Badge>
            <Badge variant={candidate.scopeAssessment === 'DISJOINT' ? 'outline' : 'destructive'}>
              范围 {candidate.scopeAssessment === 'DISJOINT' ? '不重叠' : candidate.scopeAssessment === 'OVERLAP' ? '重叠' : candidate.scopeAssessment === 'MISSING' ? '缺失' : '过宽'}
            </Badge>
          </div>
        </div>
      </summary>
      <div className="space-y-3 border-t pb-3">
        <div className="flex flex-wrap gap-1.5 px-3 pt-3">
          <Badge variant="outline">工作区隔离：必须</Badge>
          {candidate.dependencyDirection !== 'NONE' && (
            <Badge variant="destructive">{candidate.dependencyDirection}</Badge>
          )}
          {candidate.activeScheduleConflict && <Badge variant="destructive">已有活动调度冲突</Badge>}
          {candidate.blockers.map((blocker) => <Badge key={blocker} variant="destructive">{schedulerBlockerLabel(blocker)}</Badge>)}
        </div>

        <div className="grid divide-y border-y md:grid-cols-2 md:divide-x md:divide-y-0">
          <CandidateNode node={candidate.leftNode} label="节点一" />
          <CandidateNode node={candidate.rightNode} label="节点二" />
        </div>

        {candidate.scopeConflicts.length > 0 && (
          <section className="px-3 text-xs">
            <h5 className="mb-2 font-semibold">工作范围冲突</h5>
            <div className="space-y-1.5">
              {candidate.scopeConflicts.map((conflict) => (
                <div
                  key={`${conflict.leftScope}:${conflict.rightScope}`}
                  className="grid gap-1 border-l-2 border-destructive/50 pl-2 sm:grid-cols-2"
                >
                  <span className="break-all font-mono text-[10px]">{conflict.leftScope}</span>
                  <span className="break-all font-mono text-[10px]">{conflict.rightScope}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </details>
  );
}

export function SchedulerCandidatePairs({
  projectId,
  planId,
  currentPlanVersionId,
  currentPlanVersionNumber,
  planBaseStateRevision,
  refreshToken = 0,
}: {
  projectId: string;
  planId: string;
  currentPlanVersionId: string;
  currentPlanVersionNumber: number;
  planBaseStateRevision: number;
  refreshToken?: number;
}) {
  const [candidateFilter, setCandidateFilter] = useState<(typeof CANDIDATE_FILTERS)[number]>('ALL');
  const load = useCallback(
    (signal: AbortSignal) => fetchSchedulerCandidatePairs(projectId, planId, signal),
    [planId, projectId],
  );
  const { data: matrix, error, isLoading } = useReadOnlyPollingResource<SchedulerCandidatePairMatrixView>({
    scopeKey: `${projectId}:${planId}`,
    load,
    refreshToken,
  });

  const visibleCandidates = useMemo(() => matrix?.candidates.filter((candidate) => (
    candidateFilter === 'ALL'
      || (candidateFilter === 'ELIGIBLE' && candidate.eligible)
      || (candidateFilter === 'BLOCKED' && !candidate.eligible)
  )) ?? [], [candidateFilter, matrix]);

  const currentBaseline = matrix !== null
    && matrix.planVersionId === currentPlanVersionId
    && matrix.basePlanVersion === currentPlanVersionNumber
    && matrix.baseStateRevision === planBaseStateRevision;

  return (
    <section className="mt-4 border-t pt-4" aria-label="并行调度候选组合">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Network className="h-4 w-4 text-primary" aria-hidden="true" />
          并行调度候选组合
          <Badge variant="outline">只读</Badge>
        </div>
        <select
          value={candidateFilter}
          onChange={(event) => setCandidateFilter(event.target.value as (typeof CANDIDATE_FILTERS)[number])}
          className="h-8 rounded-md border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
          aria-label="筛选并行调度候选组合"
        >
          {CANDIDATE_FILTERS.map((filter) => (
            <option key={filter} value={filter}>
              {filter === 'ALL' ? '全部组合' : filter === 'ELIGIBLE' ? '可用' : '被阻塞'}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div
          className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {isLoading && matrix === null ? (
        <div className="mt-3 flex items-center gap-2 py-3 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />正在计算候选组合
        </div>
      ) : error && matrix === null ? null : matrix === null ? (
        <div className="mt-3 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          暂时无法读取候选组合
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="secondary">可用 {matrix.summary.eligiblePairCount}</Badge>
            <Badge variant="outline">被阻塞 {matrix.summary.blockedPairCount}</Badge>
            <Badge variant="outline">
              已评估 {matrix.summary.evaluatedPairCount} / {matrix.summary.totalPairCount}
            </Badge>
            <Badge variant="outline">最大并行数 {matrix.maxWorkers}</Badge>
            <Badge variant={currentBaseline ? 'secondary' : 'destructive'}>
              {currentBaseline ? '基线一致' : '基线已变化'}
            </Badge>
            {matrix.summary.truncated && <Badge variant="destructive">评估数量已截断</Badge>}
            <Badge variant="outline">生成于 {formatDate(matrix.generatedAt)}</Badge>
          </div>

          {visibleCandidates.length === 0 ? (
            <div className="flex items-center justify-center gap-2 rounded-md border border-dashed px-3 py-4 text-xs text-muted-foreground">
              <CircleDashed className="h-4 w-4" aria-hidden="true" />
              {matrix.candidates.length === 0 ? '尚无双节点候选组合' : '没有符合筛选条件的组合'}
            </div>
          ) : (
            <div className="space-y-2">
              {visibleCandidates.map((candidate) => (
                <CandidatePair key={candidate.pairKey} candidate={candidate} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
