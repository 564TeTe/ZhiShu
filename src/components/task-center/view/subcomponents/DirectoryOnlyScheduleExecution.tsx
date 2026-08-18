import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  PlayCircle,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { Badge, Button } from '../../../../shared/view/ui';
import {
  dispatchParallelSchedule,
  fetchParallelSchedules,
} from '../../api/taskCenterApi';
import { useReadOnlyPollingResource } from '../../hooks/useReadOnlyPollingResource';
import type {
  ParallelScheduleDispatchView,
  ParallelScheduleView,
} from '../../model/taskCenterModel';

type RetryRequest = {
  scheduleId: string;
  clientRequestId: string;
};

function shortId(value: string): string {
  return value.length > 16 ? `${value.slice(0, 12)}...` : value;
}

function isDispatchableSchedule(schedule: ParallelScheduleView): boolean {
  const workspaceKinds = new Set(schedule.assignments.map(
    (assignment) => assignment.workspaceLease.physicalWorkspaceKind,
  ));
  return schedule.status === 'APPROVED'
    && schedule.assignments.length === 2
    && workspaceKinds.size === 1
    && schedule.assignments.every((assignment) => {
      const lease = assignment.workspaceLease;
      return assignment.status === 'PROVISIONED'
        && ['DIRECTORY_ONLY', 'GIT_WORKTREE'].includes(lease.physicalWorkspaceKind)
        && lease.status === 'PROVISIONED'
        && lease.provisioningState === 'PROVISIONED'
        && Boolean(lease.workspacePath);
    });
}

export function ParallelScheduleExecution({
  projectId,
  planId,
  refreshToken = 0,
  onDispatched,
}: {
  projectId: string;
  planId: string;
  refreshToken?: number;
  onDispatched?: () => void;
}) {
  const [activeScheduleId, setActiveScheduleId] = useState<string | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [dispatchResult, setDispatchResult] = useState<ParallelScheduleDispatchView | null>(null);
  const [retryRequest, setRetryRequest] = useState<RetryRequest | null>(null);

  const load = useCallback(
    (signal: AbortSignal) => fetchParallelSchedules(projectId, planId, signal),
    [planId, projectId],
  );
  const { data: scheduleData, error: readError, isLoading, refresh } = useReadOnlyPollingResource<ParallelScheduleView[]>({
    scopeKey: `${projectId}:${planId}`,
    load,
    refreshToken,
  });
  const dispatchableSchedules = useMemo(
    () => (scheduleData ?? []).filter(isDispatchableSchedule),
    [scheduleData],
  );

  const dispatch = async (schedule: ParallelScheduleView) => {
    if (activeScheduleId) return;
    const clientRequestId = retryRequest?.scheduleId === schedule.scheduleId
      ? retryRequest.clientRequestId
      : crypto.randomUUID();
    setRetryRequest({ scheduleId: schedule.scheduleId, clientRequestId });
    setActiveScheduleId(schedule.scheduleId);
    setCommandError(null);
    try {
      const result = await dispatchParallelSchedule(
        projectId,
        planId,
        schedule.scheduleId,
        clientRequestId,
      );
      setDispatchResult(result);
      setRetryRequest(null);
      refresh();
      onDispatched?.();
    } catch (reason) {
      setCommandError(reason instanceof Error ? reason.message : String(reason));
      onDispatched?.();
    } finally {
      setActiveScheduleId(null);
    }
  };

  return (
    <section className="mt-4 border-t pt-4" aria-label="执行并行调度">
      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
        <PlayCircle className="h-4 w-4 text-primary" aria-hidden="true" />
        执行并行调度
        <Badge variant="destructive">将启动 2 个执行代理</Badge>
        <Badge variant="outline">需要人工确认</Badge>
      </div>

      {(readError || commandError) && (
        <div
          className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{commandError ?? readError}</span>
        </div>
      )}

      {dispatchResult && (
        <div className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-200">
          <div className="flex flex-wrap items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>调度 {shortId(dispatchResult.scheduleId)} 已下发</span>
            <Badge variant="outline">工作单 {dispatchResult.workOrders.length}</Badge>
            {dispatchResult.replayed && <Badge variant="outline">幂等重放</Badge>}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {dispatchResult.workOrders.map((workOrder) => (
              <Badge key={workOrder.workOrderId} variant="secondary">
                {workOrder.nodeKey} · {workOrder.status}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {isLoading && scheduleData === null ? (
        <div className="mt-3 flex items-center gap-2 py-3 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />正在读取已准备调度
        </div>
      ) : readError && scheduleData === null ? null : dispatchableSchedules.length === 0 ? (
        <div className="mt-3 rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
          当前没有可下发的双节点调度
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {dispatchableSchedules.map((schedule) => {
            const isActive = activeScheduleId === schedule.scheduleId;
            const workspaceKind = schedule.assignments[0]?.workspaceLease.physicalWorkspaceKind ?? 'UNKNOWN';
            return (
              <div key={schedule.scheduleId} className="rounded-md border bg-muted/20 p-3 text-xs">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">调度 {shortId(schedule.scheduleId)}</span>
                  <Badge variant="secondary">{workspaceKind}</Badge>
                  <Badge variant="outline">执行代理 {schedule.assignments.length}</Badge>
                  <Badge variant="outline">V{schedule.basePlanVersion}</Badge>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {schedule.assignments.map((assignment) => (
                    <div key={assignment.assignmentId} className="min-w-0 rounded border bg-background/70 p-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{assignment.nodeKey}</span>
                        <Badge variant="outline">并行位 {assignment.workerSlot}</Badge>
                        <Badge variant="outline">{assignment.profileName}</Badge>
                      </div>
                      <div className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                        {assignment.workspaceLease.workspacePath}
                      </div>
                    </div>
                  ))}
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="mt-3"
                  disabled={activeScheduleId !== null}
                  onClick={() => void dispatch(schedule)}
                >
                  {isActive
                    ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    : <PlayCircle className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
                  下发 2 个执行节点
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
