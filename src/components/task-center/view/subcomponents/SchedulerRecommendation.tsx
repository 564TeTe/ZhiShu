import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  ListOrdered,
  Loader2,
  ShieldX,
} from 'lucide-react';
import { useCallback } from 'react';

import { Badge } from '../../../../shared/view/ui';
import { fetchSchedulerRecommendation } from '../../api/taskCenterApi';
import { useReadOnlyPollingResource } from '../../hooks/useReadOnlyPollingResource';
import type {
  SchedulerRankedCandidateView,
  SchedulerRecommendationView,
  SchedulerScoreBreakdownView,
} from '../../model/taskCenterModel';
import { schedulerBlockerLabel } from '../taskCenterLabels';

function formatDate(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : value;
}

function signedScore(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function ScoreBreakdown({ value }: { value: SchedulerScoreBreakdownView }) {
  const entries: Array<[string, number]> = [
    ['可用性', value.eligibility],
    ['节点就绪度', value.nodeReadiness],
    ['计划优先级', value.planPriority],
    ['依赖关系', value.dependency],
    ['工作范围', value.scope],
    ['配置匹配', value.profileMatch],
    ['调度可用性', value.scheduleAvailability],
    ['阻塞扣分', value.blockerPenalty],
  ];
  return (
    <dl className="grid gap-x-3 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-4">
      {entries.map(([label, score]) => (
        <div key={label} className="flex min-w-0 items-center justify-between gap-2 border-b py-1">
          <dt className="truncate text-muted-foreground">{label}</dt>
          <dd className={score < 0 ? 'font-mono text-destructive' : 'font-mono'}>{signedScore(score)}</dd>
        </div>
      ))}
    </dl>
  );
}

function RankedCandidate({ candidate }: { candidate: SchedulerRankedCandidateView }) {
  return (
    <details className="rounded-md border bg-background/40" open={candidate.rank === 1}>
      <summary className="cursor-pointer list-none p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs font-medium">
            <Badge variant="outline">#{candidate.rank}</Badge>
            <span className="break-words">{candidate.leftNodeKey} + {candidate.rightNodeKey}</span>
            <Badge variant={candidate.eligible ? 'secondary' : 'destructive'}>
              {candidate.eligible ? '可用' : '被阻塞'}
            </Badge>
          </div>
          <span className="font-mono text-xs">Score {candidate.score}</span>
        </div>
      </summary>
      <div className="space-y-3 border-t p-3">
        <ScoreBreakdown value={candidate.scoreBreakdown} />
        <div className="grid gap-3 text-xs md:grid-cols-2">
          <section>
            <h5 className="mb-1 font-semibold">排序依据</h5>
            <ul className="space-y-1 text-muted-foreground">
              {candidate.reasons.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          </section>
          <section>
            <h5 className="mb-1 font-semibold">阻塞原因</h5>
            {candidate.blockers.length === 0 ? (
              <span className="text-muted-foreground">无</span>
            ) : (
              <div className="flex flex-wrap gap-1">
                {candidate.blockers.map((blocker) => (
                  <Badge key={blocker} variant="destructive">{schedulerBlockerLabel(blocker)}</Badge>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </details>
  );
}

function recommendationVariant(status: SchedulerRecommendationView['recommendation']['status']) {
  return status === 'RECOMMENDED' ? 'secondary' as const : 'destructive' as const;
}

export function SchedulerRecommendation({
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
  const load = useCallback(
    (signal: AbortSignal) => fetchSchedulerRecommendation(projectId, planId, signal),
    [planId, projectId],
  );
  const { data: view, error, isLoading } = useReadOnlyPollingResource<SchedulerRecommendationView>({
    scopeKey: `${projectId}:${planId}`,
    load,
    refreshToken,
  });

  const currentBaseline = view !== null
    && view.planVersionId === currentPlanVersionId
    && view.basePlanVersion === currentPlanVersionNumber
    && view.baseStateRevision === planBaseStateRevision;
  const rankTruncated = view !== null
    && view.summary.rankedCandidateCount < view.summary.evaluatedPairCount;

  return (
    <section className="mt-4 border-t pt-4" aria-label="调度建议">
      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
        <ListOrdered className="h-4 w-4 text-primary" aria-hidden="true" />
        调度建议
        <Badge variant="outline">只读</Badge>
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

      {isLoading && view === null ? (
        <div className="mt-3 flex items-center gap-2 py-3 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />正在计算调度建议
        </div>
      ) : error && view === null ? null : view === null ? (
        <div className="mt-3 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          暂时无法读取调度建议
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            <Badge variant={recommendationVariant(view.recommendation.status)}>
              {view.recommendation.status === 'RECOMMENDED' ? '推荐并行组合' : view.recommendation.status === 'NO_ELIGIBLE_CANDIDATE' ? '暂无可用组合' : '评估结果不完整'}
            </Badge>
            <Badge variant="outline">可用 {view.summary.eligiblePairCount}</Badge>
            <Badge variant="outline">被阻塞 {view.summary.blockedPairCount}</Badge>
            <Badge variant="outline">已评估 {view.summary.evaluatedPairCount}</Badge>
            <Badge variant="outline">已排序 {view.summary.rankedCandidateCount}</Badge>
            {view.summary.truncated ? (
              <Badge variant="destructive">评估数量已截断</Badge>
            ) : (
              <Badge variant="outline">评估已完成</Badge>
            )}
            {rankTruncated ? (
              <Badge variant="outline">
                排序范围 {view.summary.rankedCandidateCount} / {view.summary.evaluatedPairCount}
              </Badge>
            ) : (
              <Badge variant="outline">排序已完成</Badge>
            )}
            <Badge variant={currentBaseline ? 'secondary' : 'destructive'}>
              {currentBaseline ? '基线一致' : '基线已变化'}
            </Badge>
            <Badge variant="outline">生成于 {formatDate(view.generatedAt)}</Badge>
          </div>

          <section className="bg-muted/30 p-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              {view.recommendation.status === 'RECOMMENDED'
                ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                : <ShieldX className="h-4 w-4" aria-hidden="true" />}
              <h5 className="font-semibold">推荐组合</h5>
              {view.recommendation.pairKey && <Badge variant="secondary">{view.recommendation.pairKey}</Badge>}
              {view.recommendation.rank !== null && <Badge variant="outline">排名 {view.recommendation.rank}</Badge>}
              {view.recommendation.score !== null && (
                <Badge variant="outline">得分 {view.recommendation.score}</Badge>
              )}
            </div>
            <ul className="mt-2 space-y-1 text-muted-foreground">
              {view.recommendation.reasons.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
            <dl className="mt-3 grid gap-x-3 gap-y-1 sm:grid-cols-[auto_minmax(0,1fr)]">
              <dt className="text-muted-foreground">建议指纹</dt>
              <dd className="break-all font-mono text-[10px]">{view.recommendationFingerprint}</dd>
              <dt className="text-muted-foreground">排序规则</dt>
              <dd className="break-words font-mono text-[10px]">{view.determinism.orderingRule}</dd>
              <dt className="text-muted-foreground">评分模型</dt>
              <dd>{view.determinism.scoreModelVersion}</dd>
              <dt className="text-muted-foreground">评估上限</dt>
              <dd>{view.determinism.candidateEvaluationLimit}</dd>
              <dt className="text-muted-foreground">排序上限</dt>
              <dd>{view.determinism.rankLimit}</dd>
              <dt className="text-muted-foreground">结果稳定</dt>
              <dd>{view.determinism.stable ? '是' : '否'}</dd>
              <dt className="text-muted-foreground">快照基线</dt>
              <dd>{view.baseline.status === 'CURRENT_SNAPSHOT' ? '当前快照' : view.baseline.status} / 版本 {view.baseline.planVersion} / 状态版本 {view.baseline.stateRevision}</dd>
            </dl>
          </section>

          <section>
            <h5 className="mb-2 text-xs font-semibold">稳定排序</h5>
            {view.rankedCandidates.length === 0 ? (
              <div className="flex items-center justify-center gap-2 rounded-md border border-dashed px-3 py-4 text-xs text-muted-foreground">
                <CircleDashed className="h-4 w-4" aria-hidden="true" />暂无可排序的并行组合
              </div>
            ) : (
              <div className="space-y-2">
                {view.rankedCandidates.map((candidate) => (
                  <RankedCandidate key={candidate.pairKey} candidate={candidate} />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
