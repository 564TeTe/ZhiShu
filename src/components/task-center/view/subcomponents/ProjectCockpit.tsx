import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDot,
  RefreshCw,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';

import { Button } from '../../../../shared/view/ui';
import type {
  ProjectActivitySubscriptionState,
  ProjectMetrics,
  TaskCenterDashboard,
} from '../../model/taskCenterModel';

type CockpitSection = 'cockpit' | 'tasks' | 'plan' | 'knowledge' | 'advanced';

type ProjectCockpitProps = {
  dashboard: TaskCenterDashboard;
  metrics: ProjectMetrics | null;
  metricsError: string | null;
  subscription: ProjectActivitySubscriptionState;
  requestError: string | null;
  isRefreshing: boolean;
  isStale: boolean;
  onRefresh(): void;
  onNavigate(section: CockpitSection): void;
};

export function ProjectCockpit({
  dashboard,
  metrics,
  metricsError,
  subscription,
  requestError,
  isRefreshing,
  isStale,
  onRefresh,
  onNavigate,
}: ProjectCockpitProps) {
  const { summary, dependencies, project, tasks, approvals, recentArtifacts, warnings } = dashboard;
  const needsAttention = summary.waitingApproval + summary.awaitingAcceptance + summary.failedTasks + summary.lostTasks;
  const completed = summary.succeededTasks;
  const completion = summary.totalTasks > 0
    ? Math.min(100, Math.round((completed / summary.totalTasks) * 100))
    : 0;
  const phase = approvals.length > 0
    ? '需要审批'
    : summary.activeTasks > 0
      ? '正在执行'
      : summary.awaitingAcceptance > 0
        ? '等待验收'
        : summary.totalTasks === 0
          ? '准备开始'
          : '可以继续规划';
  const systemHealthy = dependencies.controlPlane.status === 'up'
    && dependencies.runtimeDelivery.status === 'up';

  return (
    <div className="space-y-5">
      <section className="border border-border/70 bg-background px-5 py-6 shadow-sm sm:px-7 sm:py-7">
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-primary">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              项目驾驶舱
              {isStale && <span className="text-amber-600">数据需要刷新</span>}
            </div>
            <h1 className="mt-2 truncate text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              {project.displayName}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              从项目状态、当前阶段到执行证据，快速了解现在发生了什么，以及下一步最值得做什么。
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 border px-3 py-1.5 text-xs font-medium ${systemHealthy
              ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300'
              : 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300'}`}>
              <CircleDot className="h-3.5 w-3.5" aria-hidden="true" />
              {phase}
            </span>
            <Button variant="outline" size="sm" onClick={onRefresh} disabled={isRefreshing}>
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
              刷新
            </Button>
          </div>
        </div>

        <div className="mt-7 grid gap-3 border-t border-border/60 pt-5 sm:grid-cols-4">
          <CockpitMetric label="全部任务" value={summary.totalTasks} />
          <CockpitMetric label="进行中" value={summary.activeTasks} tone="primary" />
          <CockpitMetric label="待处理" value={needsAttention} tone={needsAttention > 0 ? 'warning' : 'default'} />
          <CockpitMetric label="已完成" value={completed} tone="success" />
        </div>
      </section>

      <section className="border border-border/70 bg-background px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">研发进程</p>
            <h2 className="mt-1 text-base font-semibold">项目正在从哪里走向哪里</h2>
          </div>
          <span className="text-sm font-semibold tabular-nums text-primary">{completion}% 完成</span>
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-4">
          <CockpitPhase step="01" label="理解项目" detail="状态与上下文" done={summary.totalTasks > 0} />
          <CockpitPhase step="02" label="制定计划" detail="目标与工作单" done={summary.totalTasks > 0} active={phase === '可以继续规划'} />
          <CockpitPhase step="03" label="Agent 执行" detail={`${summary.activeTasks} 个进行中`} done={summary.activeTasks > 0 || completed > 0} active={summary.activeTasks > 0} />
          <CockpitPhase step="04" label="人工验收" detail={`${summary.awaitingAcceptance} 个待验收`} done={completed > 0} active={summary.awaitingAcceptance > 0} />
        </div>
        <div className="mt-4 h-1.5 overflow-hidden bg-muted">
          <div className="h-full bg-primary transition-all" style={{ width: `${completion}%` }} />
        </div>
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.85fr)]">
        <section className="border border-border/70 bg-background p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">下一步</p>
              <h2 className="mt-1 text-base font-semibold">需要你关注的事项</h2>
            </div>
            {needsAttention > 0 && <ShieldAlert className="h-5 w-5 text-amber-500" aria-hidden="true" />}
          </div>
          <div className="mt-4 divide-y border-y border-border/60">
            <CockpitAction
              icon={approvals.length > 0 ? ShieldAlert : CheckCircle2}
              title={approvals.length > 0 ? `${approvals.length} 项操作等待审批` : '当前没有待审批操作'}
              detail={approvals.length > 0 ? '检查工具调用和权限范围，确认后继续执行。' : '审批队列保持清空，可以继续推进项目。'}
              tone={approvals.length > 0 ? 'warning' : 'default'}
              onClick={() => onNavigate('tasks')}
            />
            <CockpitAction
              icon={summary.awaitingAcceptance > 0 ? ShieldAlert : CheckCircle2}
              title={summary.awaitingAcceptance > 0 ? `${summary.awaitingAcceptance} 个任务等待验收` : '暂无待验收任务'}
              detail="查看执行报告、测试证据和 Agent 声明，再决定通过或要求跟进。"
              tone={summary.awaitingAcceptance > 0 ? 'warning' : 'default'}
              onClick={() => onNavigate('tasks')}
            />
            <CockpitAction
              icon={summary.failedTasks + summary.lostTasks > 0 ? AlertTriangle : CheckCircle2}
              title={summary.failedTasks + summary.lostTasks > 0 ? `${summary.failedTasks + summary.lostTasks} 个任务需要复盘` : '没有失败或失联任务'}
              detail="失败、失联和中止任务会保留完整尝试历史，可从任务与验收继续处理。"
              tone={summary.failedTasks + summary.lostTasks > 0 ? 'danger' : 'default'}
              onClick={() => onNavigate('tasks')}
            />
          </div>
        </section>

        <section className="border border-border/70 bg-background p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">系统状态</p>
              <h2 className="mt-1 text-base font-semibold">项目运行环境</h2>
            </div>
            <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => onNavigate('knowledge')}>
              查看项目知识
            </button>
          </div>
          <div className="mt-4 space-y-3">
            <StatusRow label="控制面" value={dependencies.controlPlane.status === 'up' ? '正常' : dependencies.controlPlane.status === 'degraded' ? '降级' : '不可用'} good={dependencies.controlPlane.status === 'up'} />
            <StatusRow label="运行事件" value={dependencies.runtimeDelivery.status === 'up' ? '正常' : dependencies.runtimeDelivery.status === 'misconfigured' ? '未配置' : '有延迟'} good={dependencies.runtimeDelivery.status === 'up'} />
            <StatusRow label="实时活动" value={subscription.status === 'LIVE' ? '实时连接' : subscription.status === 'FALLBACK' ? '轮询模式' : '正在连接'} good={subscription.status === 'LIVE'} />
          </div>
          {(metricsError || requestError || warnings.length > 0) && (
            <div className="mt-4 border-t border-border/60 pt-3 text-xs leading-5 text-amber-700 dark:text-amber-300">
              {metricsError ?? requestError ?? warnings[0]?.message}
            </div>
          )}
        </section>
      </div>

      <section className="border border-border/70 bg-background p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">最近活动</p>
            <h2 className="mt-1 text-base font-semibold">项目正在发生什么</h2>
          </div>
          <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline" onClick={() => onNavigate('tasks')}>
            打开完整任务记录 <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ActivityCard label="最近产物" value={recentArtifacts.length} detail="文件变更、测试报告和摘要" />
          <ActivityCard label="最近任务" value={tasks.length} detail="当前返回的任务记录" />
          <ActivityCard label="运行事件" value={metrics?.activity.eventCount ?? 0} detail="最近窗口内的活动数量" />
          <ActivityCard label="实时游标" value={metrics?.activity.latestCursor ?? 0} detail="可用于事件回放的位置" />
        </div>
      </section>
    </div>
  );
}

function CockpitMetric({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'primary' | 'warning' | 'success' }) {
  const color = tone === 'warning' ? 'text-amber-600' : tone === 'success' ? 'text-emerald-600' : tone === 'primary' ? 'text-primary' : 'text-foreground';
  return <div className="border-l-2 border-border/70 pl-3"><div className="text-xs text-muted-foreground">{label}</div><div className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</div></div>;
}

function CockpitPhase({ step, label, detail, done, active = false }: { step: string; label: string; detail: string; done: boolean; active?: boolean }) {
  return <div className={`border p-3 ${active ? 'border-primary/50 bg-primary/5' : 'border-border/60 bg-muted/10'}`}><div className="flex items-center justify-between"><span className="text-[10px] font-semibold tracking-[0.15em] text-muted-foreground">{step}</span>{done && <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden="true" />}</div><div className="mt-3 text-sm font-medium">{label}</div><div className="mt-1 text-xs text-muted-foreground">{detail}</div></div>;
}

function CockpitAction({ icon: Icon, title, detail, tone, onClick }: { icon: typeof CheckCircle2; title: string; detail: string; tone: 'default' | 'warning' | 'danger'; onClick(): void }) {
  const color = tone === 'danger' ? 'text-red-500' : tone === 'warning' ? 'text-amber-500' : 'text-emerald-500';
  return <button type="button" className="flex w-full items-start gap-3 py-4 text-left transition-colors hover:bg-muted/30" onClick={onClick}><Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} aria-hidden="true" /><span className="min-w-0"><span className="block text-sm font-medium">{title}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{detail}</span></span><ArrowRight className="ml-auto mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /></button>;
}

function StatusRow({ label, value, good }: { label: string; value: string; good: boolean }) {
  return <div className="flex items-center justify-between border-b border-border/50 pb-2 text-sm last:border-0 last:pb-0"><span className="text-muted-foreground">{label}</span><span className={`inline-flex items-center gap-1.5 font-medium ${good ? 'text-emerald-600' : 'text-amber-600'}`}><span className={`h-1.5 w-1.5 rounded-full ${good ? 'bg-emerald-500' : 'bg-amber-500'}`} />{value}</span></div>;
}

function ActivityCard({ label, value, detail }: { label: string; value: number; detail: string }) {
  return <div className="border border-border/60 bg-muted/10 p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-2 text-xl font-semibold tabular-nums">{value}</div><div className="mt-1 text-[11px] leading-4 text-muted-foreground">{detail}</div></div>;
}
