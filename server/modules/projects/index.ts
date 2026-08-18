export {
  generateDisplayName,
  getProjectsWithSessions,
} from './services/projects-with-sessions-fetch.service.js';
export { updateProjectDisplayName } from './services/project-management.service.js';
// getProjectIdentityById: used by the Task Center Gateway to resolve one active local project without session synchronization.
export { getProjectIdentityById } from './services/project-management.service.js';
// Workspace identity helpers: used by Task Center Gateway for authenticated, read-only Control Plane resolution.
export {
  createProjectWorkspaceObservation,
  getOrCreateProjectMachineId,
} from './services/project-identity.service.js';
// createProject: used by the worktrees module to register a worktree directory as a switchable project.
export { createProject } from './services/project-management.service.js';
// deleteOrArchiveProject: used by Projects routes and Worktrees cleanup to hide or permanently remove a project.
export { deleteOrArchiveProject, deleteSessionJsonlFilesForProjectPath } from './services/project-delete.service.js';
// restoreArchivedProject: used by the worktrees module to re-activate an archived project when its worktree is reopened.
export { restoreArchivedProject } from './services/project-delete.service.js';
