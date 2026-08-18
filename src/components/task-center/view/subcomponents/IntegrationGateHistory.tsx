import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Clock3,
  FileCheck2,
  History,
  Loader2,
  XCircle,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { Badge } from '../../../../shared/view/ui';
import { fetchIntegrationGates } from '../../api/taskCenterApi';
import { useReadOnlyPollingResource } from '../../hooks/useReadOnlyPollingResource';
import type { IntegrationGateView } from '../../model/taskCenterModel';

const STATUS_FILTERS = ['ALL', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'STALE'] as const;

function formatDate(value: string | null): string {
  if (!value) return 'Not recorded';
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

function eventDetail(event: IntegrationGateView['events'][number]): string | null {
  const reason = textValue(event.payload.reason);
  const detail = textValue(event.payload.detail);
  const applyState = textValue(event.payload.applyState);
  return reason ?? detail ?? applyState;
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

function EvidenceSnapshot({ gate }: { gate: IntegrationGateView }) {
  if (gate.evidence.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        <CircleDashed className="mb-2 h-4 w-4" aria-hidden="true" />
        No Evidence snapshot
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {gate.evidence.map((evidence) => (
        <div key={evidence.evidenceReferenceId} className="rounded-md border bg-background/60 p-3 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <FileCheck2 className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            <Badge variant="secondary">{evidence.sourceType}</Badge>
            <span className="font-mono text-[10px] text-muted-foreground">{shortId(evidence.evidenceReferenceId)}</span>
          </div>
          <dl className="mt-2 grid gap-x-3 gap-y-1 sm:grid-cols-[auto_minmax(0,1fr)]">
            <dt className="text-muted-foreground">Artifact</dt>
            <dd className="break-all font-mono text-[10px]">{evidence.artifactId}</dd>
            <dt className="text-muted-foreground">Hash</dt>
            <dd className="break-all font-mono text-[10px]">{evidence.artifactHash ?? 'Not recorded'}</dd>
            <dt className="text-muted-foreground">Source</dt>
            <dd className="break-all font-mono text-[10px]">{evidence.sourceId ?? 'Not recorded'}</dd>
            <dt className="text-muted-foreground">Purpose</dt>
            <dd className="break-words">{evidence.purpose}</dd>
            <dt className="text-muted-foreground">Referenced</dt>
            <dd>{formatDate(evidence.referenceCreatedAt)}</dd>
            <dt className="text-muted-foreground">Captured</dt>
            <dd>{formatDate(evidence.capturedAt)}</dd>
          </dl>
        </div>
      ))}
    </div>
  );
}

function GateRecord({
  gate,
  currentPlanVersionId,
  currentPlanVersionNumber,
  planBaseStateRevision,
}: {
  gate: IntegrationGateView;
  currentPlanVersionId: string;
  currentPlanVersionNumber: number;
  planBaseStateRevision: number;
}) {
  const isCurrentBaseline = gate.planVersionId === currentPlanVersionId
    && gate.basePlanVersion === currentPlanVersionNumber
    && gate.baseStateRevision === planBaseStateRevision;
  return (
    <details className="rounded-md border bg-background/40" open={gate.status === 'STALE'}>
      <summary className="cursor-pointer list-none p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 text-xs font-medium">
            <StatusIcon status={gate.status} />
            <span>门禁 {shortId(gate.gateId)}</span>
            <Badge variant={statusVariant(gate.status)}>{gate.status}</Badge>
            <Badge variant="outline">调度 {shortId(gate.scheduleId)}</Badge>
          </div>
          <span className="text-[10px] text-muted-foreground">{formatDate(gate.createdAt)}</span>
        </div>
      </summary>
      <div className="space-y-3 border-t px-3 pb-3 pt-3">
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline">{gate.gateMode}</Badge>
          <Badge variant="outline">{gate.applyState}</Badge>
          <Badge variant={gate.evidenceStatus === 'PRESENT' ? 'secondary' : 'destructive'}>
            证据 {gate.evidenceCount}
          </Badge>
          <Badge variant={isCurrentBaseline ? 'secondary' : 'outline'}>
            {isCurrentBaseline ? '当前计划基线' : '历史计划基线'}
          </Badge>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <section className="min-w-0 rounded-md bg-muted/30 p-3">
            <h5 className="mb-2 flex items-center gap-1 text-xs font-semibold">
              <FileCheck2 className="h-3.5 w-3.5" aria-hidden="true" />证据快照
            </h5>
            <EvidenceSnapshot gate={gate} />
          </section>
          <section className="min-w-0 rounded-md bg-muted/30 p-3 text-xs">
            <h5 className="mb-2 text-xs font-semibold">门禁上下文</h5>
            <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[auto_minmax(0,1fr)]">
              <dt className="text-muted-foreground">调度</dt>
              <dd className="break-all font-mono text-[10px]">{gate.scheduleId}</dd>
              <dt className="text-muted-foreground">计划版本</dt>
              <dd>V{gate.basePlanVersion} ({shortId(gate.planVersionId)})</dd>
              <dt className="text-muted-foreground">状态版本</dt>
              <dd>{gate.baseStateRevision}</dd>
              <dt className="text-muted-foreground">创建人</dt>
              <dd className="break-words">{gate.createdBy}</dd>
              <dt className="text-muted-foreground">审批结果</dt>
              <dd className="break-words">{gate.decidedBy ?? '待审批'}{gate.decidedAt ? ` - ${formatDate(gate.decidedAt)}` : ''}</dd>
            </dl>
            {gate.decisionReason && (
              <p className="mt-2 rounded border border-amber-500/30 bg-amber-500/5 p-2 text-amber-800 dark:text-amber-200">
                {gate.decisionReason}
              </p>
            )}
            {Object.keys(gate.conflictAssessment).length > 0 && (
              <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-words rounded bg-background/70 p-2 text-[10px] text-muted-foreground">
                {JSON.stringify(gate.conflictAssessment, null, 2)}
              </pre>
            )}
          </section>
        </div>

        <section>
          <h5 className="mb-2 flex items-center gap-1 text-xs font-semibold">
            <History className="h-3.5 w-3.5" aria-hidden="true" />事件时间线
          </h5>
          <ol className="space-y-2 border-l pl-3">
            {gate.events.length === 0 ? (
              <li className="list-none text-xs text-muted-foreground">暂无门禁事件</li>
            ) : gate.events.map((event) => (
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

export function IntegrationGateHistory({
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
  const [scheduleFilter, setScheduleFilter] = useState('ALL');
  const load = useCallback(
    (signal: AbortSignal) => fetchIntegrationGates(projectId, planId, signal),
    [planId, projectId],
  );
  const { data: gateData, error, isLoading } = useReadOnlyPollingResource<IntegrationGateView[]>({
    scopeKey: `${projectId}:${planId}`,
    load,
    refreshToken,
  });
  const gates = useMemo(() => gateData ?? [], [gateData]);

  const scheduleIds = useMemo(
    () => Array.from(new Set(gates.map((gate) => gate.scheduleId))).sort(),
    [gates],
  );

  const visibleGates = useMemo(() => gates.filter((gate) => (
    (statusFilter === 'ALL' || gate.status === statusFilter)
    && (scheduleFilter === 'ALL' || gate.scheduleId === scheduleFilter)
  )), [gates, scheduleFilter, statusFilter]);

  return (
    <section className="mt-4 border-t pt-4" aria-label="Integration Gate history">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <History className="h-4 w-4 text-primary" aria-hidden="true" />
          集成门禁记录
          <Badge variant="secondary">{gates.length}</Badge>
          <Badge variant="outline">只读</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={scheduleFilter}
            onChange={(event) => setScheduleFilter(event.target.value)}
            className="h-8 max-w-52 rounded-md border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
            aria-label="按调度筛选集成门禁记录"
          >
            <option value="ALL">全部调度</option>
            {scheduleIds.map((scheduleId) => (
              <option key={scheduleId} value={scheduleId}>调度 {shortId(scheduleId)}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as (typeof STATUS_FILTERS)[number])}
            className="h-8 rounded-md border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
            aria-label="按状态筛选集成门禁记录"
          >
            {STATUS_FILTERS.map((status) => <option key={status} value={status}>{status === 'ALL' ? '全部状态' : status}</option>)}
          </select>
        </div>
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
      {isLoading && gates.length === 0 ? (
        <div className="mt-3 flex items-center gap-2 py-3 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />正在读取门禁记录
        </div>
      ) : error && gates.length === 0 ? null : visibleGates.length === 0 ? (
        <div className="mt-3 rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
          {gates.length === 0 ? '当前计划暂无集成门禁记录' : '没有符合筛选条件的记录'}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {visibleGates.map((gate) => (
            <GateRecord
              key={gate.gateId}
              gate={gate}
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
