import { useState, useEffect, useRef } from 'react';
import { Check, ChevronRight, Edit3, MoreHorizontal, Pin, Plus, Trash2, X } from 'lucide-react';
import type { TFunction } from 'i18next';

import { cn } from '../../../../lib/utils';
import type { Project, ProjectSession, LLMProvider } from '../../../../types/app';
import type { SessionActivityMap } from '../../../../hooks/useSessionProtection';
import type { MCPServerStatus, SessionWithProvider } from '../../types/types';
import { getTaskIndicatorStatus } from '../../utils/utils';

import TaskIndicator from './TaskIndicator';
import SidebarProjectSessions from './SidebarProjectSessions';

type SidebarProjectItemProps = {
  project: Project;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  isExpanded: boolean;
  isDeleting: boolean;
  isStarred: boolean;
  editingProject: string | null;
  editingName: string;
  sessions: SessionWithProvider[];
  initialSessionsLoaded: boolean;
  isLoadingMoreSessions: boolean;
  currentTime: Date;
  editingSession: string | null;
  editingSessionName: string;
  tasksEnabled: boolean;
  mcpServerStatus: MCPServerStatus;
  onEditingNameChange: (name: string) => void;
  onToggleProject: (projectName: string) => void;
  onProjectSelect: (project: Project) => void;
  onToggleStarProject: (projectName: string) => void;
  onStartEditingProject: (project: Project) => void;
  onCancelEditingProject: () => void;
  onSaveProjectName: (projectName: string) => void;
  onDeleteProject: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onDeleteSession: (
    projectName: string,
    sessionId: string,
    sessionTitle: string,
    provider: LLMProvider,
  ) => void;
  onLoadMoreSessions: (projectId: string) => void;
  activeSessions: SessionActivityMap;
  attentionSessionIds: ReadonlySet<string>;
  onNewSession: (project: Project) => void;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  t: TFunction;
};

export default function SidebarProjectItem({
  project,
  selectedProject,
  selectedSession,
  isExpanded,
  isDeleting,
  isStarred,
  editingProject,
  editingName,
  sessions,
  initialSessionsLoaded,
  isLoadingMoreSessions,
  currentTime,
  editingSession,
  editingSessionName,
  tasksEnabled,
  mcpServerStatus,
  onEditingNameChange,
  onToggleProject,
  onProjectSelect,
  onToggleStarProject,
  onStartEditingProject,
  onCancelEditingProject,
  onSaveProjectName,
  onDeleteProject,
  onSessionSelect,
  onDeleteSession,
  onLoadMoreSessions,
  activeSessions,
  attentionSessionIds,
  onNewSession,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  t,
}: SidebarProjectItemProps) {
  const isSelected = selectedProject?.projectId === project.projectId;
  const isEditing = editingProject === project.projectId;
  const sessionCount = Number(project.sessionMeta?.total ?? sessions.length);
  const taskStatus = getTaskIndicatorStatus(project, mcpServerStatus);
  const mobileRenameInputRef = useRef<HTMLInputElement>(null);
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  const showPath = project.fullPath !== project.displayName;

  // Close more menu on outside click
  useEffect(() => {
    if (!showMoreMenu) return;
    const handler = () => setShowMoreMenu(false);
    document.addEventListener('click', handler, { once: true });
    return () => document.removeEventListener('click', handler);
  }, [showMoreMenu]);

  useEffect(() => {
    if (!isEditing || !mobileRenameInputRef.current) return;
    let animationFrame = 0;
    const revealInput = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        mobileRenameInputRef.current?.scrollIntoView({ block: 'center', inline: 'nearest' });
      });
    };
    revealInput();
    window.visualViewport?.addEventListener('resize', revealInput);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.visualViewport?.removeEventListener('resize', revealInput);
    };
  }, [isEditing]);

  const toggleProject = () => onToggleProject(project.projectId);
  const toggleStarProject = () => onToggleStarProject(project.projectId);
  const saveProjectName = () => onSaveProjectName(project.projectId);

  const selectAndToggleProject = () => {
    if (selectedProject?.projectId !== project.projectId) {
      onProjectSelect(project);
    }
    toggleProject();
  };

  // ── Mobile layout ──────────────────────────────────────────────
  const mobileView = (
    <div className="md:hidden">
      <div
        className={cn(
          'mx-3 my-1 rounded-lg border bg-card p-3 transition-all duration-150 active:scale-[0.98]',
          isSelected && 'border-indigo-200 bg-indigo-50/60',
          isStarred && !isSelected && 'border-slate-200',
        )}
        onClick={toggleProject}
      >
        <div className="flex items-center justify-between">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <button
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-lg border transition-all active:scale-90',
                isStarred
                  ? 'border-indigo-200 bg-indigo-100 text-indigo-600'
                  : 'border-slate-200 bg-slate-100 text-slate-400',
              )}
              onClick={(e) => { e.stopPropagation(); toggleStarProject(); }}
              title={isStarred ? '取消固定' : '固定项目'}
            >
              <Pin className={cn('h-4 w-4', isStarred && 'fill-current')} />
            </button>
            <div className="min-w-0 flex-1">
              {isEditing ? (
                <input
                  ref={mobileRenameInputRef}
                  type="text"
                  value={editingName}
                  onChange={(e) => onEditingNameChange(e.target.value)}
                  className="w-full rounded-lg border-2 border-indigo-400 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none"
                  placeholder={t('projects.projectNamePlaceholder')}
                  autoFocus autoComplete="off"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveProjectName();
                    if (e.key === 'Escape') onCancelEditingProject();
                  }}
                  style={{ fontSize: '16px', WebkitAppearance: 'none', borderRadius: '8px' }}
                />
              ) : (
                <>
                  <h3 className="truncate text-sm font-medium text-foreground">{project.displayName}</h3>
                  {showPath && (
                    <p className="truncate text-xs text-muted-foreground" title={project.fullPath}>
                      {project.fullPath}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {isEditing ? (
              <>
                <button className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-500 active:scale-90"
                  onClick={(e) => { e.stopPropagation(); saveProjectName(); }}>
                  <Check className="h-4 w-4 text-white" />
                </button>
                <button className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-400 active:scale-90"
                  onClick={(e) => { e.stopPropagation(); onCancelEditingProject(); }}>
                  <X className="h-4 w-4 text-white" />
                </button>
              </>
            ) : (
              <>
                <button className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 active:scale-90"
                  onClick={(e) => { e.stopPropagation(); onDeleteProject(project); }}>
                  <Trash2 className="h-4 w-4" />
                </button>
                <button className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 active:scale-90"
                  onClick={(e) => { e.stopPropagation(); onStartEditingProject(project); }}>
                  <Edit3 className="h-4 w-4" />
                </button>
                <ChevronRight className={cn('h-4 w-4 text-muted-foreground transition-transform', isExpanded && 'rotate-90')} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  // ── Desktop layout (Codex-style compact, with spacing) ─────────
  const desktopView = (
    <div
      className={cn(
        'group relative mx-1 mb-0.5 hidden cursor-pointer items-center rounded-md border-l-[3px] py-1.5 transition-colors md:flex',
        isSelected
          ? 'border-l-indigo-500 bg-indigo-50/70'
          : 'border-l-transparent hover:bg-slate-50',
        isDeleting && 'pointer-events-none opacity-50',
      )}
      onClick={selectAndToggleProject}
    >
      {/* Name + path — left margin ~12px from sidebar edge (px-2=8px + border-l=3px + ml-0.5=1px ≈ 12px) */}
      <div className="ml-0.5 min-w-0 flex-1 pl-0.5">
        {isEditing ? (
          <input
            type="text"
            value={editingName}
            onChange={(e) => onEditingNameChange(e.target.value)}
            className="w-full rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[13px] font-medium focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400/30"
            placeholder={t('projects.projectNamePlaceholder')}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveProjectName();
              if (e.key === 'Escape') onCancelEditingProject();
            }}
          />
        ) : (
          <>
            <div className="flex items-center gap-1">
              <span
                className={cn(
                  'truncate text-[14px] font-semibold leading-tight text-slate-800',
                  !isSelected && 'font-semibold',
                )}
                title={project.displayName}
              >
                {project.displayName}
              </span>
              {tasksEnabled && taskStatus !== 'not-configured' && (
                <TaskIndicator status={taskStatus} size="xs" className="flex-shrink-0" />
              )}
            </div>
            {showPath && (
              <p className="truncate text-[11px] leading-tight text-slate-400" title={project.fullPath}>
                {project.fullPath}
              </p>
            )}
          </>
        )}
      </div>

      {/* Right area — fixed width, default shows count+chevron, hover replaces with action buttons */}
      <div className={cn(
        'flex flex-shrink-0 items-center justify-end pr-1',
        isEditing ? 'gap-0.5' : 'min-w-[52px]',
      )}>
        {isEditing ? (
          <>
            <button className="flex h-6 w-6 items-center justify-center rounded text-green-600 hover:bg-green-50"
              onClick={(e) => { e.stopPropagation(); saveProjectName(); }}>
              <Check className="h-3 w-3" />
            </button>
            <button className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100"
              onClick={(e) => { e.stopPropagation(); onCancelEditingProject(); }}>
              <X className="h-3 w-3" />
            </button>
          </>
        ) : (
          <>
            {/* Default state: session count + faded chevron */}
            <span className="mr-1 tabular-nums text-[11px] text-slate-400 group-hover:hidden">
              {sessionCount}
            </span>
            <ChevronRight
              className={cn(
                'h-4 w-4 flex-shrink-0 text-slate-300 transition-transform group-hover:hidden',
                isExpanded && 'rotate-90',
                isSelected && 'text-slate-400',
              )}
            />

            {/* Hover state: pin + new session + more + chevron */}
            <div className="hidden items-center gap-0.5 group-hover:flex">
              {/* Pin */}
              <button
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100',
                  isStarred ? 'text-indigo-500' : 'text-slate-400 hover:text-slate-600',
                )}
                onClick={(e) => { e.stopPropagation(); toggleStarProject(); }}
                title={isStarred ? '取消固定' : '固定项目'}
              >
                <Pin className={cn('h-3.5 w-3.5', isStarred && 'fill-current')} />
              </button>

              {/* New session + (always in hover area, not just expanded) */}
              <button
                className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-indigo-50 hover:text-indigo-600"
                onClick={(e) => { e.stopPropagation(); onNewSession(project); }}
                title="新建会话"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>

              {/* More menu */}
              <div className="relative">
                <button
                  className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  onClick={(e) => { e.stopPropagation(); setShowMoreMenu(!showMoreMenu); }}
                  title="更多操作"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
                {showMoreMenu && (
                  <div
                    className="absolute right-0 top-full z-50 mt-1 w-32 rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-slate-50"
                      onClick={() => { setShowMoreMenu(false); onStartEditingProject(project); }}
                    >
                      <Edit3 className="h-3 w-3" />
                      重命名
                    </button>
                    <button
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
                      onClick={() => { setShowMoreMenu(false); onDeleteProject(project); }}
                    >
                      <Trash2 className="h-3 w-3" />
                      删除项目
                    </button>
                  </div>
                )}
              </div>

              {/* Chevron */}
              <ChevronRight className={cn('h-4 w-4 flex-shrink-0 text-slate-400 transition-transform', isExpanded && 'rotate-90')} />
            </div>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className={cn(isDeleting && 'pointer-events-none opacity-50')}>
      {mobileView}
      {desktopView}

      <SidebarProjectSessions
        project={project}
        isExpanded={isExpanded}
        sessions={sessions}
        selectedSession={selectedSession}
        initialSessionsLoaded={initialSessionsLoaded}
        hasMoreSessions={Boolean(project.sessionMeta?.hasMore)}
        isLoadingMoreSessions={isLoadingMoreSessions}
        activeSessions={activeSessions}
        attentionSessionIds={attentionSessionIds}
        currentTime={currentTime}
        editingSession={editingSession}
        editingSessionName={editingSessionName}
        onEditingSessionNameChange={onEditingSessionNameChange}
        onStartEditingSession={onStartEditingSession}
        onCancelEditingSession={onCancelEditingSession}
        onSaveEditingSession={onSaveEditingSession}
        onProjectSelect={onProjectSelect}
        onSessionSelect={onSessionSelect}
        onDeleteSession={onDeleteSession}
        onLoadMoreSessions={onLoadMoreSessions}
        onNewSession={onNewSession}
        t={t}
      />
    </div>
  );
}
