import type { AppTab } from '../types/app';

export const TASK_CENTER_PRIMARY_ROLLOUT_VERSION = '1';
export const TASK_CENTER_PRIMARY_ROLLOUT_KEY = 'zhishu.task-center.primary-rollout';

type TabStorage = Pick<Storage, 'getItem' | 'setItem'>;

type InitialTabOptions = {
  taskCenterEnabled: boolean;
  taskCenterPrimary: boolean;
};

const VALID_TABS = new Set([
  'chat', 'files', 'shell', 'git', 'tasks', 'task-center', 'agent-tasks', 'browser',
]);

function isValidTab(value: string, taskCenterEnabled: boolean): value is AppTab {
  if (value === 'task-center' && !taskCenterEnabled) return false;
  return VALID_TABS.has(value) || value.startsWith('plugin:');
}

/**
 * Resolves the first visible tab without overwriting an explicit non-chat tab.
 * The staged rollout treats the old `chat` fallback as an automatic default,
 * migrates it once to `task-center`, and then respects subsequent user choices.
 */
export function resolveInitialTab(
  storage: TabStorage,
  options: InitialTabOptions,
): AppTab {
  const primaryRolloutEnabled = options.taskCenterEnabled && options.taskCenterPrimary;
  const fallback: AppTab = primaryRolloutEnabled ? 'task-center' : 'chat';
  try {
    const stored = storage.getItem('activeTab');
    const storedTab = stored && isValidTab(stored, options.taskCenterEnabled) ? stored : null;
    const rolloutComplete = storage.getItem(TASK_CENTER_PRIMARY_ROLLOUT_KEY)
      === TASK_CENTER_PRIMARY_ROLLOUT_VERSION;

    if (rolloutComplete) {
      return storedTab ?? fallback;
    }

    if (primaryRolloutEnabled) {
      storage.setItem(TASK_CENTER_PRIMARY_ROLLOUT_KEY, TASK_CENTER_PRIMARY_ROLLOUT_VERSION);
      if (storedTab && storedTab !== 'chat') {
        return storedTab;
      }
      storage.setItem('activeTab', 'task-center');
      return 'task-center';
    }

    if (storedTab) return storedTab;
  } catch {
    // localStorage unavailable
  }
  return fallback;
}
