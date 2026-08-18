import { Archive, CheckCircle2, CircleAlert, CircleDashed, Clock3, LoaderCircle, RefreshCw, Search } from 'lucide-react';

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from '../../../../shared/view/ui';
import type { TaskCenterTask, TaskCenterTaskArchiveScope } from '../../model/taskCenterModel';
import { executionStatusLabel, resolutionStatusLabel, runtimeHealthLabel } from '../taskCenterLabels';

type ExecutionListProps = {
  tasks: TaskCenterTask[];
  selectedTaskId: string | null;
  onSelectTask(taskId: string): void;
  archive: TaskCenterTaskArchiveScope;
  onArchiveChange(archive: TaskCenterTaskArchiveScope): void;
  status: string | null;
  onStatusChange(status: string | null): void;
  resolutionStatus: string | null;
  onResolutionStatusChange(status: string | null): void;
  search: string;
  onSearchChange(search: string): void;
  onSearch(): void;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  onRefresh(): void;
  onLoadMore(): void;
};

function statusPresentation(status: string) {
  if (['PENDING', 'STARTING', 'RUNNING', 'CANCELLING'].includes(status)) {
    return { label: '执行中', icon: LoaderCircle, className: 'text-blue-600' };
  }
  if (status === 'WAITING_APPROVAL') {
    return { label: '待审批', icon: Clock3, className: 'text-amber-600' };
  }
  if (status === 'SUCCEEDED') {
    return { label: '执行成功', icon: CheckCircle2, className: 'text-emerald-600' };
  }
  if (status === 'LOST') {
    return { label: '执行失联', icon: CircleAlert, className: 'text-red-700' };
  }
  if (status === 'FAILED' || status === 'ABORTED') {
    return { label: status === 'FAILED' ? '失败' : '已中止', icon: CircleAlert, className: 'text-red-600' };
  }
  return { label: status, icon: CircleDashed, className: 'text-muted-foreground' };
}

export function ExecutionList({
  tasks,
  selectedTaskId,
  onSelectTask,
  archive,
  onArchiveChange,
  status,
  onStatusChange,
  resolutionStatus,
  onResolutionStatusChange,
  search,
  onSearchChange,
  onSearch,
  isLoading,
  isLoadingMore,
  hasMore,
  error,
  onRefresh,
  onLoadMore,
}: ExecutionListProps) {
  return (
    <Card className="rounded-none">
      <CardHeader className="gap-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">任务历史</CardTitle>
            <CardDescription>查看任务、每次执行记录和最终验收结果。</CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={onRefresh} disabled={isLoading} title="刷新任务历史" aria-label="刷新任务历史">
            <RefreshCw className={isLoading ? 'animate-spin' : ''} aria-hidden="true" />
          </Button>
        </div>
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); onSearch(); }}>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="搜索标题、目标或任务 ID"
              aria-label="搜索任务历史"
              className="pl-9"
              maxLength={200}
            />
          </div>
          <Button type="submit" variant="outline" className="shrink-0">
            <Search aria-hidden="true" />搜索
          </Button>
        </form>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border bg-muted/30 p-0.5" role="group" aria-label="任务范围">
            {([
              ['ACTIVE', '活动'],
              ['ARCHIVED', '归档'],
              ['ALL', '全部'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={archive === value}
                className={`min-h-8 rounded px-2.5 text-xs font-medium transition-colors ${archive === value ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                onClick={() => onArchiveChange(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <select
            value={status ?? ''}
            onChange={(event) => onStatusChange(event.target.value || null)}
            className="h-9 rounded-md border bg-background px-2.5 text-xs outline-none focus:ring-1 focus:ring-ring"
            aria-label="按执行状态筛选"
          >
            <option value="">全部执行状态</option>
            {['PENDING', 'STARTING', 'RUNNING', 'WAITING_APPROVAL', 'CANCELLING', 'SUCCEEDED', 'FAILED', 'LOST', 'ABORTED'].map((value) => (
              <option key={value} value={value}>{executionStatusLabel(value)}</option>
            ))}
          </select>
          <select
            value={resolutionStatus ?? ''}
            onChange={(event) => onResolutionStatusChange(event.target.value || null)}
            className="h-9 rounded-md border bg-background px-2.5 text-xs outline-none focus:ring-1 focus:ring-ring"
            aria-label="按验收状态筛选"
          >
            <option value="">全部验收状态</option>
            {['OPEN', 'IN_PROGRESS', 'WAITING_ACCEPTANCE', 'NEEDS_FOLLOW_UP', 'RESOLVED', 'CLOSED'].map((value) => (
              <option key={value} value={value}>{resolutionStatusLabel(value)}</option>
            ))}
          </select>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
            {error}
          </div>
        )}
        {isLoading && tasks.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />正在读取任务历史…
          </div>
        ) : tasks.length === 0 ? (
          <div className="rounded-lg border border-dashed px-4 py-10 text-center">
            <CircleDashed className="mx-auto h-7 w-7 text-muted-foreground" aria-hidden="true" />
            <div className="mt-3 text-sm font-medium">暂无匹配任务</div>
            <p className="mt-1 text-xs text-muted-foreground">当前范围、状态或搜索条件没有返回任务。</p>
          </div>
        ) : (
          <div className="divide-y rounded-lg border">
            {tasks.map((task) => {
              const presentation = statusPresentation(task.attemptStatus || task.status);
              const StatusIcon = presentation.icon;
              return (
                <button
                  key={task.taskId}
                  type="button"
                  aria-pressed={selectedTaskId === task.taskId}
                  className={`block w-full p-3.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:p-4 ${
                    selectedTaskId === task.taskId ? 'bg-primary/5' : ''
                  }`}
                  onClick={() => onSelectTask(task.taskId)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{task.title}</div>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{task.objective}</p>
                    </div>
                     <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                       {task.archivedAt && (
                         <Badge variant="secondary"><Archive className="mr-1 h-3.5 w-3.5" aria-hidden="true" />归档</Badge>
                       )}
                       <Badge variant="outline" className={presentation.className}>
                       <StatusIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                       {presentation.label}
                       </Badge>
                     </div>
                  </div>
                  <div className="mt-3 grid gap-1 text-xs text-muted-foreground sm:grid-cols-3">
                    <span title="任务状态当前与最新一次执行状态保持一致">任务：{executionStatusLabel(task.status)}</span>
                    <span>第 {task.attemptNumber ?? '—'} 次执行：{executionStatusLabel(task.attemptStatus)}</span>
                    <span>验收：{resolutionStatusLabel(task.resolutionStatus)}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>运行健康：{runtimeHealthLabel(task.runtimeHealthStatus)}</span>
                    {task.lastHeartbeatAt && (
                      <span>最后存活：{new Date(task.lastHeartbeatAt).toLocaleString()}</span>
                    )}
                  </div>
                   <div className="mt-2 text-xs text-muted-foreground">创建于 {new Date(task.createdAt).toLocaleString()}</div>
                   {task.archivedAt && (
                     <div className="mt-2 text-xs text-muted-foreground">
                       归档于 {new Date(task.archivedAt).toLocaleString()} · {task.archivedBy ?? '未知操作者'}
                     </div>
                   )}
                  {task.errorMessage && (
                    <div className="mt-2 rounded-md bg-destructive/5 px-2.5 py-2 text-xs text-destructive">
                      {task.errorMessage}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
        {hasMore && (
          <div className="mt-3 flex justify-center">
            <Button variant="outline" size="sm" onClick={onLoadMore} disabled={isLoadingMore}>
              {isLoadingMore && <LoaderCircle className="animate-spin" aria-hidden="true" />}
              加载更多
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
