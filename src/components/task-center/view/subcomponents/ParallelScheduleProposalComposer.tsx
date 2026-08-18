import {
  AlertTriangle,
  CheckCircle2,
  Folder,
  GitBranch,
  Loader2,
  Plus,
  ShieldAlert,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Badge, Button } from '../../../../shared/view/ui';
import {
  createParallelScheduleProposal,
  fetchSchedulerCandidatePairs,
} from '../../api/taskCenterApi';
import { useReadOnlyPollingResource } from '../../hooks/useReadOnlyPollingResource';
import type {
  ParallelScheduleView,
  SchedulerCandidatePairMatrixView,
} from '../../model/taskCenterModel';

function shortId(value: string): string {
  return value.length > 16 ? `${value.slice(0, 12)}...` : value;
}

export function ParallelScheduleProposalComposer({
  projectId,
  planId,
  currentPlanVersionId,
  currentPlanVersionNumber,
  refreshToken = 0,
  onCreated,
}: {
  projectId: string;
  planId: string;
  currentPlanVersionId: string;
  currentPlanVersionNumber: number;
  refreshToken?: number;
  onCreated?: () => void;
}) {
  const [selectedPairKey, setSelectedPairKey] = useState('');
  const [physicalWorkspaceKind, setPhysicalWorkspaceKind] = useState<'DIRECTORY_ONLY' | 'GIT_WORKTREE'>('DIRECTORY_ONLY');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [createdSchedule, setCreatedSchedule] = useState<ParallelScheduleView | null>(null);
  const [retryRequest, setRetryRequest] = useState<{ requestKey: string; clientRequestId: string } | null>(null);

  const load = useCallback(
    (signal: AbortSignal) => fetchSchedulerCandidatePairs(projectId, planId, signal),
    [planId, projectId],
  );
  const { data: matrix, error: readError, isLoading } = useReadOnlyPollingResource<SchedulerCandidatePairMatrixView>({
    scopeKey: `${projectId}:${planId}`,
    load,
    refreshToken,
  });

  const eligibleCandidates = useMemo(
    () => matrix?.candidates.filter((candidate) => candidate.eligible) ?? [],
    [matrix],
  );

  useEffect(() => {
    if (eligibleCandidates.some((candidate) => candidate.pairKey === selectedPairKey)) return;
    setSelectedPairKey(eligibleCandidates[0]?.pairKey ?? '');
    setRetryRequest(null);
  }, [eligibleCandidates, selectedPairKey]);

  const selectedCandidate = eligibleCandidates.find((candidate) => candidate.pairKey === selectedPairKey) ?? null;
  const currentPlanBaseline = matrix !== null
    && matrix.planVersionId === currentPlanVersionId
    && matrix.basePlanVersion === currentPlanVersionNumber;

  const submit = async () => {
    if (!matrix || !selectedCandidate || !currentPlanBaseline || isSubmitting) return;
    const requestKey = [
      selectedCandidate.pairKey,
      matrix.baseStateRevision,
      matrix.basePlanVersion,
      physicalWorkspaceKind,
    ].join(':');
    const clientRequestId = retryRequest?.requestKey === requestKey
      ? retryRequest.clientRequestId
      : crypto.randomUUID();
    setRetryRequest({ requestKey, clientRequestId });
    setIsSubmitting(true);
    setSubmissionError(null);
    try {
      const schedule = await createParallelScheduleProposal(projectId, planId, {
        clientRequestId,
        baseStateRevision: matrix.baseStateRevision,
        basePlanVersion: matrix.basePlanVersion,
        nodeKeys: [selectedCandidate.leftNode.nodeKey, selectedCandidate.rightNode.nodeKey],
        physicalWorkspaceKind,
      });
      setCreatedSchedule(schedule);
      setRetryRequest(null);
      onCreated?.();
    } catch (reason) {
      setSubmissionError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="mt-4 border-t pt-4" aria-label="创建并行调度提案">
      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
        <Plus className="h-4 w-4 text-primary" aria-hidden="true" />
        创建并行调度提案
        <Badge variant="destructive">会写入数据</Badge>
        <Badge variant="outline">仅创建提案</Badge>
      </div>

      {readError && (
        <div
          className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{readError}</span>
        </div>
      )}

      {submissionError && (
        <div
          className="mt-2 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
          role="alert"
        >
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{submissionError}</span>
        </div>
      )}

      {createdSchedule && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-200">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          <span>提案 {shortId(createdSchedule.scheduleId)}</span>
          <Badge variant="outline">{createdSchedule.status}</Badge>
          <Badge variant="outline">分配 {createdSchedule.assignments.length}</Badge>
        </div>
      )}

      {isLoading && matrix === null ? (
        <div className="mt-3 flex items-center gap-2 py-3 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />正在读取可用组合
        </div>
      ) : readError && matrix === null ? null : matrix === null ? (
        <div className="mt-3 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          暂时无法读取候选组合
        </div>
      ) : (
        <div className="mt-3 rounded-md border bg-muted/20 p-3">
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="secondary">可用 {eligibleCandidates.length}</Badge>
            <Badge variant="outline">
              已评估 {matrix.summary.evaluatedPairCount} / {matrix.summary.totalPairCount}
            </Badge>
            <Badge variant={currentPlanBaseline ? 'secondary' : 'destructive'}>
              {currentPlanBaseline ? '基线一致' : '基线已变化'}
            </Badge>
            <Badge variant="outline">计划版本 {matrix.basePlanVersion} / 状态版本 {matrix.baseStateRevision}</Badge>
            {matrix.summary.truncated && <Badge variant="destructive">评估数量已截断</Badge>}
          </div>

          {eligibleCandidates.length === 0 ? (
            <div className="mt-3 rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
              当前没有可用的候选组合
            </div>
          ) : (
            <form
              className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <label className="min-w-0 flex-1 text-xs">
                <span className="mb-1 block text-muted-foreground">候选组合</span>
                <select
                  value={selectedPairKey}
                  onChange={(event) => {
                    setSelectedPairKey(event.target.value);
                    setRetryRequest(null);
                    setSubmissionError(null);
                  }}
                  disabled={isSubmitting}
                  className="h-9 w-full rounded-md border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
                >
                  {eligibleCandidates.map((candidate) => (
                    <option key={candidate.pairKey} value={candidate.pairKey}>
                      {candidate.leftNode.title} + {candidate.rightNode.title} ({candidate.pairKey})
                    </option>
                  ))}
                </select>
              </label>
              <div className="text-xs">
                <span className="mb-1 block text-muted-foreground">隔离工作区</span>
                <div className="flex h-9 rounded-md border bg-background p-0.5" role="radiogroup" aria-label="选择隔离工作区类型">
                  <Button
                    type="button"
                    size="sm"
                    variant={physicalWorkspaceKind === 'DIRECTORY_ONLY' ? 'secondary' : 'ghost'}
                    className="h-8 rounded px-2"
                    aria-pressed={physicalWorkspaceKind === 'DIRECTORY_ONLY'}
                    onClick={() => {
                      setPhysicalWorkspaceKind('DIRECTORY_ONLY');
                      setRetryRequest(null);
                    }}
                  >
                    <Folder className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />独立目录
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={physicalWorkspaceKind === 'GIT_WORKTREE' ? 'secondary' : 'ghost'}
                    className="h-8 rounded px-2"
                    aria-pressed={physicalWorkspaceKind === 'GIT_WORKTREE'}
                    onClick={() => {
                      setPhysicalWorkspaceKind('GIT_WORKTREE');
                      setRetryRequest(null);
                    }}
                  >
                    <GitBranch className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Git 工作树
                  </Button>
                </div>
              </div>
              <Button
                type="submit"
                disabled={isSubmitting || !selectedCandidate || !currentPlanBaseline}
                className="shrink-0"
              >
                {isSubmitting
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  : <Plus className="mr-2 h-4 w-4" aria-hidden="true" />}
                创建提案
              </Button>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
