import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createProjectWorkspaceObservation,
  getOrCreateProjectMachineId,
} from '../services/project-identity.service.js';

test('project machine id reuses persisted installation identity', () => {
  let writes = 0;
  const machineId = getOrCreateProjectMachineId({
    getConfig: () => ' machine-1 ',
    setConfig: () => { writes += 1; },
    createId: () => 'machine-new',
  });

  assert.equal(machineId, 'machine-1');
  assert.equal(writes, 0);
});

test('project machine id is generated and persisted when missing', () => {
  const writes: Array<[string, string]> = [];
  const machineId = getOrCreateProjectMachineId({
    getConfig: () => null,
    setConfig: (key, value) => writes.push([key, value]),
    createId: () => 'machine-new',
  });

  assert.equal(machineId, 'machine-new');
  assert.deepEqual(writes, [['project_machine_id', 'machine-new']]);
});

test('workspace observation keeps local id separate and normalizes its path', () => {
  assert.deepEqual(createProjectWorkspaceObservation({
    projectId: 'local-project-1',
    projectRef: 'D:/workspace/demo/',
  }, 'machine-1'), {
    machineId: 'machine-1',
    localProjectId: 'local-project-1',
    normalizedWorkspacePath: 'D:\\workspace\\demo',
  });
});
