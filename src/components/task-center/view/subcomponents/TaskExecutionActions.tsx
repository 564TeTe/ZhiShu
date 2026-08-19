import { Archive, Ban, CheckCircle2, Loader2, MessageSquarePlus, RotateCcw } from 'lucide-react';
import { useState } from 'react';

import { Button, Dialog, DialogContent, DialogTitle } from '../../../../shared/view/ui';
import type { TaskCenterTask } from '../../model/taskCenterModel';

type AcceptanceDecision = 'RESOLVED' | 'NEEDS_FOLLOW_UP' | 'CLOSED';
type ActionDialog = 'cancel' | 'retry' | 'follow-up' | 'acceptance' | 'archive' | null;

type TaskExecutionActionsProps = {
  task: TaskCenterTask;
  activeCommand: string | null;
  onCancel(): Promise<void>;
  onRetry(): Promise<void>;
  onFollowUp(parentAttemptId: string, feedback: string, requestedAcceptance: string): Promise<void>;
  onAccept(attemptId: string, decision: AcceptanceDecision, reason: string): Promise<void>;
  onArchive(reason: string): Promise<void>;
};

const TERMINAL_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'LOST', 'ABORTED']);

export function TaskExecutionActions({
  task,
  activeCommand,
  onCancel,
  onRetry,
  onFollowUp,
  onAccept,
  onArchive,
}: TaskExecutionActionsProps) {
  const [dialog, setDialog] = useState<ActionDialog>(null);
  const [feedback, setFeedback] = useState('');
  const [requestedAcceptance, setRequestedAcceptance] = useState('');
  const [acceptanceReason, setAcceptanceReason] = useState('');
  const [acceptanceDecision, setAcceptanceDecision] = useState<AcceptanceDecision>('RESOLVED');
  const [archiveReason, setArchiveReason] = useState('');

  const archived = Boolean(task.archivedAt);
  const terminal = TERMINAL_STATUSES.has(task.attemptStatus);
  const canCancel = !archived && !terminal && task.attemptStatus !== 'CANCELLING';
  // LOST has a dedicated recovery callout because it has stricter recovery semantics.
  const canRetry = !archived && ['FAILED', 'ABORTED'].includes(task.attemptStatus);
  const canFollowUp = !archived && terminal && Boolean(task.attemptId)
    && !['RESOLVED', 'CLOSED'].includes(task.resolutionStatus);
  const canAccept = !archived && terminal && Boolean(task.attemptId)
    && ['WAITING_ACCEPTANCE', 'NEEDS_FOLLOW_UP'].includes(task.resolutionStatus);
  const canArchive = !archived && terminal;
  const busy = activeCommand !== null;

  const closeDialog = () => {
    if (!busy) setDialog(null);
  };

  const runAndClose = async (action: () => Promise<void>) => {
    await action();
    setDialog(null);
    setFeedback('');
    setRequestedAcceptance('');
    setAcceptanceReason('');
    setArchiveReason('');
  };

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {canCancel && (
          <Button variant="outline" size="sm" onClick={() => setDialog('cancel')} disabled={busy}>
            <Ban aria-hidden="true" />取消执行
          </Button>
        )}
        {canRetry && (
          <Button variant="outline" size="sm" onClick={() => setDialog('retry')} disabled={busy}>
            <RotateCcw aria-hidden="true" />重新执行
          </Button>
        )}
        {canFollowUp && (
          <Button variant="outline" size="sm" onClick={() => setDialog('follow-up')} disabled={busy}>
            <MessageSquarePlus aria-hidden="true" />继续跟进
          </Button>
        )}
        {canAccept && (
          <Button size="sm" onClick={() => setDialog('acceptance')} disabled={busy}>
            <CheckCircle2 aria-hidden="true" />业务验收
          </Button>
        )}
        {canArchive && (
          <Button variant="outline" size="sm" onClick={() => setDialog('archive')} disabled={busy}>
            <Archive aria-hidden="true" />归档任务
          </Button>
        )}
      </div>

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="max-h-[85vh] overflow-y-auto p-5 sm:p-6">
          <DialogTitle>任务操作</DialogTitle>

          {dialog === 'cancel' && (
            <div>
              <h3 className="text-base font-semibold">取消当前执行</h3>
              <p className="mt-2 text-sm text-muted-foreground">当前执行将进入取消状态，历史和证据会完整保留。</p>
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="outline" onClick={closeDialog} disabled={busy}>返回</Button>
                <Button
                  variant="destructive"
                  disabled={busy}
                  onClick={() => void runAndClose(onCancel).catch(() => undefined)}
                >
                  {activeCommand === 'cancel' && <Loader2 className="animate-spin" aria-hidden="true" />}
                  确认取消
                </Button>
              </div>
            </div>
          )}

          {dialog === 'retry' && (
            <div>
              <h3 className="text-base font-semibold">创建新的执行</h3>
              <p className="mt-2 text-sm text-muted-foreground">原执行记录保持不变，新执行会复用已冻结的配置和上下文。</p>
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="outline" onClick={closeDialog} disabled={busy}>返回</Button>
                <Button disabled={busy} onClick={() => void runAndClose(onRetry).catch(() => undefined)}>
                  {activeCommand === 'retry' && <Loader2 className="animate-spin" aria-hidden="true" />}
                  确认重新执行
                </Button>
              </div>
            </div>
          )}

          {dialog === 'follow-up' && task.attemptId && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void runAndClose(() => onFollowUp(
                  task.attemptId as string,
                  feedback.trim(),
                  requestedAcceptance.trim(),
                )).catch(() => undefined);
              }}
            >
              <h3 className="text-base font-semibold">发起任务跟进</h3>
              <label className="mt-4 block text-sm font-medium" htmlFor="task-follow-up-feedback">反馈</label>
              <textarea
                id="task-follow-up-feedback"
                className="mt-1 min-h-28 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                value={feedback}
                onChange={(event) => setFeedback(event.target.value)}
                maxLength={20_000}
                required
              />
              <label className="mt-4 block text-sm font-medium" htmlFor="task-follow-up-acceptance">新的验收要求</label>
              <textarea
                id="task-follow-up-acceptance"
                className="mt-1 min-h-24 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                value={requestedAcceptance}
                onChange={(event) => setRequestedAcceptance(event.target.value)}
                maxLength={20_000}
                required
              />
              <div className="mt-5 flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={closeDialog} disabled={busy}>返回</Button>
                <Button type="submit" disabled={busy || !feedback.trim() || !requestedAcceptance.trim()}>
                  {activeCommand === 'follow-up' && <Loader2 className="animate-spin" aria-hidden="true" />}
                  创建跟进任务
                </Button>
              </div>
            </form>
          )}

          {dialog === 'acceptance' && task.attemptId && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void runAndClose(() => onAccept(
                  task.attemptId as string,
                  acceptanceDecision,
                  acceptanceReason.trim(),
                )).catch(() => undefined);
              }}
            >
              <h3 className="text-base font-semibold">记录业务验收</h3>
              <div className="mt-4 grid grid-cols-1 gap-1 rounded-md bg-muted p-1 sm:grid-cols-3" role="group" aria-label="验收决定">
                {([
                  ['RESOLVED', '已解决'],
                  ['NEEDS_FOLLOW_UP', '需跟进'],
                  ['CLOSED', '关闭'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={acceptanceDecision === value}
                    className={`min-h-9 rounded px-3 text-sm font-medium transition-colors ${
                      acceptanceDecision === value ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    }`}
                    onClick={() => setAcceptanceDecision(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="mt-4 block text-sm font-medium" htmlFor="task-acceptance-reason">验收说明</label>
              <textarea
                id="task-acceptance-reason"
                className="mt-1 min-h-28 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                value={acceptanceReason}
                onChange={(event) => setAcceptanceReason(event.target.value)}
                maxLength={20_000}
                required
              />
              <div className="mt-5 flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={closeDialog} disabled={busy}>返回</Button>
                <Button type="submit" disabled={busy || !acceptanceReason.trim()}>
                  {activeCommand === 'acceptance' && <Loader2 className="animate-spin" aria-hidden="true" />}
                  提交验收
                </Button>
              </div>
            </form>
          )}

          {dialog === 'archive' && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void runAndClose(() => onArchive(archiveReason.trim())).catch(() => undefined);
              }}
            >
              <h3 className="text-base font-semibold">归档任务历史</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                归档只隐藏活动列表，不删除 Task、Attempt、Artifact 或验收记录；归档后的历史仍可搜索和追溯。
              </p>
              <label className="mt-4 block text-sm font-medium" htmlFor="task-archive-reason">归档原因</label>
              <textarea
                id="task-archive-reason"
                className="mt-1 min-h-24 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                value={archiveReason}
                onChange={(event) => setArchiveReason(event.target.value)}
                maxLength={2_000}
                required
              />
              <div className="mt-5 flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={closeDialog} disabled={busy}>返回</Button>
                <Button type="submit" disabled={busy || !archiveReason.trim()}>
                  {activeCommand === 'archive' && <Loader2 className="animate-spin" aria-hidden="true" />}
                  确认归档
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
