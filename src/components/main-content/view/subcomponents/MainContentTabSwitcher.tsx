import {
  ClipboardCheck,
  Folder,
  GitBranch,
  MessageSquare,
  MonitorPlay,
  MoreHorizontal,
  PanelsTopLeft,
  Puzzle,
  Terminal,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

import { usePlugins } from '../../../../contexts/PluginsContext';
import type { AppTab } from '../../../../types/app';
import { ActionMenu, Pill, PillBar, Tooltip, type ActionMenuItem } from '../../../../shared/view/ui';
import PluginIcon from '../../../plugins/view/PluginIcon';

type MainContentTabSwitcherProps = {
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
  shouldShowTasksTab: boolean;
  shouldShowTaskCenterTab: boolean;
  shouldShowBrowserTab: boolean;
};

type BuiltInTab = {
  kind: 'builtin';
  id: AppTab;
  labelKey: string;
  icon: LucideIcon;
};

type PluginTab = {
  kind: 'plugin';
  id: AppTab;
  label: string;
  pluginName: string;
  iconFile: string;
};

type TabDefinition = BuiltInTab | PluginTab;

const CHAT_TAB: BuiltInTab = {
  kind: 'builtin',
  id: 'chat',
  labelKey: 'tabs.chat',
  icon: MessageSquare,
};

const SHELL_TAB: BuiltInTab = {
  kind: 'builtin',
  id: 'shell',
  labelKey: 'tabs.shell',
  icon: Terminal,
};

const FILES_TAB: BuiltInTab = {
  kind: 'builtin',
  id: 'files',
  labelKey: 'tabs.files',
  icon: Folder,
};

const GIT_TAB: BuiltInTab = {
  kind: 'builtin',
  id: 'git',
  labelKey: 'tabs.git',
  icon: GitBranch,
};

const BROWSER_TAB: BuiltInTab = {
  kind: 'builtin',
  id: 'browser',
  labelKey: 'tabs.browser',
  icon: MonitorPlay,
};

const TASKS_TAB: BuiltInTab = {
  kind: 'builtin',
  id: 'tasks',
  labelKey: 'tabs.tasks',
  icon: ClipboardCheck,
};

const TASK_CENTER_TAB: BuiltInTab = {
  kind: 'builtin',
  id: 'task-center',
  labelKey: 'tabs.taskCenter',
  icon: PanelsTopLeft,
};

const AGENT_TASKS_TAB: BuiltInTab = {
  kind: 'builtin',
  id: 'agent-tasks',
  labelKey: 'tabs.agentTasks',
  icon: Workflow,
};

export default function MainContentTabSwitcher({
  activeTab,
  setActiveTab,
  shouldShowTasksTab,
  shouldShowTaskCenterTab,
  shouldShowBrowserTab,
}: MainContentTabSwitcherProps) {
  const { t } = useTranslation();
  const { plugins } = usePlugins();

  const orderedBuiltInTabs: BuiltInTab[] = [
    CHAT_TAB,
    SHELL_TAB,
    ...(shouldShowTaskCenterTab ? [TASK_CENTER_TAB] : []),
    FILES_TAB,
    GIT_TAB,
    AGENT_TASKS_TAB,
    ...(shouldShowBrowserTab ? [BROWSER_TAB] : []),
    ...(shouldShowTasksTab ? [TASKS_TAB] : []),
  ];

  const pluginTabs: PluginTab[] = plugins
    .filter((plugin) => plugin.enabled)
    .map((plugin) => ({
      kind: 'plugin',
      id: `plugin:${plugin.name}` as AppTab,
      label: plugin.displayName,
      pluginName: plugin.name,
      iconFile: plugin.icon,
    }));

  const primaryTabs = orderedBuiltInTabs.slice(0, shouldShowTaskCenterTab ? 4 : 3);
  const overflowTabs: TabDefinition[] = [
    ...orderedBuiltInTabs.slice(primaryTabs.length),
    ...pluginTabs,
  ];

  const getTabLabel = (tab: TabDefinition) => (
    tab.kind === 'builtin' ? t(tab.labelKey) : tab.label
  );

  const renderTab = (tab: TabDefinition) => {
    const isActive = tab.id === activeTab;
    const displayLabel = getTabLabel(tab);

    return (
      <Tooltip key={tab.id} content={displayLabel} position="bottom">
        <Pill
          isActive={isActive}
          onClick={() => setActiveTab(tab.id)}
          className="px-2.5 py-[5px]"
        >
          {tab.kind === 'builtin' ? (
            <tab.icon className="h-3.5 w-3.5" strokeWidth={isActive ? 2.2 : 1.8} />
          ) : (
            <PluginIcon
              pluginName={tab.pluginName}
              iconFile={tab.iconFile}
              className="flex h-3.5 w-3.5 items-center justify-center [&>svg]:h-full [&>svg]:w-full"
            />
          )}
          <span className="hidden lg:inline">{displayLabel}</span>
        </Pill>
      </Tooltip>
    );
  };

  const moreItems: ActionMenuItem[] = overflowTabs.map((tab) => ({
    key: tab.id,
    label: getTabLabel(tab),
    icon: tab.kind === 'builtin' ? tab.icon : Puzzle,
    onSelect: () => setActiveTab(tab.id),
  }));

  const hasActiveOverflowTab = overflowTabs.some((tab) => tab.id === activeTab);

  return (
    <PillBar>
      {primaryTabs.map(renderTab)}
      <ActionMenu
        label="更多"
        icon={MoreHorizontal}
        items={moreItems}
        portal
        variant={hasActiveOverflowTab ? 'secondary' : 'ghost'}
        size="sm"
        ariaLabel="更多功能"
        triggerClassName="h-auto rounded-md px-2.5 py-[5px] text-sm font-medium"
      />
    </PillBar>
  );
}
