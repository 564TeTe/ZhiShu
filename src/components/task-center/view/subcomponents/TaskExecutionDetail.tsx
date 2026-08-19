import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../../shared/view/ui';
import type { TaskCenterTaskDetail } from '../../model/taskCenterModel';
import { executionStatusLabel, resolutionStatusLabel } from '../taskCenterLabels';

import { AttemptHistory } from './AttemptHistory';
import { EvidenceList } from './EvidenceList';
import { TaskExecutionActions } from './TaskExecutionActions';

type TaskExecutionDetailProps = {
  detail: TaskCenterTaskDetail | null;
  error: string | null;
  isLoading: boolean;
  isRefreshing: boolean;
  activeCommand: string | null;
  onRefresh(): void;
  onCancel(): Promise<void>;
  onRetry(): Promise<void>;
  onFollowUp(parentAttemptId: string, feedback: string, requestedAcceptance: string): Promise<void>;
  onAccept(attemptId: string, decision: 'RESOLVED' | 'NEEDS_FOLLOW_UP' | 'CLOSED', reason: string): Promise<void>;
  onArchive(reason: string): Promise<void>;
  onApprovalDecision(approvalId: string, decision: 'APPROVED' | 'DENIED'): Promise<void>;
};

export function TaskExecutionDetail({
  detail,
  error,
  isLoading,
  isRefreshing,
  activeCommand,
  onRefresh,
  onCancel,
  onRetry,
  onFollowUp,
  onAccept,
  onArchive,
  onApprovalDecision,
}: TaskExecutionDetailProps) {
  if (isLoading && !detail) {
    return (
      <Card className="rounded-none">
        <CardContent className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          正在读取完整执行历史…
        </CardContent>
      </Card>
    );
  }

  if (!detail) {
    return (
      <Card className="rounded-none border-destructive/30">
        <CardContent className="flex flex-col items-center py-10 text-center">
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden="true" />
          <div className="mt-3 text-sm font-medium">任务详情暂时无法读取</div>
          <p className="mt-1 text-xs text-muted-foreground">{error ?? '未知读取错误'}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={onRefresh}>
            <RefreshCw className="mr-2 h-3.5 w-3.5" aria-hidden="true" />重新读取
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-none">
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="truncate text-base">{detail.task.title}</CardTitle>
            <Badge variant="outline">任务结果</Badge>
            {detail.availability === 'partial' && <Badge variant="secondary">部分数据可用</Badge>}
            {detail.task.archivedAt && <Badge variant="secondary">已归档</Badge>}
          </div>
          <CardDescription className="mt-1 whitespace-pre-wrap">{detail.task.objective}</CardDescription>
          <div className="mt-3 grid gap-1 text-xs text-muted-foreground sm:grid-cols-3">
            <span title="任务状态当前与最新一次执行状态保持一致">任务状态：{executionStatusLabel(detail.task.status)}</span>
            <span>本次执行：{executionStatusLabel(detail.task.attemptStatus)}</span>
            <span>验收状态：{resolutionStatusLabel(detail.task.resolutionStatus)}</span>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={isRefreshing}>
          {isRefreshing
            ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            : <RefreshCw className="mr-2 h-3.5 w-3.5" aria-hidden="true" />}
          刷新详情
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <TaskExecutionActions
          task={detail.task}
          activeCommand={activeCommand}
          onCancel={onCancel}
          onRetry={onRetry}
          onFollowUp={onFollowUp}
          onAccept={onAccept}
          onArchive={onArchive}
        />
        {detail.task.runtimeHealthStatus === 'LOST' && !detail.task.archivedAt && (
          <div className="flex flex-col gap-3 rounded-lg border border-red-500/30 bg-red-500/5 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold text-red-700 dark:text-red-300">本次运行已失联，无法继续恢复</div>
              <p className="mt-1 text-xs text-muted-foreground">
                恢复操作会创建一次全新的执行；旧运行的迟到事件不会影响新执行。
              </p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              disabled={activeCommand !== null}
              onClick={() => void onRetry().catch(() => undefined)}
            >
              {activeCommand === 'retry' && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              创建新的执行
            </Button>
          </div>
        )}
        {detail.task.archivedAt && (
          <div className="rounded-lg border border-slate-500/30 bg-slate-500/5 p-3 text-sm">
            归档原因：{detail.task.archiveReason || '未填写'}
            {detail.task.archivedBy && <span className="ml-2 text-xs text-muted-foreground">操作者 {detail.task.archivedBy}</span>}
          </div>
        )}
        {(error || detail.warnings.length > 0) && (
          <div className="space-y-2">
            {error && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                最近一次详情刷新失败：{error}
              </div>
            )}
            {detail.warnings.map((warning, index) => (
              <div key={`${warning.code}-${index}`} className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                {warning.message}
              </div>
            ))}
          </div>
        )}

        <div className="grid gap-4 xl:grid-cols-2">
          <section>
            <h3 className="mb-2 text-sm font-semibold">执行过程</h3>
            <AttemptHistory attempts={detail.attempts} />
          </section>
          <section>
            <h3 className="mb-2 text-sm font-semibold">相关记录</h3>
            <EvidenceList
              approvals={detail.approvals}
              artifacts={detail.artifacts}
              followUps={detail.followUps}
              activeCommand={activeCommand}
              onApprovalDecision={onApprovalDecision}
              readOnly={Boolean(detail.task.archivedAt)}
            />
          </section>
        </div>
      </CardContent>
    </Card>
  );
}
