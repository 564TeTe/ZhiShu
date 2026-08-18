import { CheckCircle2, CircleAlert, CircleDashed, GitPullRequestArrow } from 'lucide-react';

import { Badge } from '../../../../shared/view/ui';
import type { TaskCenterAttempt } from '../../model/taskCenterModel';
import { approvalModeLabel, executionStatusLabel, runtimeHealthLabel } from '../taskCenterLabels';

type AttemptHistoryProps = {
  attempts: TaskCenterAttempt[];
};

export function AttemptHistory({ attempts }: AttemptHistoryProps) {
  if (attempts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">
        <CircleDashed className="mx-auto mb-2 h-5 w-5" aria-hidden="true" />
        当前没有执行尝试记录。
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {attempts.map((attempt) => (
        <div key={attempt.attemptId} className="rounded-lg border p-3.5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">第 {attempt.attemptNumber} 次执行</div>
              <div className="mt-1 font-mono text-[11px] text-muted-foreground">{attempt.attemptId}</div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline">{executionStatusLabel(attempt.status)}</Badge>
              <Badge variant={attempt.runtimeHealthStatus === 'LOST' ? 'destructive' : 'secondary'}>
                {runtimeHealthLabel(attempt.runtimeHealthStatus)}
              </Badge>
            </div>
          </div>
          <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
            <span>执行器：{attempt.executor ?? '未记录'}</span>
            <span>模型：{attempt.modelAlias ?? '未记录'}</span>
            <span>审批模式：{approvalModeLabel(attempt.approvalMode)}</span>
            <span>运行编号：{attempt.runtimeRunId ?? '未分配'}</span>
            <span>开始：{attempt.startedAt ? new Date(attempt.startedAt).toLocaleString() : '未开始'}</span>
            <span>结束：{attempt.completedAt ? new Date(attempt.completedAt).toLocaleString() : '未结束'}</span>
            <span>最后存活：{attempt.lastHeartbeatAt ? new Date(attempt.lastHeartbeatAt).toLocaleString() : '未观测'}</span>
            <span>租约到期：{attempt.leaseExpiresAt ? new Date(attempt.leaseExpiresAt).toLocaleString() : '无活动租约'}</span>
          </div>

          {attempt.runtimeHealthStatus === 'UNKNOWN' && (
            <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-200">
              暂时没有收到运行心跳，系统仍处于宽限期，本次执行尚未判定为失联。
            </div>
          )}

          {attempt.runtimeHealthStatus === 'LOST' && (
            <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-800 dark:text-red-200">
              <div className="font-medium">旧运行无法继续恢复。</div>
              <p className="mt-1">{attempt.lostReason ?? '运行租约已过期。'}</p>
              {attempt.lostAt && <div className="mt-1">判定失联：{new Date(attempt.lostAt).toLocaleString()}</div>}
            </div>
          )}

          {attempt.followUpId && (
            <div className="mt-3 rounded-md bg-muted/40 p-3 text-xs">
              <div className="flex items-center gap-1.5 font-medium">
                <GitPullRequestArrow className="h-3.5 w-3.5" aria-hidden="true" />
                跟进执行
              </div>
              {attempt.followUpFeedback && <p className="mt-1.5 whitespace-pre-wrap text-muted-foreground">{attempt.followUpFeedback}</p>}
              {attempt.requestedAcceptance && (
                <p className="mt-1.5 whitespace-pre-wrap text-muted-foreground">验收要求：{attempt.requestedAcceptance}</p>
              )}
            </div>
          )}

          {attempt.acceptanceDecision && (
            <div className="mt-3 flex gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
              <div>
                <div className="font-medium">人工验收：{attempt.acceptanceDecision}</div>
                {attempt.acceptanceReason && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{attempt.acceptanceReason}</p>}
                {attempt.acceptanceAt && <div className="mt-1 text-muted-foreground">{new Date(attempt.acceptanceAt).toLocaleString()}</div>}
              </div>
            </div>
          )}

          {attempt.errorMessage && (
            <div className="mt-3 flex gap-2 rounded-md bg-destructive/5 p-3 text-xs text-destructive">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div>
                <div className="font-medium">{attempt.errorCode ?? '执行错误'}</div>
                <p className="mt-1 whitespace-pre-wrap">{attempt.errorMessage}</p>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
