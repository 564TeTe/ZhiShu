import { AlertTriangle, BellRing, FileText, GitPullRequestArrow } from 'lucide-react';

import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../../shared/view/ui';
import type { TaskCenterDashboard } from '../../model/taskCenterModel';

type AttentionPanelProps = {
  dashboard: TaskCenterDashboard;
  requestError: string | null;
  isStale: boolean;
};

export function AttentionPanel({ dashboard, requestError, isStale }: AttentionPanelProps) {
  const notices = [
    ...(requestError ? [{ code: 'REFRESH_FAILED', message: `最近一次刷新失败：${requestError}` }] : []),
    ...(isStale ? [{ code: 'STALE', message: '当前数据已超过刷新窗口，状态可能不是最新。' }] : []),
    ...dashboard.warnings,
    ...dashboard.tasks
      .filter((task) => task.runtimeHealthStatus === 'UNKNOWN')
      .map((task) => ({ code: 'RUNTIME_UNKNOWN', message: `${task.title}：运行心跳暂时中断，请留意后续状态。` })),
    ...dashboard.tasks
      .filter((task) => task.runtimeHealthStatus === 'LOST')
      .map((task) => ({ code: 'RUNTIME_LOST', message: `${task.title}：原执行已经失联，需要创建一次新的执行来恢复。` })),
  ];

  return (
    <Card className="rounded-none">
      <CardHeader>
        <div className="flex items-center gap-2">
          <BellRing className="h-4 w-4 text-primary" aria-hidden="true" />
          <CardTitle className="text-base">需要关注</CardTitle>
        </div>
        <CardDescription>审批、依赖异常和近期执行证据集中在这里。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {notices.length > 0 && (
          <div className="space-y-2">
            {notices.map((notice, index) => (
              <div key={`${notice.code}-${index}`} className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
                <span>{notice.message}</span>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">待审批</div>
          {dashboard.approvals.length === 0 ? (
            <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">当前没有待审批事项。</div>
          ) : dashboard.approvals.slice(0, 6).map((approval) => (
            <div key={approval.approvalId} className="flex items-start justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{approval.toolName}</div>
                <div className="mt-1 text-xs text-muted-foreground">任务 {approval.taskId.slice(0, 8)}</div>
              </div>
              <Badge variant="outline">风险：{approval.riskLevel}</Badge>
            </div>
          ))}
        </div>

        {(dashboard.recentArtifacts.length > 0 || dashboard.recentFollowUps.length > 0) && (
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">近期证据与跟进</div>
            {dashboard.recentArtifacts.slice(0, 3).map((artifact) => (
              <div key={artifact.artifactId} className="flex gap-2 rounded-lg border p-3">
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0">
                  <div className="text-xs font-medium">{artifact.artifactType}</div>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {artifact.contentExcerpt ?? '已记录结构化产物'}
                  </p>
                </div>
              </div>
            ))}
            {dashboard.recentFollowUps.slice(0, 3).map((followUp) => (
              <div key={followUp.followUpId} className="flex gap-2 rounded-lg border p-3">
                <GitPullRequestArrow className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0">
                  <div className="text-xs font-medium">第 {followUp.attemptNumber} 次跟进</div>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {followUp.feedbackExcerpt ?? '已创建跟进执行'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
