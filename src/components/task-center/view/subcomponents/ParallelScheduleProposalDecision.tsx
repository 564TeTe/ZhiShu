import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Loader2,
  ShieldAlert,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Badge, Button, Input } from '../../../../shared/view/ui';
import {
  confirmParallelScheduleProposal,
  fetchParallelSchedules,
  rejectParallelScheduleProposal,
} from '../../api/taskCenterApi';
import { useReadOnlyPollingResource } from '../../hooks/useReadOnlyPollingResource';
import type { ParallelScheduleView } from '../../model/taskCenterModel';

type DecisionAction = 'CONFIRM' | 'REJECT';

function shortId(value: string): string {
  return value.length > 16 ? `${value.slice(0, 12)}...` : value;
}

function scheduleLabel(schedule: ParallelScheduleView): string {
  const nodes = schedule.assignments.map((assignment) => assignment.nodeKey).join(' + ');
  return `${nodes || '无节点分配'} (${shortId(schedule.scheduleId)})`;
}

export function ParallelScheduleProposalDecision({
  projectId,
  planId,
  refreshToken = 0,
  onDecided,
}: {
  projectId: string;
  planId: string;
  refreshToken?: number;
  onDecided?: () => void;
}) {
  const [selectedScheduleId, setSelectedScheduleId] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [activeAction, setActiveAction] = useState<DecisionAction | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [decidedSchedule, setDecidedSchedule] = useState<ParallelScheduleView | null>(null);
  const [retryRequest, setRetryRequest] = useState<{ requestKey: string; clientRequestId: string } | null>(null);

  const load = useCallback(
    (signal: AbortSignal) => fetchParallelSchedules(projectId, planId, signal),
    [planId, projectId],
  );
  const { data: scheduleData, error: readError, isLoading } = useReadOnlyPollingResource<ParallelScheduleView[]>({
    scopeKey: `${projectId}:${planId}`,
    load,
    refreshToken,
  });
  const schedules = useMemo(() => scheduleData ?? [], [scheduleData]);
  const pendingSchedules = useMemo(
    () => schedules.filter((schedule) => schedule.status === 'PENDING_APPROVAL'),
    [schedules],
  );

  useEffect(() => {
    if (pendingSchedules.some((schedule) => schedule.scheduleId === selectedScheduleId)) return;
    setSelectedScheduleId(pendingSchedules[0]?.scheduleId ?? '');
    setRetryRequest(null);
  }, [pendingSchedules, selectedScheduleId]);

  const selectedSchedule = pendingSchedules.find((schedule) => schedule.scheduleId === selectedScheduleId) ?? null;
  const normalizedReason = rejectionReason.trim();

  const decide = async (action: DecisionAction) => {
    if (!selectedSchedule || activeAction) return;
    if (action === 'REJECT' && !normalizedReason) return;
    const requestKey = [
      selectedSchedule.scheduleId,
      action,
      action === 'REJECT' ? normalizedReason : '',
    ].join(':');
    const clientRequestId = retryRequest?.requestKey === requestKey
      ? retryRequest.clientRequestId
      : crypto.randomUUID();
    setRetryRequest({ requestKey, clientRequestId });
    setActiveAction(action);
    setDecisionError(null);
    try {
      const result = action === 'CONFIRM'
        ? await confirmParallelScheduleProposal(
          projectId,
          planId,
          selectedSchedule.scheduleId,
          clientRequestId,
        )
        : await rejectParallelScheduleProposal(
          projectId,
          planId,
          selectedSchedule.scheduleId,
          clientRequestId,
          normalizedReason,
        );
      setDecidedSchedule(result);
      setRetryRequest(null);
      setRejectionReason('');
      onDecided?.();
    } catch (reason) {
      setDecisionError(reason instanceof Error ? reason.message : String(reason));
      onDecided?.();
    } finally {
      setActiveAction(null);
    }
  };

  return (
    <section className="mt-4 border-t pt-4" aria-label="审批并行调度提案">
      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
        <Check className="h-4 w-4 text-primary" aria-hidden="true" />
        审批调度提案
        <Badge variant="destructive">会写入决策</Badge>
        <Badge variant="outline">仅审批</Badge>
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

      {decisionError && (
        <div
          className="mt-2 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
          role="alert"
        >
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{decisionError}</span>
        </div>
      )}

      {decidedSchedule && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-200">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          <span>调度 {shortId(decidedSchedule.scheduleId)}</span>
          <Badge variant="outline">{decidedSchedule.status}</Badge>
          <Badge variant="outline">
            分配状态 {decidedSchedule.assignments.map((assignment) => assignment.status).join(', ') || '无'}
          </Badge>
        </div>
      )}

      {isLoading && scheduleData === null ? (
        <div className="mt-3 flex items-center gap-2 py-3 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />正在读取待审批提案
        </div>
      ) : readError && scheduleData === null ? null : pendingSchedules.length === 0 ? (
        <div className="mt-3 rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
          当前没有待审批的调度提案
        </div>
      ) : (
        <div className="mt-3 rounded-md border bg-muted/20 p-3">
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="secondary">待审批 {pendingSchedules.length}</Badge>
            {selectedSchedule && (
              <>
                <Badge variant="outline">V{selectedSchedule.basePlanVersion}</Badge>
                <Badge variant="outline">状态版本 {selectedSchedule.baseStateRevision}</Badge>
                <Badge variant="outline">分配 {selectedSchedule.assignments.length}</Badge>
              </>
            )}
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(240px,0.7fr)]">
            <label className="min-w-0 text-xs">
              <span className="mb-1 block text-muted-foreground">待审批提案</span>
              <select
                value={selectedScheduleId}
                onChange={(event) => {
                  setSelectedScheduleId(event.target.value);
                  setRetryRequest(null);
                  setDecisionError(null);
                }}
                disabled={activeAction !== null}
                className="h-9 w-full rounded-md border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
              >
                {pendingSchedules.map((schedule) => (
                  <option key={schedule.scheduleId} value={schedule.scheduleId}>{scheduleLabel(schedule)}</option>
                ))}
              </select>
            </label>

            <label className="min-w-0 text-xs">
              <span className="mb-1 block text-muted-foreground">拒绝原因</span>
              <Input
                value={rejectionReason}
                onChange={(event) => {
                  setRejectionReason(event.target.value);
                  setRetryRequest(null);
                }}
                disabled={activeAction !== null}
                placeholder="拒绝时必须填写"
              />
            </label>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={!selectedSchedule || activeAction !== null}
              onClick={() => void decide('CONFIRM')}
            >
              {activeAction === 'CONFIRM'
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                : <Check className="mr-2 h-4 w-4" aria-hidden="true" />}
              批准提案
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!selectedSchedule || !normalizedReason || activeAction !== null}
              onClick={() => void decide('REJECT')}
            >
              {activeAction === 'REJECT'
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                : <X className="mr-2 h-4 w-4" aria-hidden="true" />}
              拒绝提案
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
