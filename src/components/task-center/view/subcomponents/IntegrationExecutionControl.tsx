import {
  AlertTriangle,
  Bot,
  GitCommitVertical,
  GitMerge,
  Loader2,
  RotateCcw,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
} from '../../../../shared/view/ui';
import {
  executeIntegrationGate,
  fetchIntegrationGates,
  finalizeIntegrationExecution,
  startIntegrationAgent,
} from '../../api/taskCenterApi';
import { useReadOnlyPollingResource } from '../../hooks/useReadOnlyPollingResource';
import type {
  IntegrationAgentRunView,
  IntegrationExecutionView,
  IntegrationGateView,
} from '../../model/taskCenterModel';

function shortId(value: string): string {
  return value.length > 16 ? `${value.slice(0, 12)}...` : value;
}

export function IntegrationExecutionControl({
  projectId,
  planId,
  refreshToken = 0,
  onChanged,
}: {
  projectId: string;
  planId: string;
  refreshToken?: number;
  onChanged?: () => void;
}) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastExecution, setLastExecution] = useState<IntegrationExecutionView | null>(null);
  const [lastAgent, setLastAgent] = useState<IntegrationAgentRunView | null>(null);
  const [pendingFinalization, setPendingFinalization] = useState<{
    gate: IntegrationGateView;
    run: IntegrationExecutionView;
  } | null>(null);
  const [retryRequest, setRetryRequest] = useState<{ key: string; id: string } | null>(null);
  const load = useCallback(
    (signal: AbortSignal) => fetchIntegrationGates(projectId, planId, signal),
    [planId, projectId],
  );
  const { data, error: readError } = useReadOnlyPollingResource<IntegrationGateView[]>({
    scopeKey: `${projectId}:${planId}`,
    load,
    refreshToken,
  });
  const gates = useMemo(() => data ?? [], [data]);
  const executable = useMemo(() => gates.filter((gate) => (
    gate.status === 'APPROVED'
    && ['NOT_ATTEMPTED', 'FAILED'].includes(gate.applyState)
    && gate.proposal.physicalWorkspaceKind === 'GIT_WORKTREE'
  )), [gates]);
  const failedRuns = useMemo(() => gates.flatMap((gate) => (
    (gate.executions ?? []).filter((run) => run.status === 'FAILED').map((run) => ({ gate, run }))
  )), [gates]);
  const finalizableRuns = useMemo(() => gates.flatMap((gate) => (
    (gate.executions ?? []).filter((run) => run.status === 'SUCCEEDED'
      && Boolean(run.candidateCommit)
      && run.finalizationState !== 'CLEANED').map((run) => ({ gate, run }))
  )), [gates]);

  const requestId = (key: string) => {
    const id = retryRequest?.key === key ? retryRequest.id : crypto.randomUUID();
    setRetryRequest({ key, id });
    return id;
  };

  const execute = async (gate: IntegrationGateView) => {
    const key = `execute:${gate.gateId}:${gate.applyState}`;
    setBusyKey(key);
    setError(null);
    try {
      const result = await executeIntegrationGate(projectId, planId, gate.gateId, requestId(key));
      setLastExecution(result);
      setRetryRequest(null);
      onChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyKey(null);
    }
  };

  const startAgent = async (gate: IntegrationGateView, run: IntegrationExecutionView) => {
    const key = `agent:${run.runId}`;
    setBusyKey(key);
    setError(null);
    try {
      const result = await startIntegrationAgent(
        projectId, planId, gate.gateId, run.runId, requestId(key), null,
      );
      setLastAgent(result);
      setRetryRequest(null);
      onChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyKey(null);
    }
  };

  const finalize = async (gate: IntegrationGateView, run: IntegrationExecutionView) => {
    if (!run.candidateCommit) return;
    const key = `finalize:${run.runId}:${run.candidateCommit}`;
    setBusyKey(key);
    setError(null);
    try {
      const result = await finalizeIntegrationExecution(
        projectId, planId, gate.gateId, run.runId, requestId(key), run.candidateCommit,
      );
      setLastExecution(result);
      setRetryRequest(null);
      onChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyKey(null);
    }
  };

  const confirmFinalization = async () => {
    if (!pendingFinalization) return;
    const { gate, run } = pendingFinalization;
    setPendingFinalization(null);
    await finalize(gate, run);
  };

  return (
    <section className="mt-4 border-t pt-4" aria-label="集成执行控制">
      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
        <GitMerge className="h-4 w-4 text-primary" aria-hidden="true" />
        集成执行
        <Badge variant="destructive">会执行命令</Badge>
        <Badge variant="outline">隔离 Git 工作树</Badge>
      </div>

      {(error || readError) && (
        <div className="mt-2 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{error ?? readError}</span>
        </div>
      )}

      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <section className="min-w-0 border-l-2 border-primary/30 pl-3">
          <h5 className="text-xs font-semibold">已批准门禁</h5>
          {executable.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">暂无可执行的 Git 工作树门禁</p>
          ) : (
            <div className="mt-2 space-y-2">
              {executable.map((gate) => {
                const key = `execute:${gate.gateId}:${gate.applyState}`;
                return (
                  <div key={gate.gateId} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-xs">
                    <div className="min-w-0">
                      <div className="font-medium">门禁 {shortId(gate.gateId)}</div>
                      <div className="text-muted-foreground">{gate.applyState} · 调度 {shortId(gate.scheduleId)}</div>
                    </div>
                    <Button type="button" size="sm" disabled={busyKey !== null} onClick={() => void execute(gate)}>
                      {busyKey === key
                        ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        : gate.applyState === 'FAILED'
                          ? <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                          : <GitMerge className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
                      {gate.applyState === 'FAILED' ? '重试' : '执行'}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="min-w-0 border-l-2 border-emerald-500/30 pl-3">
          <h5 className="text-xs font-semibold">可最终应用的成功执行</h5>
          {finalizableRuns.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">暂无等待最终应用的执行</p>
          ) : (
            <div className="mt-2 space-y-2">
              {finalizableRuns.map(({ gate, run }) => {
                const key = `finalize:${run.runId}:${run.candidateCommit}`;
                const cleanupOnly = ['APPLIED', 'CLEANUP_PENDING'].includes(run.finalizationState);
                return (
                  <div key={run.runId} className="border-b pb-2 text-xs">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium">执行 {shortId(run.runId)}</div>
                        <div className="break-all font-mono text-[10px] text-muted-foreground">
                          {run.candidateCommit}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          <Badge variant="outline">{run.finalizationState}</Badge>
                          {run.policyPreset && <Badge variant="outline">策略 {run.policyPreset}</Badge>}
                          {run.finalizedTargetRef && <Badge variant="secondary">{run.finalizedTargetRef}</Badge>}
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={busyKey !== null}
                        onClick={() => setPendingFinalization({ gate, run })}
                      >
                        {busyKey === key
                          ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          : <GitCommitVertical className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
                        {cleanupOnly ? '继续清理' : '确认应用到主分支'}
                      </Button>
                    </div>
                    {run.finalizationFailureMessage && (
                      <p className="mt-1 break-words text-destructive">{run.finalizationFailureMessage}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="min-w-0 border-l-2 border-amber-500/30 pl-3">
          <h5 className="text-xs font-semibold">失败执行</h5>
          {failedRuns.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">暂无失败的集成执行</p>
          ) : (
            <div className="mt-2 space-y-2">
              {failedRuns.map(({ gate, run }) => {
                const key = `agent:${run.runId}`;
                return (
                  <div key={run.runId} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-xs">
                    <div className="min-w-0">
                      <div className="font-medium">执行 {shortId(run.runId)}</div>
                      <div className="break-words text-muted-foreground">{run.failureCode ?? '执行失败'} · {run.failureMessage ?? '没有详细原因'}</div>
                      {run.replanProposalId && <Badge variant="outline">重新规划 {shortId(run.replanProposalId)}</Badge>}
                    </div>
                    <Button type="button" size="sm" variant="outline" disabled={busyKey !== null} onClick={() => void startAgent(gate, run)}>
                      {busyKey === key
                        ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        : <Bot className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
                      启动执行代理
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {(lastExecution || lastAgent) && (
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {lastExecution && <Badge variant="secondary">Run {shortId(lastExecution.runId)} · {lastExecution.status}</Badge>}
          {lastAgent && <Badge variant="secondary">Agent {shortId(lastAgent.agentRunId)} · {lastAgent.status}</Badge>}
        </div>
      )}

      <Dialog
        open={pendingFinalization !== null}
        onOpenChange={(open) => { if (!open) setPendingFinalization(null); }}
      >
        <DialogContent className="p-5">
          <DialogTitle>确认将候选提交应用到主分支</DialogTitle>
          {pendingFinalization && (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-semibold">这是一次不可逆的项目变更</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  只有在你确认构建、测试和候选提交都正确后，才继续 fast-forward 主分支并清理隔离工作树。
                </p>
              </div>
              <dl className="grid gap-2 rounded-md border bg-muted/30 p-3 text-xs sm:grid-cols-[auto_minmax(0,1fr)]">
                <dt className="text-muted-foreground">执行</dt>
                <dd className="font-mono">{shortId(pendingFinalization.run.runId)}</dd>
                <dt className="text-muted-foreground">候选提交</dt>
                <dd className="break-all font-mono">{pendingFinalization.run.candidateCommit}</dd>
                <dt className="text-muted-foreground">目标项目</dt>
                <dd>{projectId}</dd>
              </dl>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setPendingFinalization(null)}>
                  取消
                </Button>
                <Button type="button" variant="destructive" onClick={() => void confirmFinalization()}>
                  确认应用并清理
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
