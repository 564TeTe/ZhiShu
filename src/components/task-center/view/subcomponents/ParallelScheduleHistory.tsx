import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Clock3,
  History,
  Loader2,
  XCircle,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { Badge } from '../../../../shared/view/ui';
import { fetchParallelSchedules } from '../../api/taskCenterApi';
import { useReadOnlyPollingResource } from '../../hooks/useReadOnlyPollingResource';
import type {
  ParallelScheduleAssignmentView,
  ParallelScheduleEvent,
  ParallelScheduleView,
  WorkspaceLeaseView,
} from '../../model/taskCenterModel';
import { capabilityLabel, proposalStatusLabel } from '../taskCenterLabels';

const STATUS_FILTERS = ['ALL', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'STALE'] as const;

function formatDate(value: string | null | undefined): string {
  if (!value) return '未记录';
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : value;
}

function shortId(value: string): string {
  return value.length > 16 ? `${value.slice(0, 12)}...` : value;
}

function textValue(value: unknown): string | null {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

function eventDetail(event: ParallelScheduleEvent): string | null {
  const reason = textValue(event.payload.reason);
  const detail = textValue(event.payload.detail);
  const decisionReason = textValue(event.payload.decisionReason);
  return reason ?? detail ?? decisionReason;
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'APPROVED') return 'default';
  if (status === 'STALE' || status === 'REJECTED') return 'destructive';
  if (status === 'PENDING_APPROVAL') return 'outline';
  return 'secondary';
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'APPROVED') return <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />;
  if (status === 'STALE' || status === 'REJECTED') return <XCircle className="h-3.5 w-3.5" aria-hidden="true" />;
  return <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />;
}

function physicalWorkspaceLabel(kind: string): string {
  return kind === 'DIRECTORY_ONLY' ? '独立目录' : kind === 'GIT_WORKTREE' ? 'Git 工作树' : kind;
}

function StringList({ values, emptyLabel = '暂无记录' }: { values: string[]; emptyLabel?: string }) {
  if (values.length === 0) return <span className="text-muted-foreground">{emptyLabel}</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {values.map((value) => <Badge key={value} variant="outline" className="text-[10px]">{value}</Badge>)}
    </div>
  );
}

function WorkspaceLeaseRecord({ lease }: { lease: WorkspaceLeaseView }) {
  const hasFailure = Boolean(lease.failureCode || lease.failureMessage);
  const isDirectoryOnly = lease.physicalWorkspaceKind === 'DIRECTORY_ONLY';
  return (
    <section className="rounded-md border bg-background/60 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium">工作区租约</span>
        <Badge variant="outline">{lease.status}</Badge>
        <Badge variant={isDirectoryOnly ? 'secondary' : 'outline'}>
          {physicalWorkspaceLabel(lease.physicalWorkspaceKind)}
        </Badge>
        <Badge variant="outline">{lease.provisioningState}</Badge>
      </div>
      <dl className="mt-2 grid gap-x-3 gap-y-1 sm:grid-cols-[auto_minmax(0,1fr)]">
        <dt className="text-muted-foreground">租约 ID</dt>
        <dd className="break-all font-mono text-[10px]">{lease.leaseId}</dd>
        <dt className="text-muted-foreground">隔离策略</dt>
        <dd>{lease.workspaceMode}</dd>
        <dt className="text-muted-foreground">逻辑工作区引用</dt>
        <dd className="break-all font-mono text-[10px]">{lease.workspaceRef}</dd>
        <dt className="text-muted-foreground">预留分支引用</dt>
        <dd className="break-all font-mono text-[10px]">
          {lease.branchRef}{isDirectoryOnly ? ' (not materialized)' : ''}
        </dd>
        <dt className="text-muted-foreground">工作区路径</dt>
        <dd className="break-all font-mono text-[10px]">{lease.workspacePath ?? '当前未记录'}</dd>
        <dt className="text-muted-foreground">租约到期</dt>
        <dd>{formatDate(lease.leaseExpiresAt)}</dd>
        <dt className="text-muted-foreground">准备开始</dt>
        <dd>{formatDate(lease.provisioningStartedAt)}</dd>
        <dt className="text-muted-foreground">已准备</dt>
        <dd>{formatDate(lease.provisionedAt)}</dd>
        <dt className="text-muted-foreground">已释放</dt>
        <dd>{formatDate(lease.releasedAt)}</dd>
        <dt className="text-muted-foreground">已清理</dt>
        <dd>{formatDate(lease.cleanedAt)}</dd>
        <dt className="text-muted-foreground">创建时间</dt>
        <dd>{formatDate(lease.createdAt)}</dd>
        <dt className="text-muted-foreground">失败代码</dt>
        <dd className="break-words">{lease.failureCode ?? '未记录'}</dd>
        <dt className="text-muted-foreground">失败原因</dt>
        <dd className="break-words">{lease.failureMessage ?? '未记录'}</dd>
      </dl>
      {hasFailure && (
        <div className="mt-2 rounded border border-amber-500/30 bg-amber-500/5 p-2 text-amber-800 dark:text-amber-200">
          {lease.failureCode && <div className="font-medium">{lease.failureCode}</div>}
          {lease.failureMessage && <div className="mt-1 break-words">{lease.failureMessage}</div>}
        </div>
      )}
    </section>
  );
}

function AssignmentRecord({ assignment }: { assignment: ParallelScheduleAssignmentView }) {
  return (
    <div className="rounded-md border bg-muted/20 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium">节点分配 {shortId(assignment.assignmentId)}</span>
        <Badge variant="outline">{assignment.status}</Badge>
        <Badge variant="secondary">并行位 {assignment.workerSlot}</Badge>
      </div>
      <dl className="mt-2 grid gap-x-3 gap-y-1 sm:grid-cols-[auto_minmax(0,1fr)]">
        <dt className="text-muted-foreground">节点标识</dt>
        <dd className="break-words font-mono text-[10px]">{assignment.nodeKey}</dd>
        <dt className="text-muted-foreground">执行器</dt>
        <dd className="break-words">{assignment.executor}</dd>
        <dt className="text-muted-foreground">工作范围</dt>
        <dd><StringList values={assignment.scope} /></dd>
        <dt className="text-muted-foreground">所需能力</dt>
        <dd><StringList values={assignment.requiredCapabilities.map(capabilityLabel)} /></dd>
        <dt className="text-muted-foreground">配置能力</dt>
        <dd><StringList values={assignment.profileCapabilities.map(capabilityLabel)} /></dd>
      </dl>
      <div className="mt-3">
        <WorkspaceLeaseRecord lease={assignment.workspaceLease} />
      </div>
    </div>
  );
}

function ScheduleRecord({
  schedule,
  currentPlanVersionId,
  currentPlanVersionNumber,
  planBaseStateRevision,
}: {
  schedule: ParallelScheduleView;
  currentPlanVersionId: string;
  currentPlanVersionNumber: number;
  planBaseStateRevision: number;
}) {
  const isCurrentBaseline = schedule.planVersionId === currentPlanVersionId
    && schedule.basePlanVersion === currentPlanVersionNumber
    && schedule.baseStateRevision === planBaseStateRevision;
  return (
    <details className="rounded-md border bg-background/40" open={schedule.status === 'STALE'}>
      <summary className="cursor-pointer list-none p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 text-xs font-medium">
            <StatusIcon status={schedule.status} />
            <span>调度 {shortId(schedule.scheduleId)}</span>
            <Badge variant={statusVariant(schedule.status)}>{schedule.status}</Badge>
          </div>
          <span className="text-[10px] text-muted-foreground">{formatDate(schedule.createdAt)}</span>
        </div>
      </summary>
      <div className="space-y-3 border-t px-3 pb-3 pt-3">
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline">结构版本 {schedule.schemaVersion}</Badge>
          <Badge variant="outline">最大并行数 {schedule.maxWorkers}</Badge>
          <Badge variant="outline">节点分配 {schedule.assignments.length}</Badge>
          <Badge variant={isCurrentBaseline ? 'secondary' : 'outline'}>
            {isCurrentBaseline ? '当前计划基线' : '历史计划基线'}
          </Badge>
          <Badge variant="secondary">只读</Badge>
        </div>

        <section className="rounded-md bg-muted/30 p-3 text-xs">
          <h5 className="mb-2 text-xs font-semibold">调度上下文</h5>
          <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[auto_minmax(0,1fr)]">
            <dt className="text-muted-foreground">调度 ID</dt>
            <dd className="break-all font-mono text-[10px]">{schedule.scheduleId}</dd>
            <dt className="text-muted-foreground">计划版本</dt>
            <dd>V{schedule.basePlanVersion} ({shortId(schedule.planVersionId)})</dd>
            <dt className="text-muted-foreground">状态版本</dt>
            <dd>{schedule.baseStateRevision}</dd>
            <dt className="text-muted-foreground">创建人</dt>
            <dd className="break-words">{schedule.createdBy}</dd>
            <dt className="text-muted-foreground">审批结果</dt>
            <dd className="break-words">{schedule.decidedBy ?? '待审批'}{schedule.decidedAt ? ` - ${formatDate(schedule.decidedAt)}` : ''}</dd>
          </dl>
          {schedule.decisionReason && (
            <p className="mt-2 rounded border border-amber-500/30 bg-amber-500/5 p-2 text-amber-800 dark:text-amber-200">
              {schedule.decisionReason}
            </p>
          )}
          <h5 className="mb-2 mt-3 text-xs font-semibold">冲突评估</h5>
          {Object.keys(schedule.conflictAssessment).length > 0 ? (
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-background/70 p-2 text-[10px] text-muted-foreground">
              {JSON.stringify(schedule.conflictAssessment, null, 2)}
            </pre>
          ) : (
            <div className="rounded-md border border-dashed p-2 text-muted-foreground">暂无冲突评估</div>
          )}
        </section>

        <section>
          <h5 className="mb-2 text-xs font-semibold">节点分配</h5>
          {schedule.assignments.length === 0 ? (
            <div className="flex items-center gap-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              <CircleDashed className="h-4 w-4" aria-hidden="true" />暂无节点分配
            </div>
          ) : (
            <div className="space-y-2">
              {schedule.assignments.map((assignment) => (
                <AssignmentRecord key={assignment.assignmentId} assignment={assignment} />
              ))}
            </div>
          )}
        </section>

        <section>
          <h5 className="mb-2 flex items-center gap-1 text-xs font-semibold">
            <History className="h-3.5 w-3.5" aria-hidden="true" />事件时间线
          </h5>
          <ol className="space-y-2 border-l pl-3">
            {schedule.events.length === 0 ? (
              <li className="list-none text-xs text-muted-foreground">暂无调度事件</li>
            ) : schedule.events.map((event) => (
              <li key={event.eventId} className="relative text-xs">
                <span className="absolute -left-[18px] top-1 h-2 w-2 rounded-full border border-primary bg-background" aria-hidden="true" />
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={event.eventType === 'STALE' ? 'destructive' : 'outline'}>{event.eventType}</Badge>
                  <span className="text-muted-foreground">{event.actor}</span>
                  <time className="text-[10px] text-muted-foreground" dateTime={event.occurredAt}>{formatDate(event.occurredAt)}</time>
                </div>
                {eventDetail(event) && <p className="mt-1 break-words text-muted-foreground">{eventDetail(event)}</p>}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </details>
  );
}

export function ParallelScheduleHistory({
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
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>('ALL');
  const load = useCallback(
    (signal: AbortSignal) => fetchParallelSchedules(projectId, planId, signal),
    [planId, projectId],
  );
  const { data: scheduleData, error, isLoading } = useReadOnlyPollingResource<ParallelScheduleView[]>({
    scopeKey: `${projectId}:${planId}`,
    load,
    refreshToken,
  });
  const schedules = useMemo(() => scheduleData ?? [], [scheduleData]);

  const visibleSchedules = useMemo(
    () => statusFilter === 'ALL' ? schedules : schedules.filter((schedule) => schedule.status === statusFilter),
    [schedules, statusFilter],
  );

  return (
    <section className="mt-4 border-t pt-4" aria-label="Parallel Schedule history">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <History className="h-4 w-4 text-primary" aria-hidden="true" />
          Parallel Schedule History
          <Badge variant="secondary">{schedules.length}</Badge>
          <Badge variant="outline">只读</Badge>
        </div>
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as (typeof STATUS_FILTERS)[number])}
          className="h-8 rounded-md border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
          aria-label="Filter Parallel Schedule history"
        >
          {STATUS_FILTERS.map((status) => <option key={status} value={status}>{status === 'ALL' ? '全部状态' : proposalStatusLabel(status)}</option>)}
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
      {isLoading && schedules.length === 0 ? (
        <div className="mt-3 flex items-center gap-2 py-3 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />正在读取并行调度记录
        </div>
      ) : error && schedules.length === 0 ? null : visibleSchedules.length === 0 ? (
        <div className="mt-3 rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
          {schedules.length === 0 ? '当前计划暂无并行调度记录' : '没有符合状态筛选条件的记录'}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {visibleSchedules.map((schedule) => (
            <ScheduleRecord
              key={schedule.scheduleId}
              schedule={schedule}
              currentPlanVersionId={currentPlanVersionId}
              currentPlanVersionNumber={currentPlanVersionNumber}
              planBaseStateRevision={planBaseStateRevision}
            />
          ))}
        </div>
      )}
    </section>
  );
}
