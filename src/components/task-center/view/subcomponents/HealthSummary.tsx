import { Activity, CircleAlert, CircleCheck, Shield } from 'lucide-react';

import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../../shared/view/ui';
import type {
  ProjectActivitySubscriptionState,
  ProjectMetrics,
  TaskCenterDashboard,
} from '../../model/taskCenterModel';
import { approvalModeLabel } from '../taskCenterLabels';

type HealthSummaryProps = {
  dashboard: TaskCenterDashboard;
  metrics: ProjectMetrics | null;
  metricsError: string | null;
  subscription: ProjectActivitySubscriptionState;
};

function healthPresentation(status: string) {
  if (status === 'up') return { label: '正常', icon: CircleCheck, className: 'text-emerald-600' };
  if (status === 'degraded') return { label: '降级', icon: CircleAlert, className: 'text-amber-600' };
  if (status === 'misconfigured') return { label: '未配置', icon: CircleAlert, className: 'text-red-600' };
  return { label: '不可用', icon: CircleAlert, className: 'text-red-600' };
}

function subscriptionPresentation(status: ProjectActivitySubscriptionState['status']) {
  if (status === 'LIVE') return { label: '已连接', className: 'text-emerald-600' };
  if (status === 'CONNECTING') return { label: '连接中', className: 'text-amber-600' };
  if (status === 'RECONNECTING') return { label: '重连中', className: 'text-amber-600' };
  return { label: '轮询兜底', className: 'text-red-600' };
}

function integer(value: number) {
  return value.toLocaleString('zh-CN');
}

function duration(value: number) {
  return value > 0 ? `${integer(value)} ms` : '暂无';
}

export function HealthSummary({ dashboard, metrics, metricsError, subscription }: HealthSummaryProps) {
  const control = healthPresentation(dashboard.dependencies.controlPlane.status);
  const runtime = healthPresentation(dashboard.dependencies.runtimeDelivery.status);
  const subscriptionState = subscriptionPresentation(subscription.status);
  const ControlIcon = control.icon;
  const RuntimeIcon = runtime.icon;
  const unknownAttempts = dashboard.tasks.filter((task) => task.runtimeHealthStatus === 'UNKNOWN').length;
  const lostAttempts = dashboard.tasks.filter((task) => task.runtimeHealthStatus === 'LOST').length;

  return (
    <Card className="rounded-none">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" aria-hidden="true" />
          <CardTitle className="text-base">执行链路健康</CardTitle>
        </div>
        <CardDescription>任务服务、运行事件和项目策略的当前状态。</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="text-xs text-muted-foreground">暂时失联的执行</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{unknownAttempts}</div>
          </div>
          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3">
            <div className="text-xs text-muted-foreground">已失联的执行</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{lostAttempts}</div>
          </div>
        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <div className="text-sm font-medium">控制平面</div>
            <div className="text-xs text-muted-foreground">任务事实与审批策略</div>
          </div>
          <Badge variant="outline" className={control.className}>
            <ControlIcon className="mr-1.5 h-3.5 w-3.5" />{control.label}
          </Badge>
        </div>
        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <div className="text-sm font-medium">运行事件投递</div>
            <div className="text-xs text-muted-foreground">
              待投递 {dashboard.dependencies.runtimeDelivery.pendingEvents} 条
            </div>
          </div>
          <Badge variant="outline" className={runtime.className}>
            <RuntimeIcon className="mr-1.5 h-3.5 w-3.5" />{runtime.label}
          </Badge>
        </div>
        <div className="rounded-md border bg-muted/20 p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Shield className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            项目审批策略
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">{approvalModeLabel(dashboard.approvalPolicy?.mode ?? null)}</Badge>
            {dashboard.approvalPolicy && (
              <>
                <span>{dashboard.approvalPolicy.allowedDirectories.length} 个允许目录</span>
                <span>·</span>
                <span>{dashboard.approvalPolicy.approvalTimeoutSeconds} 秒超时</span>
              </>
            )}
          </div>
        </div>
        <div className="rounded-md border bg-muted/20 p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-medium">项目变化订阅</div>
              <div className="text-xs text-muted-foreground">
                游标 {subscription.lastCursor ?? metrics?.activity.latestCursor ?? 0}
              </div>
            </div>
            <Badge variant="outline" className={subscriptionState.className}>{subscriptionState.label}</Badge>
          </div>
          {subscription.error && <p className="mt-2 text-xs text-destructive">{subscription.error}</p>}
        </div>
        <div className="rounded-md border p-3 sm:col-span-2">
          <div className="text-sm font-medium">近 {metrics ? Math.round(metrics.windowHours / 24) : 7} 天运行指标</div>
          {metricsError && <p className="mt-2 text-xs text-destructive">{metricsError}</p>}
          {metrics ? (
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <div><span className="text-muted-foreground">执行次数</span><div className="mt-1 font-medium">{integer(metrics.attempts.total)}</div></div>
              <div><span className="text-muted-foreground">失败率</span><div className="mt-1 font-medium">{(metrics.attempts.failureRate * 100).toFixed(1)}%</div></div>
              <div><span className="text-muted-foreground">P95 时延</span><div className="mt-1 font-medium">{duration(metrics.attempts.p95DurationMs)}</div></div>
              <div><span className="text-muted-foreground">大脑用量</span><div className="mt-1 font-medium">{integer(metrics.tokens.totalTokens)} Token</div></div>
            </div>
          ) : !metricsError ? <p className="mt-2 text-xs text-muted-foreground">指标读取中…</p> : null}
        </div>
        </div>
      </CardContent>
    </Card>
  );
}
