import {
  AlertTriangle,
  BookOpen,
  GitBranch,
  LayoutDashboard,
  ListChecks,
  ListTodo,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { useCallback, useState } from 'react';

import type { Project } from '../../../types/app';
import { Button, Card, CardContent, ScrollArea } from '../../../shared/view/ui';
import { useTaskCenterDashboard } from '../hooks/useTaskCenterDashboard';
import { useTaskHistory, type TaskHistoryFilters } from '../hooks/useTaskHistory';
import { useTaskExecutionDetail } from '../hooks/useTaskExecutionDetail';
import { useProjectActivitySubscription } from '../hooks/useProjectActivitySubscription';
import { useProjectMetrics } from '../hooks/useProjectMetrics';

import { ExecutionList } from './subcomponents/ExecutionList';
import { TaskExecutionDetail } from './subcomponents/TaskExecutionDetail';
import { ProjectStatePanel } from './subcomponents/ProjectStatePanel';
import { ProjectBrainPanel } from './subcomponents/ProjectBrainPanel';
import { PlanCenterPanel } from './subcomponents/PlanCenterPanel';
import { ProjectRegistrationPanel } from './subcomponents/ProjectRegistrationPanel';
import { ProjectCockpit } from './subcomponents/ProjectCockpit';

type TaskCenterProps = {
  project: Project;
};

type TaskCenterSection = 'cockpit' | 'overview' | 'tasks' | 'plan' | 'knowledge' | 'advanced';

const cockpitSections = [
  { id: 'cockpit', label: '项目驾驶舱', icon: LayoutDashboard },
  { id: 'plan', label: '工作流', icon: ListChecks },
  { id: 'knowledge', label: '项目知识', icon: BookOpen },
  { id: 'tasks', label: '任务与验收', icon: ListTodo },
  { id: 'advanced', label: '高级集成', icon: GitBranch, sensitive: true },
] satisfies Array<{
  id: TaskCenterSection;
  label: string;
  icon: typeof LayoutDashboard;
  sensitive?: boolean;
}>;

export default function TaskCenter({ project }: TaskCenterProps) {
  const dashboardState = useTaskCenterDashboard(project.projectId);
  const {
    dashboard,
    error,
    isLoading,
    refresh,
  } = dashboardState;

  if (isLoading && !dashboard) {
    return (
      <div className="flex h-full items-center justify-center bg-muted/10 p-6">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
          正在读取项目执行事实…
        </div>
      </div>
    );
  }

  if (!dashboard) {
    return (
      <div className="flex h-full items-center justify-center bg-muted/10 p-4">
        <Card className="w-full max-w-lg border-destructive/30">
          <CardContent className="flex flex-col items-center px-6 py-10 text-center">
            <AlertTriangle className="h-8 w-8 text-destructive" aria-hidden="true" />
            <div className="mt-4 text-base font-semibold">只读驾驶台暂时无法加载</div>
            <p className="mt-2 text-sm text-muted-foreground">{error ?? '未知读取错误'}</p>
            <Button variant="outline" className="mt-5" onClick={refresh}>
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />重新读取
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (dashboard.availability === 'unavailable') {
    return (
      <ProjectRegistrationPanel
        project={project}
        dashboard={dashboard}
        onRegistered={refresh}
        onRetry={refresh}
      />
    );
  }

  return (
    <RegisteredTaskCenter
      key={project.projectId}
      project={project}
      dashboardState={dashboardState}
    />
  );
}

function RegisteredTaskCenter({
  project,
  dashboardState,
}: {
  project: Project;
  dashboardState: ReturnType<typeof useTaskCenterDashboard>;
}) {
  const [activeSection, setActiveSection] = useState<TaskCenterSection>('cockpit');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [historyFilters, setHistoryFilters] = useState<TaskHistoryFilters>({
    archive: 'ACTIVE', status: null, resolutionStatus: null, search: '',
  });
  const [searchDraft, setSearchDraft] = useState('');
  const {
    dashboard,
    error,
    isRefreshing,
    isStale,
    refresh,
  } = dashboardState;
  const history = useTaskHistory(project.projectId, historyFilters);
  const historyTasks = history.page?.items ?? [];
  const effectiveSelectedTaskId = selectedTaskId && historyTasks.some((task) => task.taskId === selectedTaskId)
    ? selectedTaskId
    : historyTasks[0]?.taskId ?? null;
  const taskDetail = useTaskExecutionDetail(project.projectId, effectiveSelectedTaskId);
  const refreshHistory = history.refresh;
  const refreshTaskDetail = taskDetail.refresh;
  const [projectRefreshToken, setProjectRefreshToken] = useState(0);
  const refreshAll = useCallback(() => {
    refresh();
    refreshHistory();
    refreshTaskDetail();
    setProjectRefreshToken((value) => value + 1);
  }, [refresh, refreshHistory, refreshTaskDetail]);
  const subscription = useProjectActivitySubscription(
    project.projectId,
    useCallback(() => {
      refreshAll();
    }, [refreshAll]),
  );
  const metrics = useProjectMetrics(project.projectId, projectRefreshToken);

  if (!dashboard) return null;

  return (
    <div className="task-center-surface h-full overflow-hidden bg-muted/10">
      <ScrollArea className="h-full">
        <div className="mx-auto w-full max-w-[1600px] p-3 lg:p-5">
          <TaskCenterSectionNav activeSection={activeSection} onChange={setActiveSection} />

          <div className="mt-3">
            {activeSection === 'cockpit' && (
              <div className="space-y-3">
                <ProjectCockpit
                  dashboard={dashboard}
                  metrics={metrics.metrics}
                  metricsError={metrics.error}
                  subscription={subscription}
                  requestError={error}
                  isRefreshing={isRefreshing}
                  isStale={isStale}
                  onRefresh={refreshAll}
                  onNavigate={setActiveSection}
                />
              </div>
            )}

            {activeSection === 'tasks' && (
              <div className={effectiveSelectedTaskId
                ? 'grid items-start gap-3 xl:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.35fr)]'
                : 'block'}>
                <ExecutionList
                  tasks={historyTasks}
                  selectedTaskId={effectiveSelectedTaskId}
                  onSelectTask={setSelectedTaskId}
                  archive={historyFilters.archive}
                  onArchiveChange={(archive) => setHistoryFilters((current) => ({ ...current, archive }))}
                  status={historyFilters.status}
                  onStatusChange={(status) => setHistoryFilters((current) => ({ ...current, status }))}
                  resolutionStatus={historyFilters.resolutionStatus}
                  onResolutionStatusChange={(resolutionStatus) => setHistoryFilters((current) => ({ ...current, resolutionStatus }))}
                  search={searchDraft}
                  onSearchChange={setSearchDraft}
                  onSearch={() => setHistoryFilters((current) => ({ ...current, search: searchDraft.trim() }))}
                  isLoading={history.isLoading}
                  isLoadingMore={history.isLoadingMore}
                  hasMore={history.page?.hasMore ?? false}
                  error={history.error}
                  onRefresh={history.refresh}
                  onLoadMore={() => void history.loadMore()}
                />
                {effectiveSelectedTaskId ? (
                  <TaskExecutionDetail
                    detail={taskDetail.detail}
                    error={taskDetail.error}
                    isLoading={taskDetail.isLoading}
                    isRefreshing={taskDetail.isRefreshing}
                    activeCommand={taskDetail.activeCommand}
                    onRefresh={taskDetail.refresh}
                    onCancel={async () => {
                      await taskDetail.cancel();
                      refreshAll();
                    }}
                    onRetry={async () => {
                      await taskDetail.retry();
                      refreshAll();
                    }}
                    onFollowUp={async (parentAttemptId, feedback, requestedAcceptance) => {
                      await taskDetail.followUp(parentAttemptId, feedback, requestedAcceptance);
                      refreshAll();
                    }}
                    onAccept={async (attemptId, decision, reason) => {
                      await taskDetail.accept(attemptId, decision, reason);
                      refreshAll();
                    }}
                    onApprovalDecision={async (approvalId, decision) => {
                      await taskDetail.decideApproval(approvalId, decision);
                      refreshAll();
                    }}
                    onArchive={async (reason) => {
                      await taskDetail.archive(reason);
                      refreshAll();
                    }}
                  />
                ) : null}
              </div>
            )}

            {activeSection === 'plan' && (
              <PlanCenterPanel
                mode="plan"
                projectId={project.projectId}
                refreshToken={projectRefreshToken}
                onExecutionChanged={refreshAll}
              />
            )}

            {activeSection === 'knowledge' && (
              <div className="grid items-start gap-3 xl:grid-cols-2">
                <ProjectStatePanel projectId={project.projectId} refreshToken={projectRefreshToken} />
                <ProjectBrainPanel projectId={project.projectId} refreshToken={projectRefreshToken} />
              </div>
            )}

            {activeSection === 'advanced' && (
              <PlanCenterPanel
                mode="advanced"
                projectId={project.projectId}
                refreshToken={projectRefreshToken}
                onExecutionChanged={refreshAll}
              />
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

function TaskCenterSectionNav({
  activeSection,
  onChange,
}: {
  activeSection: TaskCenterSection;
  onChange(section: TaskCenterSection): void;
}) {
  return (
    <nav
      className="sticky top-0 z-20 -mx-1 overflow-x-auto border-b bg-background/95 px-1 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/85"
      aria-label="任务中心功能导航"
    >
      <div className="flex min-w-max gap-1" role="tablist" aria-label="任务中心视图">
        {cockpitSections.map((section) => {
          const Icon = section.icon;
          const selected = section.id === activeSection;
          return (
            <button
              key={section.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onChange(section.id)}
              className={`flex h-10 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                selected
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{section.label}</span>
              {section.sensitive && (
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-label="包含高风险操作" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
