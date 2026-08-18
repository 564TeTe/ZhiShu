import { AlertTriangle, Clock3, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';

import { Badge, Button, Card, CardContent, CardTitle } from '../../../../shared/view/ui';
import type { TaskCenterDashboard } from '../../model/taskCenterModel';

type TaskCenterOverviewProps = {
  dashboard: TaskCenterDashboard;
  isRefreshing: boolean;
  isStale: boolean;
  onRefresh(): void;
};

const summaryItems = [
  { key: 'totalTasks', label: '全部任务' },
  { key: 'activeTasks', label: '执行中' },
  { key: 'waitingApproval', label: '待审批' },
  { key: 'awaitingAcceptance', label: '待验收' },
  { key: 'succeededTasks', label: '最近成功' },
  { key: 'failedTasks', label: '最近失败' },
  { key: 'lostTasks', label: '执行失联' },
  { key: 'abortedTasks', label: '最近中止' },
] as const;

export function TaskCenterOverview({
  dashboard,
  isRefreshing,
  isStale,
  onRefresh,
}: TaskCenterOverviewProps) {
  return (
    <Card className="rounded-none border-primary/20 shadow-none">
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>项目控制台</Badge>
            {dashboard.availability === 'partial' && (
              <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-300">
                部分数据可用
              </Badge>
            )}
            {isStale && (
              <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-300">
                数据已过期
              </Badge>
            )}
          </div>
          <div className="mt-2">
            <CardTitle className="truncate text-xl">{dashboard.project.displayName}</CardTitle>
            <p className="mt-1 truncate font-mono text-xs text-muted-foreground" title={dashboard.project.projectRef}>
              {dashboard.project.projectRef}
            </p>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              项目状态、任务与风险总览
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
              {new Date(dashboard.fetchedAt).toLocaleTimeString()}
            </span>
          </div>
          </div>
          <Button variant="outline" size="sm" className="shrink-0 self-start" onClick={onRefresh} disabled={isRefreshing}>
          {isRefreshing
            ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            : <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />}
          刷新
          </Button>
        </div>
        <div className="mt-4 grid grid-cols-2 border-t pt-3 sm:grid-cols-4 lg:grid-cols-8">
          {summaryItems.map((item) => {
            const value = dashboard.summary[item.key];
            const needsAttention = item.key === 'waitingApproval'
              || item.key === 'failedTasks'
              || item.key === 'lostTasks';
            return (
              <div key={item.key} className="min-w-0 px-2 py-1 first:pl-0 sm:px-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {needsAttention && value > 0 && <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
                  {item.label}
                </div>
                <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
