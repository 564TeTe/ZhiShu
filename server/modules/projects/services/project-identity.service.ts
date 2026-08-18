import { randomUUID } from 'node:crypto';

import { appConfigDb } from '@/modules/database/index.js';
import { normalizeProjectPath } from '@/shared/utils.js';

const PROJECT_MACHINE_ID_KEY = 'project_machine_id';

type ProjectMachineIdentityDependencies = {
  getConfig(key: string): string | null;
  setConfig(key: string, value: string): void;
  createId(): string;
};

const defaultDependencies: ProjectMachineIdentityDependencies = {
  getConfig: (key) => appConfigDb.get(key),
  setConfig: (key, value) => appConfigDb.set(key, value),
  createId: randomUUID,
};

/**
 * Returns the stable machine scope consumed by Task Center Gateway workspace resolution.
 *
 * The identifier is local installation metadata. It is deliberately independent
 * from both Node project ids and Control Plane project ids.
 */
export function getOrCreateProjectMachineId(
  dependencies: ProjectMachineIdentityDependencies = defaultDependencies,
): string {
  const stored = dependencies.getConfig(PROJECT_MACHINE_ID_KEY)?.trim();
  if (stored) return stored;

  const machineId = dependencies.createId();
  dependencies.setConfig(PROJECT_MACHINE_ID_KEY, machineId);
  return machineId;
}

/** Builds the normalized, machine-scoped observation sent by Task Center Gateway. */
export function createProjectWorkspaceObservation(project: {
  projectId: string;
  projectRef: string;
}, machineId = getOrCreateProjectMachineId()) {
  return {
    machineId,
    localProjectId: project.projectId,
    normalizedWorkspacePath: normalizeProjectPath(project.projectRef),
  };
}
