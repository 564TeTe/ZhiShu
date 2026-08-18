import {
  AlertTriangle,
  CircleDashed,
  Cpu,
  Loader2,
  ShieldCheck,
  ShieldX,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { Badge } from '../../../../shared/view/ui';
import { fetchSchedulerCapabilityMatrix } from '../../api/taskCenterApi';
import { useReadOnlyPollingResource } from '../../hooks/useReadOnlyPollingResource';
import type {
  SchedulerCapabilityMatrixView,
  SchedulerCapabilityNodeView,
  SchedulerCapabilityProfileMatchView,
  SchedulerCapabilityProfileView,
} from '../../model/taskCenterModel';
import { capabilityLabel, planNodeStateLabel, schedulerBlockerLabel } from '../taskCenterLabels';

const NODE_FILTERS = ['ALL', 'SCHEDULABLE', 'BLOCKED'] as const;

function formatDate(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : value;
}

function StringList({ values, emptyLabel = '暂无记录' }: { values: string[]; emptyLabel?: string }) {
  if (values.length === 0) return <span className="text-muted-foreground">{emptyLabel}</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {values.map((value) => <Badge key={value} variant="outline" className="text-[10px]">{value}</Badge>)}
    </div>
  );
}

function ProfileCatalog({ profiles }: { profiles: SchedulerCapabilityProfileView[] }) {
  if (profiles.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        <CircleDashed className="h-4 w-4" aria-hidden="true" />尚未配置执行代理
      </div>
    );
  }
  return (
    <div className="grid gap-2 lg:grid-cols-2">
      {profiles.map((profile) => (
        <div key={profile.profileId} className="rounded-md border bg-background/50 p-3 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium">{profile.profileName}</span>
            <Badge variant={profile.enabled ? 'secondary' : 'outline'}>
              {profile.enabled ? '已启用' : '已停用'}
            </Badge>
            <Badge variant="outline">{profile.executor}</Badge>
          </div>
          <div className="mt-2"><StringList values={profile.capabilities.map(capabilityLabel)} emptyLabel="未声明能力" /></div>
        </div>
      ))}
    </div>
  );
}

function ProfileMatch({ match }: { match: SchedulerCapabilityProfileMatchView }) {
  return (
    <div className="rounded-md border bg-background/60 p-2.5 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium">{match.profileName}</span>
        <Badge variant={match.eligible ? 'secondary' : 'outline'}>
          {match.eligible ? '可用' : '不可用'}
        </Badge>
        <Badge variant="outline">{match.executor}</Badge>
        {!match.enabled && <Badge variant="outline">已停用</Badge>}
      </div>
      <dl className="mt-2 grid gap-x-3 gap-y-1 sm:grid-cols-[auto_minmax(0,1fr)]">
        <dt className="text-muted-foreground">已有能力</dt>
        <dd><StringList values={match.capabilities.map(capabilityLabel)} emptyLabel="无" /></dd>
        <dt className="text-muted-foreground">缺少能力</dt>
        <dd><StringList values={match.missingCapabilities.map(capabilityLabel)} emptyLabel="无" /></dd>
      </dl>
    </div>
  );
}

function NodeRecord({ node }: { node: SchedulerCapabilityNodeView }) {
  return (
    <details className="rounded-md border bg-background/40" open={!node.schedulable}>
      <summary className="cursor-pointer list-none p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 text-xs font-medium">
            {node.schedulable
              ? <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              : <ShieldX className="h-3.5 w-3.5" aria-hidden="true" />}
            <span>{node.title}</span>
            <Badge variant={node.schedulable ? 'secondary' : 'destructive'}>
              {node.schedulable ? '可调度' : '被阻塞'}
            </Badge>
            <Badge variant="outline">{planNodeStateLabel(node.executionState)}</Badge>
          </div>
          <span className="text-[10px] text-muted-foreground">{node.nodeKey}</span>
        </div>
      </summary>
      <div className="space-y-3 border-t px-3 pb-3 pt-3">
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline">可用配置 {node.eligibleProfileCount}</Badge>
          <Badge variant={node.executable ? 'outline' : 'destructive'}>
            {node.executable ? '允许执行' : '不能执行'}
          </Badge>
          {node.activeSchedule && <Badge variant="outline">已有活动调度</Badge>}
        </div>
        <dl className="grid gap-x-3 gap-y-2 text-xs sm:grid-cols-[auto_minmax(0,1fr)]">
          <dt className="text-muted-foreground">工作范围</dt>
          <dd><StringList values={node.scope} emptyLabel="未明确工作范围" /></dd>
          <dt className="text-muted-foreground">所需能力</dt>
          <dd><StringList values={node.requiredCapabilities.map(capabilityLabel)} /></dd>
          <dt className="text-muted-foreground">阻塞原因</dt>
          <dd>
            {node.blockers.length === 0 ? (
              <span className="text-muted-foreground">无</span>
            ) : (
              <div className="flex flex-wrap gap-1">
                {node.blockers.map((blocker) => <Badge key={blocker} variant="destructive">{schedulerBlockerLabel(blocker)}</Badge>)}
              </div>
            )}
          </dd>
        </dl>
        <section>
          <h5 className="mb-2 text-xs font-semibold">执行配置匹配</h5>
          {node.profileMatches.length === 0 ? (
            <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              尚无匹配记录
            </div>
          ) : (
            <div className="space-y-2">
              {node.profileMatches.map((match) => <ProfileMatch key={match.profileId} match={match} />)}
            </div>
          )}
        </section>
      </div>
    </details>
  );
}

export function WorkerCapabilityMatrix({
  projectId,
  planId,
  currentPlanVersionId,
  currentPlanVersionNumber,
  planBaseStateRevision,
  refreshToken = 0,
}: {
  projectId: string;
  planId: string;
  currentPlanVersionId: string;
  currentPlanVersionNumber: number;
  planBaseStateRevision: number;
  refreshToken?: number;
}) {
  const [nodeFilter, setNodeFilter] = useState<(typeof NODE_FILTERS)[number]>('ALL');
  const load = useCallback(
    (signal: AbortSignal) => fetchSchedulerCapabilityMatrix(projectId, planId, signal),
    [planId, projectId],
  );
  const { data: matrix, error, isLoading } = useReadOnlyPollingResource<SchedulerCapabilityMatrixView>({
    scopeKey: `${projectId}:${planId}`,
    load,
    refreshToken,
  });

  const visibleNodes = useMemo(() => matrix?.nodes.filter((node) => (
    nodeFilter === 'ALL'
      || (nodeFilter === 'SCHEDULABLE' && node.schedulable)
      || (nodeFilter === 'BLOCKED' && !node.schedulable)
  )) ?? [], [matrix, nodeFilter]);

  const currentBaseline = matrix !== null
    && matrix.planVersionId === currentPlanVersionId
    && matrix.basePlanVersion === currentPlanVersionNumber
    && matrix.baseStateRevision === planBaseStateRevision;

  return (
    <section className="mt-4 border-t pt-4" aria-label="执行能力检查">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Cpu className="h-4 w-4 text-primary" aria-hidden="true" />
          执行能力检查
          <Badge variant="outline">只读</Badge>
        </div>
        <select
          value={nodeFilter}
          onChange={(event) => setNodeFilter(event.target.value as (typeof NODE_FILTERS)[number])}
          className="h-8 rounded-md border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
          aria-label="筛选计划节点"
        >
          {NODE_FILTERS.map((filter) => (
            <option key={filter} value={filter}>{filter === 'ALL' ? '全部节点' : filter === 'SCHEDULABLE' ? '可调度' : '被阻塞'}</option>
          ))}
        </select>
      </div>

      {error && (
        <div
          className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {isLoading && matrix === null ? (
        <div className="mt-3 flex items-center gap-2 py-3 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />正在检查执行能力
        </div>
      ) : error && matrix === null ? null : matrix === null ? (
        <div className="mt-3 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          暂时无法读取执行能力检查结果
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="secondary">可调度 {matrix.summary.schedulableNodeCount}</Badge>
            <Badge variant="outline">被阻塞 {matrix.summary.blockedNodeCount}</Badge>
            <Badge variant="outline">已启用配置 {matrix.summary.enabledProfileCount}</Badge>
            <Badge variant="outline">最大并行数 {matrix.maxWorkers}</Badge>
            <Badge variant={currentBaseline ? 'secondary' : 'destructive'}>
              {currentBaseline ? '基线一致' : '基线已变化'}
            </Badge>
            <Badge variant="outline">生成于 {formatDate(matrix.generatedAt)}</Badge>
          </div>

          <section className="rounded-md bg-muted/30 p-3">
            <h5 className="mb-2 text-xs font-semibold">执行代理配置</h5>
            <ProfileCatalog profiles={matrix.profiles} />
          </section>

          <section>
            <h5 className="mb-2 text-xs font-semibold">计划节点</h5>
            {visibleNodes.length === 0 ? (
              <div className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                {matrix.nodes.length === 0 ? '尚无计划节点' : '没有符合筛选条件的节点'}
              </div>
            ) : (
              <div className="space-y-2">
                {visibleNodes.map((node) => <NodeRecord key={node.nodeKey} node={node} />)}
              </div>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
