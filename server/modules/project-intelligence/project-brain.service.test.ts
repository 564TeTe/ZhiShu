import assert from 'node:assert/strict';
import test from 'node:test';

import { runProjectBrain, type BrainContextPackage } from './index.js';

const context: BrainContextPackage = {
  packageId: 'package-1', packageType: 'BRAIN',
  version: {
    stateRevision: 7, planVersion: null, executionWatermark: 23,
    contextGeneratedAt: '2026-08-15T00:00:00.000Z', contextPackageVersion: '1.0',
  },
  project: { projectId: 'project-1', displayName: 'Demo' },
  state: {
    goal: {
      entryId: 'goal-1', entryType: 'GOAL', title: '交付', content: '交付可信中心',
      authorityLevel: 'USER_CONFIRMED', evidenceReferenceIds: [],
    },
    stage: {
      entryId: 'stage-1', entryType: 'STAGE', title: '阶段 4', content: '阶段 4',
      authorityLevel: 'USER_CONFIRMED', evidenceReferenceIds: [],
    },
    summary: 'Brain 只读协作', blocker: null, entries: [],
  },
  decisions: [], constraints: [], risks: [],
  derivedSystemFacts: [{ factType: 'EXECUTION_TASK_COUNTS', activeTaskCount: 1 }],
  activePlan: {
    planId: 'plan-1', name: 'Delivery', versionNumber: 2, objective: 'Ship',
    nodes: [
      { nodeKey: 'done', title: 'Done', objective: 'Done', executionState: 'COMPLETED' },
      { nodeKey: 'verify', title: 'Verify evidence', objective: 'Run tests', executionState: 'READY' },
    ],
  },
};

test('Project Brain is grounded in one context version and has no execution tools', () => {
  const result = runProjectBrain(context, '当前做到哪，下一步有什么建议？');
  assert.match(result.message, /阶段 4/);
  assert.match(result.message, /State Revision 7/);
  assert.match(result.message, /下一步：Verify evidence（verify，READY）：Run tests/);
  assert.equal(result.permissions.shell, false);
  assert.equal(result.permissions.filesystemRead, false);
  assert.equal(result.permissions.filesystemWrite, false);
  assert.equal(result.permissions.runtimeDispatch, false);
  assert.equal(result.permissions.stateWrite, false);
  assert.equal(result.generatedProposal?.status, 'DRAFT');
  assert.equal(result.citations[0]?.sourceId, 'goal-1');
  assert.ok(result.citations.some((citation) => citation.sourceType === 'PLAN_NODE'
    && citation.sourceId === 'plan-1:verify'));
});

test('Project Brain rejects a non-Brain context package', () => {
  assert.throws(
    () => runProjectBrain({ ...context, packageType: 'PLANNER' as 'BRAIN' }, 'status?'),
    /BrainContextPackageV1/,
  );
});
