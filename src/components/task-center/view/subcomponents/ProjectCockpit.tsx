import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDot,
  FileClock,
  RefreshCw,
  ShieldAlert,
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
  const failedCount = summary.failedTasks + summary.lostTasks;
  const waitingApprovalCount = Math.max(summary.waitingApproval, approvals.length);
  const needsAttention = waitingApprovalCount + summary.awaitingAcceptance + failedCount;
  const completed = summary.succeededTasks;
  const completion = summary.totalTasks > 0
    ? Math.min(100, Math.round((completed / summary.totalTasks) * 100))
    : 0;
  const systemHealthy = dependencies.controlPlane.status === 'up'
    && dependencies.runtimeDelivery.status === 'up';

  const nextAction = waitingApprovalCount > 0
    ? {
        eyebrow: '等待你的决定',
        title: `${waitingApprovalCount} 项操作需要确认`,
        detail: '检查 Agent 准备执行的操作，允许或拒绝后任务才会继续。',
        label: '去处理审批',
        section: 'tasks' as const,
      }
    : summary.awaitingAcceptance > 0
      ? {
          eyebrow: '等待你的验收',
          title: `${summary.awaitingAcceptance} 个任务已经完成执行`,
          detail: '查看改动、测试结果和执行说明，然后确认通过或要求继续修改。',
          label: '查看并验收',
          section: 'tasks' as const,
        }
      : summary.activeTasks > 0
        ? {
            eyebrow: 'Agent 正在工作',
            title: `${summary.activeTasks} 个任务正在执行`,
            detail: '可以查看实时状态和过程记录，不需要重复创建任务。',
            label: '查看执行进度',
            section: 'tasks' as const,
          }
        : {
            eyebrow: summary.totalTasks === 0 ? '从这里开始' : '可以继续推进',
            title: summary.totalTasks === 0 ? '告诉知枢你想完成什么' : '创建下一个任务',
            detail: '描述目标后，知枢会先整理执行步骤；只有你确认后才会开始执行。',
            label: summary.totalTasks === 0 ? '新建第一个任务' : '新建任务',
            section: 'plan' as const,
          };

  const currentStep = summary.totalTasks === 0
    ? 0
    : waitingApprovalCount > 0
      ? 1
      : summary.activeTasks > 0
        ? 2
        : summary.awaitingAcceptance > 0 || failedCount > 0
          ? 3
          : completed >= summary.totalTasks
            ? 4
            : 1;

  return (
    <div className="space-y-4">
      <section className="border border-border/60 bg-card shadow-sm">
        <div className="flex flex-col gap-6 px-5 py-6 sm:px-7 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="text-xs font-medium text-muted-foreground">任务中心</div>
            <h1 className="mt-1 truncate text-xl font-semibold text-foreground sm:text-2xl">{project.displayName}</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 border px-2.5 py-1 text-xs font-medium ${systemHealthy
              ? 'border-emerald-500/25 text-emerald-600'
              : 'border-amber-500/30 text-amber-600'}`}>
              <CircleDot className="h-3.5 w-3.5" aria-hidden="true" />
              {systemHealthy ? '运行正常' : '部分服务异常'}
            </span>
            <Button variant="ghost" size="icon" onClick={onRefresh} disabled={isRefreshing} title="刷新" aria-label="刷新任务中心">
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
            </Button>
          </div>
        </div>

        <div className="border-t border-border/60 px-5 py-7 sm:px-7">
          <p className="text-xs font-semibold text-primary">{nextAction.eyebrow}</p>
          <div className="mt-2 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <h2 className="text-xl font-semibold text-foreground sm:text-2xl">{nextAction.title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{nextAction.detail}</p>
            </div>
            <Button className="shrink-0" onClick={() => onNavigate(nextAction.section)}>
              {nextAction.label}<ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
          {(isStale || requestError) && (
            <p className="mt-3 text-xs text-amber-600">{requestError ?? '数据可能不是最新状态，请刷新后再操作。'}</p>
          )}
        </div>
      </section>

      <section className="border border-border/60 bg-card px-5 py-5 shadow-sm sm:px-7">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">一个任务的完整流程</h2>
            <p className="mt-1 text-xs text-muted-foreground">按顺序完成，不需要理解内部系统名词。</p>
          </div>
          <span className="text-sm font-semibold tabular-nums text-primary">{completion}%</span>
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-4">
          <FlowStep number="1" label="描述目标" detail="说清楚要完成什么" state={stepState(0, currentStep)} onClick={() => onNavigate('plan')} />
          <FlowStep number="2" label="确认步骤" detail="检查知枢整理的方案" state={stepState(1, currentStep)} onClick={() => onNavigate('plan')} />
          <FlowStep number="3" label="Agent 执行" detail={`${summary.activeTasks} 个正在执行`} state={stepState(2, currentStep)} onClick={() => onNavigate('tasks')} />
          <FlowStep number="4" label="验收结果" detail={`${summary.awaitingAcceptance} 个等待验收`} state={stepState(3, currentStep)} onClick={() => onNavigate('tasks')} />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.75fr)]">
        <section className="border border-border/60 bg-card p-5 shadow-sm sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">需要你处理</h2>
            {needsAttention > 0 && <span className="text-xs font-medium text-amber-600">{needsAttention} 项</span>}
          </div>
          {needsAttention === 0 ? (
            <div className="mt-4 flex items-center gap-3 border-t border-border/60 py-5">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" aria-hidden="true" />
              <div className="min-w-0">
                <div className="text-sm font-medium">当前没有需要你处理的事项</div>
                <div className="mt-1 text-xs text-muted-foreground">可以新建任务，或等待正在执行的任务完成。</div>
              </div>
            </div>
          ) : (
            <div className="mt-3 divide-y border-y border-border/60">
              {waitingApprovalCount > 0 && (
                <AttentionRow icon={ShieldAlert} title={`${waitingApprovalCount} 项操作等待确认`} onClick={() => onNavigate('tasks')} />
              )}
              {summary.awaitingAcceptance > 0 && (
                <AttentionRow icon={CheckCircle2} title={`${summary.awaitingAcceptance} 个结果等待验收`} onClick={() => onNavigate('tasks')} />
              )}
              {failedCount > 0 && (
                <AttentionRow icon={AlertTriangle} title={`${failedCount} 个任务执行异常`} onClick={() => onNavigate('tasks')} danger />
              )}
            </div>
          )}
        </section>

        <section className="border border-border/60 bg-card p-5 shadow-sm sm:p-6">
          <h2 className="text-sm font-semibold">任务概况</h2>
          <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-4">
            <Metric label="全部" value={summary.totalTasks} />
            <Metric label="执行中" value={summary.activeTasks} tone="primary" />
            <Metric label="待验收" value={summary.awaitingAcceptance} tone="warning" />
            <Metric label="已完成" value={completed} tone="success" />
          </div>
        </section>
      </div>

      <section className="border border-border/60 bg-card px-5 py-4 shadow-sm sm:px-6">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-2"><FileClock className="h-4 w-4" />最近任务 {tasks.length}</span>
          <span>最近产物 {recentArtifacts.length}</span>
          <span>运行事件 {metrics?.activity.eventCount ?? 0}</span>
          <span className={subscription.status === 'LIVE' ? 'text-emerald-600' : 'text-amber-600'}>
            {subscription.status === 'LIVE' ? '实时连接' : subscription.status === 'FALLBACK' ? '轮询更新' : '正在连接'}
          </span>
          {(metricsError || warnings.length > 0) && (
            <span className="text-amber-600">{metricsError ?? warnings[0]?.message}</span>
          )}
          <button type="button" className="ml-auto font-medium text-primary hover:underline" onClick={() => onNavigate('knowledge')}>
            查看项目资料
          </button>
        </div>
      </section>
    </div>
  );
}

function stepState(index: number, current: number): 'done' | 'active' | 'upcoming' {
  if (index < current) return 'done';
  if (index === current) return 'active';
  return 'upcoming';
}

function FlowStep({ number, label, detail, state, onClick }: { number: string; label: string; detail: string; state: 'done' | 'active' | 'upcoming'; onClick(): void }) {
  return (
    <button type="button" onClick={onClick} className={`flex min-h-20 items-start gap-3 border p-3 text-left transition-colors hover:border-primary/40 ${state === 'active' ? 'border-primary/50 bg-primary/5' : 'border-border/60'}`}>
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center text-xs font-semibold ${state === 'done' ? 'bg-emerald-500 text-white' : state === 'active' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
        {state === 'done' ? <CheckCircle2 className="h-4 w-4" /> : number}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="mt-1 block text-xs leading-4 text-muted-foreground">{detail}</span>
      </span>
    </button>
  );
}

function AttentionRow({ icon: Icon, title, danger = false, onClick }: { icon: typeof ShieldAlert; title: string; danger?: boolean; onClick(): void }) {
  return (
    <button type="button" className="flex w-full items-center gap-3 py-4 text-left hover:bg-muted/20" onClick={onClick}>
      <Icon className={`h-4 w-4 shrink-0 ${danger ? 'text-red-500' : 'text-amber-500'}`} aria-hidden="true" />
      <span className="text-sm font-medium">{title}</span>
      <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground" aria-hidden="true" />
    </button>
  );
}

function Metric({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'primary' | 'warning' | 'success' }) {
  const color = tone === 'warning' ? 'text-amber-600' : tone === 'success' ? 'text-emerald-600' : tone === 'primary' ? 'text-primary' : 'text-foreground';
  return <div><div className="text-xs text-muted-foreground">{label}</div><div className={`mt-1 text-xl font-semibold tabular-nums ${color}`}>{value}</div></div>;
}
