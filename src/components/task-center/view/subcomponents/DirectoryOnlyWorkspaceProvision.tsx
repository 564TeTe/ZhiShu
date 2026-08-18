import {
  AlertTriangle,
  CheckCircle2,
  FolderPlus,
  GitBranch,
  Loader2,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { Badge, Button } from '../../../../shared/view/ui';
import {
  fetchParallelSchedules,
  provisionParallelScheduleWorkspaceLease,
} from '../../api/taskCenterApi';
import { useReadOnlyPollingResource } from '../../hooks/useReadOnlyPollingResource';
import type {
  ParallelScheduleAssignmentView,
  ParallelScheduleView,
} from '../../model/taskCenterModel';

type ProvisionTarget = {
  schedule: ParallelScheduleView;
  assignment: ParallelScheduleAssignmentView;
};

type RetryRequest = {
  requestKey: string;
  clientRequestId: string;
};

function shortId(value: string): string {
  return value.length > 16 ? `${value.slice(0, 12)}...` : value;
}

function targetKey(target: ProvisionTarget): string {
  return `${target.schedule.scheduleId}:${target.assignment.workspaceLease.leaseId}`;
}

function isWorkspaceProvisionTarget(
  schedule: ParallelScheduleView,
  assignment: ParallelScheduleAssignmentView,
): boolean {
  const lease = assignment.workspaceLease;
  return schedule.status === 'APPROVED'
    && assignment.status === 'READY_FOR_PROVISIONING'
    && lease.status === 'RESERVED'
    && lease.provisioningState === 'NOT_STARTED'
    && ['DIRECTORY_ONLY', 'GIT_WORKTREE'].includes(lease.physicalWorkspaceKind);
}

export function WorkspaceProvision({
  projectId,
  planId,
  refreshToken = 0,
  onProvisioned,
}: {
  projectId: string;
  planId: string;
  refreshToken?: number;
  onProvisioned?: () => void;
}) {
  const [activeTargetKey, setActiveTargetKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completedTarget, setCompletedTarget] = useState<ProvisionTarget | null>(null);
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
  const schedules = useMemo(() => scheduleData ?? [], [scheduleData]);
  const targets = useMemo(
    () => schedules.flatMap((schedule) => schedule.assignments
      .filter((assignment) => isWorkspaceProvisionTarget(schedule, assignment))
      .map((assignment) => ({ schedule, assignment }))),
    [schedules],
  );

  const provision = async (target: ProvisionTarget) => {
    const key = targetKey(target);
    if (activeTargetKey) return;
    const requestKey = key;
    const clientRequestId = retryRequest?.requestKey === requestKey
      ? retryRequest.clientRequestId
      : crypto.randomUUID();
    setActiveTargetKey(key);
    setError(null);
    setRetryRequest({ requestKey, clientRequestId });
    try {
      const result = await provisionParallelScheduleWorkspaceLease(
        projectId,
        planId,
        target.schedule.scheduleId,
        target.assignment.workspaceLease.leaseId,
        clientRequestId,
      );
      setCompletedTarget({ schedule: result, assignment: target.assignment });
      setRetryRequest(null);
      refresh();
      onProvisioned?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      onProvisioned?.();
    } finally {
      setActiveTargetKey(null);
    }
  };

  return (
    <section className="mt-4 border-t pt-4" aria-label="准备隔离工作区">
      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
        <FolderPlus className="h-4 w-4 text-primary" aria-hidden="true" />
        准备隔离工作区
        <Badge variant="destructive">会创建目录</Badge>
        <Badge variant="outline">独立目录 / Git 工作树</Badge>
      </div>

      {(readError || error) && (
        <div
          className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{error ?? readError}</span>
        </div>
      )}

      {completedTarget && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-200">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          <span>工作区 {shortId(completedTarget.assignment.workspaceLease.leaseId)} 已接受准备请求</span>
          <Badge variant="outline">{completedTarget.schedule.status}</Badge>
        </div>
      )}

      {isLoading && scheduleData === null ? (
        <div className="mt-3 flex items-center gap-2 py-3 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />正在读取已批准工作区
        </div>
      ) : readError && scheduleData === null ? null : targets.length === 0 ? (
        <div className="mt-3 rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
          当前没有可准备的已批准工作区
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {targets.map((target) => {
            const key = targetKey(target);
            const lease = target.assignment.workspaceLease;
            const isActive = activeTargetKey === key;
            return (
              <div key={key} className="rounded-md border bg-muted/20 p-3 text-xs">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{target.assignment.nodeKey}</span>
                  <Badge variant="secondary">{lease.physicalWorkspaceKind}</Badge>
                  <Badge variant="outline">{target.assignment.status}</Badge>
                  <Badge variant="outline">{lease.provisioningState}</Badge>
                </div>
                <dl className="mt-2 grid gap-x-3 gap-y-1 sm:grid-cols-[auto_minmax(0,1fr)]">
                  <dt className="text-muted-foreground">调度</dt>
                  <dd className="break-all font-mono text-[10px]">{shortId(target.schedule.scheduleId)}</dd>
                  <dt className="text-muted-foreground">工作区租约</dt>
                  <dd className="break-all font-mono text-[10px]">{lease.leaseId}</dd>
                  <dt className="text-muted-foreground">逻辑工作区</dt>
                  <dd className="break-all font-mono text-[10px]">{lease.workspaceRef}</dd>
                </dl>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={activeTargetKey !== null}
                    onClick={() => void provision(target)}
                  >
                    {isActive ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : lease.physicalWorkspaceKind === 'GIT_WORKTREE' ? (
                      <GitBranch className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <FolderPlus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    准备{lease.physicalWorkspaceKind === 'GIT_WORKTREE' ? ' Git 工作树' : '独立目录'}
                  </Button>
                  <span className="text-[10px] text-muted-foreground">
                    {lease.physicalWorkspaceKind === 'GIT_WORKTREE'
                      ? `将从冻结的调度提交创建分支 ${lease.branchRef}`
                      : '工作目录仍由项目控制台管理'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
