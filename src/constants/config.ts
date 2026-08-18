/**
 * Environment Flag: Is Platform
 * Indicates if the app is running in Platform mode (hosted) or OSS mode (self-hosted)
 */
export const IS_PLATFORM = import.meta.env.VITE_IS_PLATFORM === 'true';

/**
 * Environment Flag: New Task Center
 *
 * Set VITE_ZHISHU_TASK_CENTER_ENABLED=false to remove its tab and reject a
 * persisted `task-center` selection without affecting the legacy Agent Task Center.
 */
export const IS_TASK_CENTER_ENABLED =
  import.meta.env.VITE_ZHISHU_TASK_CENTER_ENABLED !== 'false';

/**
 * Controls the one-time default-tab migration for the new project control
 * surface. The tab remains available when this is false, so rollback does not
 * remove the new center or its server-side data.
 */
export const IS_TASK_CENTER_PRIMARY =
  IS_TASK_CENTER_ENABLED && import.meta.env.VITE_ZHISHU_TASK_CENTER_PRIMARY !== 'false';

/**
 * For empty shell instances where no project is provided,
 * we use a default project object to ensure the shell can still function.
 * This prevents errors related to missing project data.
 *
 * `projectId` is set to a well-known sentinel ('default') because the empty
 * shell doesn't correspond to any real project row in the database; any API
 * call that routes through this placeholder must tolerate a missing match.
 */
export const DEFAULT_PROJECT_FOR_EMPTY_SHELL = {
  projectId: 'default',
  displayName: 'default',
  fullPath: IS_PLATFORM ? '/workspace' : '',
  path: IS_PLATFORM ? '/workspace' : '',
};
