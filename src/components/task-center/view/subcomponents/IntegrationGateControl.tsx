import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Loader2,
  Plus,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Badge, Button, Input } from '../../../../shared/view/ui';
import {
  confirmIntegrationGate,
  createIntegrationGate,
  fetchIntegrationGates,
  fetchParallelSchedules,
  fetchProjectState,
  rejectIntegrationGate,
} from '../../api/taskCenterApi';
import { useReadOnlyPollingResource } from '../../hooks/useReadOnlyPollingResource';
import type {
  IntegrationGateView,
  ParallelScheduleView,
  ProjectStateSnapshot,
} from '../../model/taskCenterModel';

type GateControlData = {
  schedules: ParallelScheduleView[];
  gates: IntegrationGateView[];
  state: ProjectStateSnapshot;
};

type EvidenceOption = {
  evidenceReferenceId: string;
  entryTitle: string;
  entryType: string;
};

type RetryRequest = {
  requestKey: string;
  clientRequestId: string;
};

type GateAction = 'CREATE' | 'CONFIRM' | 'REJECT';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function shortId(value: string): string {
  return value.length > 16 ? `${value.slice(0, 12)}...` : value;
}

function scheduleLabel(schedule: ParallelScheduleView): string {
  const nodes = schedule.assignments.map((assignment) => assignment.nodeKey).join(' + ');
  return `${nodes || 'No assignments'} (${shortId(schedule.scheduleId)})`;
}

function manualEvidenceIds(value: string): string[] {
  return value.split(/[\s,;]+/u).map((item) => item.trim()).filter(Boolean);
}

function canCreateGate(
  schedule: ParallelScheduleView,
  gates: IntegrationGateView[],
  currentPlanVersionId: string,
  currentPlanVersionNumber: number,
  currentStateRevision: number,
): boolean {
  return schedule.status === 'APPROVED'
    && schedule.planVersionId === currentPlanVersionId
    && schedule.basePlanVersion === currentPlanVersionNumber
    && schedule.baseStateRevision === currentStateRevision
    && schedule.assignments.length === 2
    && schedule.assignments.every((assignment) => ['PROVISIONED', 'VERIFIED'].includes(assignment.status))
    && !gates.some((gate) => gate.scheduleId === schedule.scheduleId
      && ['PENDING_APPROVAL', 'APPROVED'].includes(gate.status));
}

export function IntegrationGateControl({
  projectId,
  planId,
  currentPlanVersionId,
  currentPlanVersionNumber,
  refreshToken = 0,
  onChanged,
}: {
  projectId: string;
  planId: string;
  currentPlanVersionId: string;
  currentPlanVersionNumber: number;
  refreshToken?: number;
  onChanged?: () => void;
}) {
  const [selectedScheduleId, setSelectedScheduleId] = useState('');
  const [selectedEvidence, setSelectedEvidence] = useState<Record<string, boolean>>({});
  const [manualEvidence, setManualEvidence] = useState('');
  const [selectedGateId, setSelectedGateId] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [activeAction, setActiveAction] = useState<GateAction | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [lastGate, setLastGate] = useState<IntegrationGateView | null>(null);
  const [retryRequest, setRetryRequest] = useState<RetryRequest | null>(null);

  const load = useCallback(async (signal: AbortSignal): Promise<GateControlData> => {
    const [schedules, gates, state] = await Promise.all([
      fetchParallelSchedules(projectId, planId, signal),
      fetchIntegrationGates(projectId, planId, signal),
      fetchProjectState(projectId, signal),
    ]);
    return { schedules, gates, state };
  }, [planId, projectId]);
  const { data, error: readError, isLoading, refresh } = useReadOnlyPollingResource<GateControlData>({
    scopeKey: `${projectId}:${planId}`,
    load,
    refreshToken,
  });

  const schedules = useMemo(() => data?.schedules ?? [], [data?.schedules]);
  const gates = useMemo(() => data?.gates ?? [], [data?.gates]);
  const currentStateRevision = data?.state.stateRevision ?? -1;
  const eligibleSchedules = useMemo(() => schedules.filter((schedule) => canCreateGate(
    schedule, gates, currentPlanVersionId, currentPlanVersionNumber, currentStateRevision,
  )), [currentPlanVersionId, currentPlanVersionNumber, currentStateRevision, gates, schedules]);
  const pendingGates = useMemo(
    () => gates.filter((gate) => gate.status === 'PENDING_APPROVAL'),
    [gates],
  );
  const evidenceOptions = useMemo(() => {
    const options = new Map<string, EvidenceOption>();
    for (const entry of data?.state.entries ?? []) {
      for (const evidenceReferenceId of entry.evidenceReferenceIds) {
        if (!options.has(evidenceReferenceId)) {
          options.set(evidenceReferenceId, {
            evidenceReferenceId,
            entryTitle: entry.title,
            entryType: entry.entryType,
          });
        }
      }
    }
    return [...options.values()];
  }, [data?.state.entries]);

  useEffect(() => {
    if (eligibleSchedules.some((schedule) => schedule.scheduleId === selectedScheduleId)) return;
    setSelectedScheduleId(eligibleSchedules[0]?.scheduleId ?? '');
    setRetryRequest(null);
  }, [eligibleSchedules, selectedScheduleId]);

  useEffect(() => {
    if (pendingGates.some((gate) => gate.gateId === selectedGateId)) return;
    setSelectedGateId(pendingGates[0]?.gateId ?? '');
    setRetryRequest(null);
  }, [pendingGates, selectedGateId]);

  const selectedSchedule = eligibleSchedules.find((schedule) => schedule.scheduleId === selectedScheduleId) ?? null;
  const selectedGate = pendingGates.find((gate) => gate.gateId === selectedGateId) ?? null;
  const enteredEvidence = manualEvidenceIds(manualEvidence);
  const invalidEvidence = enteredEvidence.filter((id) => !UUID_PATTERN.test(id));
  const evidenceReferenceIds = Array.from(new Set([
    ...Object.entries(selectedEvidence).filter(([, selected]) => selected).map(([id]) => id),
    ...enteredEvidence.filter((id) => UUID_PATTERN.test(id)),
  ]));
  const normalizedReason = rejectionReason.trim();

  const requestId = (requestKey: string): string => {
    const clientRequestId = retryRequest?.requestKey === requestKey
      ? retryRequest.clientRequestId
      : crypto.randomUUID();
    setRetryRequest({ requestKey, clientRequestId });
    return clientRequestId;
  };

  const complete = (gate: IntegrationGateView) => {
    setLastGate(gate);
    setRetryRequest(null);
    setCommandError(null);
    refresh();
    onChanged?.();
  };

  const create = async () => {
    if (!selectedSchedule || activeAction || invalidEvidence.length > 0 || evidenceReferenceIds.length === 0) return;
    const requestKey = `create:${selectedSchedule.scheduleId}:${evidenceReferenceIds.join(',')}`;
    setActiveAction('CREATE');
    setCommandError(null);
    try {
      complete(await createIntegrationGate(projectId, planId, {
        clientRequestId: requestId(requestKey),
        scheduleId: selectedSchedule.scheduleId,
        baseStateRevision: selectedSchedule.baseStateRevision,
        basePlanVersion: selectedSchedule.basePlanVersion,
        evidenceReferenceIds,
      }));
      setSelectedEvidence({});
      setManualEvidence('');
    } catch (reason) {
      setCommandError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setActiveAction(null);
    }
  };

  const decide = async (action: Exclude<GateAction, 'CREATE'>) => {
    if (!selectedGate || activeAction || (action === 'REJECT' && !normalizedReason)) return;
    const requestKey = `${action.toLowerCase()}:${selectedGate.gateId}:${action === 'REJECT' ? normalizedReason : ''}`;
    setActiveAction(action);
    setCommandError(null);
    try {
      const result = action === 'CONFIRM'
        ? await confirmIntegrationGate(projectId, planId, selectedGate.gateId, requestId(requestKey))
        : await rejectIntegrationGate(
          projectId, planId, selectedGate.gateId, requestId(requestKey), normalizedReason,
        );
      complete(result);
      setRejectionReason('');
    } catch (reason) {
      setCommandError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setActiveAction(null);
    }
  };

  return (
    <section className="mt-4 border-t pt-4" aria-label="集成门禁控制">
      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
        <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
        集成门禁
        <Badge variant="destructive">需要审批</Badge>
        <Badge variant="outline">必须提供证据</Badge>
      </div>

      {(readError || commandError) && (
        <div className="mt-2 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{commandError ?? readError}</span>
        </div>
      )}
      {invalidEvidence.length > 0 && (
        <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-800 dark:text-amber-200" role="alert">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>证据引用 ID 无效：{invalidEvidence[0]}</span>
        </div>
      )}
      {lastGate && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-200">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          <span>门禁 {shortId(lastGate.gateId)}</span>
          <Badge variant="outline">{lastGate.status}</Badge>
          <Badge variant="outline">证据 {lastGate.evidenceCount}</Badge>
        </div>
      )}

      {isLoading && data === null ? (
        <div className="mt-3 flex items-center gap-2 py-3 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />正在读取门禁控制
        </div>
      ) : readError && data === null ? null : (
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <section className="min-w-0 border-l-2 border-primary/30 pl-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <h5 className="text-xs font-semibold">创建门禁提案</h5>
              <Badge variant="secondary">可用调度 {eligibleSchedules.length}</Badge>
              <Badge variant="outline">证据 {evidenceReferenceIds.length}</Badge>
            </div>
            {eligibleSchedules.length === 0 ? (
              <div className="mt-2 rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                当前没有可用且已准备的调度
              </div>
            ) : (
              <div className="mt-2 space-y-3">
                <label className="block text-xs">
                  <span className="mb-1 block text-muted-foreground">选择调度</span>
                  <select
                    value={selectedScheduleId}
                    onChange={(event) => {
                      setSelectedScheduleId(event.target.value);
                      setRetryRequest(null);
                    }}
                    disabled={activeAction !== null}
                    className="h-9 w-full rounded-md border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
                  >
                    {eligibleSchedules.map((schedule) => (
                      <option key={schedule.scheduleId} value={schedule.scheduleId}>{scheduleLabel(schedule)}</option>
                    ))}
                  </select>
                </label>

                {evidenceOptions.length > 0 && (
                  <fieldset className="space-y-1.5">
                    <legend className="mb-1 text-xs text-muted-foreground">项目状态证据</legend>
                    <div className="max-h-32 space-y-1 overflow-auto border-y py-2">
                      {evidenceOptions.map((option) => (
                        <label key={option.evidenceReferenceId} className="flex min-w-0 items-start gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={selectedEvidence[option.evidenceReferenceId] ?? false}
                            onChange={(event) => {
                              setSelectedEvidence((value) => ({
                                ...value,
                                [option.evidenceReferenceId]: event.target.checked,
                              }));
                              setRetryRequest(null);
                            }}
                            disabled={activeAction !== null}
                            className="mt-0.5"
                          />
                          <span className="min-w-0">
                            <span className="block truncate">{option.entryTitle}</span>
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {option.entryType} / {shortId(option.evidenceReferenceId)}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}

                <label className="block text-xs">
                  <span className="mb-1 block text-muted-foreground">补充证据引用 ID</span>
                  <textarea
                    value={manualEvidence}
                    onChange={(event) => {
                      setManualEvidence(event.target.value);
                      setRetryRequest(null);
                    }}
                    disabled={activeAction !== null}
                    rows={2}
                    maxLength={4000}
                    className="w-full resize-y rounded-md border bg-background px-2 py-1.5 font-mono text-[11px] outline-none focus:ring-1 focus:ring-ring"
                  />
                </label>

                <Button
                  type="button"
                  size="sm"
                  disabled={activeAction !== null || !selectedSchedule || invalidEvidence.length > 0
                    || evidenceReferenceIds.length === 0 || evidenceReferenceIds.length > 100}
                  onClick={() => void create()}
                >
                  {activeAction === 'CREATE'
                    ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    : <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
                  创建门禁
                </Button>
              </div>
            )}
          </section>

          <section className="min-w-0 border-l-2 border-primary/30 pl-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <h5 className="text-xs font-semibold">审批门禁</h5>
              <Badge variant="secondary">待审批 {pendingGates.length}</Badge>
            </div>
            {pendingGates.length === 0 ? (
              <div className="mt-2 rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                当前没有待审批门禁
              </div>
            ) : (
              <div className="mt-2 space-y-3">
                <label className="block text-xs">
                  <span className="mb-1 block text-muted-foreground">选择门禁</span>
                  <select
                    value={selectedGateId}
                    onChange={(event) => {
                      setSelectedGateId(event.target.value);
                      setRetryRequest(null);
                    }}
                    disabled={activeAction !== null}
                    className="h-9 w-full rounded-md border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
                  >
                    {pendingGates.map((gate) => (
                      <option key={gate.gateId} value={gate.gateId}>
                        {shortId(gate.gateId)} / 调度 {shortId(gate.scheduleId)} / 证据 {gate.evidenceCount}
                      </option>
                    ))}
                  </select>
                </label>

                {selectedGate && (
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    <Badge variant={selectedGate.evidenceStatus === 'PRESENT' ? 'secondary' : 'destructive'}>
                      证据 {selectedGate.evidenceCount}
                    </Badge>
                    <Badge variant="outline">{String(selectedGate.proposal.physicalWorkspaceKind ?? 'UNKNOWN')}</Badge>
                    <Badge variant={selectedGate.planVersionId === currentPlanVersionId
                      && selectedGate.basePlanVersion === currentPlanVersionNumber
                      && selectedGate.baseStateRevision === currentStateRevision ? 'secondary' : 'destructive'}>
                      基线：计划版本 {selectedGate.basePlanVersion} / 状态版本 {selectedGate.baseStateRevision}
                    </Badge>
                  </div>
                )}

                <label className="block text-xs">
                  <span className="mb-1 block text-muted-foreground">拒绝原因</span>
                  <Input
                    value={rejectionReason}
                    onChange={(event) => {
                      setRejectionReason(event.target.value);
                      setRetryRequest(null);
                    }}
                    disabled={activeAction !== null}
                    maxLength={1000}
                  />
                </label>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={activeAction !== null || !selectedGate
                      || selectedGate.evidenceStatus !== 'PRESENT'
                      || selectedGate.evidenceCount < 1
                      || selectedGate.planVersionId !== currentPlanVersionId
                      || selectedGate.basePlanVersion !== currentPlanVersionNumber
                      || selectedGate.baseStateRevision !== currentStateRevision}
                    onClick={() => void decide('CONFIRM')}
                  >
                    {activeAction === 'CONFIRM'
                      ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      : <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
                    批准门禁
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={activeAction !== null || !selectedGate || !normalizedReason}
                    onClick={() => void decide('REJECT')}
                  >
                    {activeAction === 'REJECT'
                      ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      : <X className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
                    拒绝门禁
                  </Button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
