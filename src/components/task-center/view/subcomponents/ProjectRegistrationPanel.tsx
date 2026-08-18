import { AlertTriangle, Link2, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

import type { Project } from '../../../../types/app';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '../../../../shared/view/ui';
import {
  confirmTaskCenterWorkspaceBinding,
  registerTaskCenterProject,
} from '../../api/taskCenterApi';
import type { TaskCenterDashboard } from '../../model/taskCenterModel';

type ProjectRegistrationPanelProps = {
  project: Project;
  dashboard: TaskCenterDashboard;
  onRegistered(): void;
  onRetry(): void;
};

export function ProjectRegistrationPanel({
  project,
  dashboard,
  onRegistered,
  onRetry,
}: ProjectRegistrationPanelProps) {
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isUnregistered = dashboard.unavailableReason === 'PROJECT_NOT_REGISTERED';

  const register = async () => {
    setIsRegistering(true);
    setError(null);
    try {
      const identity = await registerTaskCenterProject(project.projectId);
      if (identity.resolution === 'PROPOSAL_REQUIRED') {
        await confirmTaskCenterWorkspaceBinding(project.projectId, identity);
      }
      onRegistered();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setIsRegistering(false);
    }
  };

  return (
    <div className="flex min-h-full items-start justify-center bg-muted/10 p-4 lg:p-8">
      <Card className="w-full max-w-2xl border-amber-500/30">
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-300">
              {isUnregistered ? '需要登记' : '暂时不可用'}
            </Badge>
            <span className="text-xs text-muted-foreground">Task Center</span>
          </div>
          <CardTitle className="flex items-center gap-2 text-xl">
            {isUnregistered
              ? <Link2 className="h-5 w-5 text-primary" aria-hidden="true" />
              : <AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden="true" />}
            {isUnregistered ? '先连接这个项目' : '暂时无法读取项目事实'}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {isUnregistered
              ? '当前工作区还没有执行控制面登记。登记并绑定后，Task Center 才能读取项目状态、Brain、计划和任务历史。'
              : 'Control Plane 当前不可用。现有项目数据不会被修改，请稍后重试。'}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border bg-muted/20 p-3">
            <div className="text-sm font-medium">{project.displayName}</div>
            <div className="mt-1 break-all font-mono text-xs text-muted-foreground">{project.fullPath}</div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-wrap gap-2">
            {isUnregistered ? (
              <Button onClick={() => void register()} disabled={isRegistering}>
                {isRegistering
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  : <ShieldCheck className="mr-2 h-4 w-4" aria-hidden="true" />}
                {isRegistering ? '正在登记并绑定…' : '登记并绑定当前项目'}
              </Button>
            ) : (
              <Button variant="outline" onClick={onRetry}>
                <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />重试
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
