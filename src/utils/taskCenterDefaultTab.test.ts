import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveInitialTab,
  TASK_CENTER_PRIMARY_ROLLOUT_KEY,
  TASK_CENTER_PRIMARY_ROLLOUT_VERSION,
} from './taskCenterDefaultTab';

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    values,
  };
}

test('primary rollout migrates the old chat default once', () => {
  const state = storage({ activeTab: 'chat' });
  assert.equal(resolveInitialTab(state, { taskCenterEnabled: true, taskCenterPrimary: true }), 'task-center');
  assert.equal(state.values.get('activeTab'), 'task-center');
  assert.equal(state.values.get(TASK_CENTER_PRIMARY_ROLLOUT_KEY), TASK_CENTER_PRIMARY_ROLLOUT_VERSION);
});

test('primary rollout preserves an explicit legacy tab', () => {
  const state = storage({ activeTab: 'agent-tasks' });
  assert.equal(resolveInitialTab(state, { taskCenterEnabled: true, taskCenterPrimary: true }), 'agent-tasks');
  assert.equal(state.values.get(TASK_CENTER_PRIMARY_ROLLOUT_KEY), TASK_CENTER_PRIMARY_ROLLOUT_VERSION);
});

test('preserved non-chat tab can later switch to chat without migration', () => {
  const state = storage({ activeTab: 'agent-tasks' });
  assert.equal(resolveInitialTab(state, { taskCenterEnabled: true, taskCenterPrimary: true }), 'agent-tasks');
  state.values.set('activeTab', 'chat');
  assert.equal(resolveInitialTab(state, { taskCenterEnabled: true, taskCenterPrimary: true }), 'chat');
});

test('after rollout a user-selected chat tab remains chat', () => {
  const state = storage({ activeTab: 'chat', [TASK_CENTER_PRIMARY_ROLLOUT_KEY]: TASK_CENTER_PRIMARY_ROLLOUT_VERSION });
  assert.equal(resolveInitialTab(state, { taskCenterEnabled: true, taskCenterPrimary: true }), 'chat');
});

test('disabled primary mode keeps the legacy chat fallback', () => {
  const state = storage();
  assert.equal(resolveInitialTab(state, { taskCenterEnabled: true, taskCenterPrimary: false }), 'chat');
});

test('disabled task center rejects a persisted task-center tab', () => {
  const state = storage({
    activeTab: 'task-center',
    [TASK_CENTER_PRIMARY_ROLLOUT_KEY]: TASK_CENTER_PRIMARY_ROLLOUT_VERSION,
  });
  assert.equal(resolveInitialTab(state, { taskCenterEnabled: false, taskCenterPrimary: true }), 'chat');
});
