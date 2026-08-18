import assert from 'node:assert/strict';
import test from 'node:test';

import { runProjectPlanner, type PlannerContextPackage } from './index.js';

test('Planner produces a dependency-aware proposal without publish or execution permissions', () => {
  const context: PlannerContextPackage = {
    packageId: 'package-1', packageType: 'PLANNER',
    version: { stateRevision: 4, planVersion: null, executionWatermark: 9, contextGeneratedAt: '', contextPackageVersion: '1.0' },
    project: { projectId: 'project-1', displayName: 'Demo' },
    state: { goal: { content: 'Ship' }, stage: { content: 'Stage 5' }, blocker: null },
    constraints: [],
  };
  const result = runProjectPlanner(context, '建设 Plan Center');
  const implementation = result.proposal.nodes[1];
  assert.equal(result.proposal.baseStateRevision, 4);
  assert.deepEqual(implementation?.dependsOn, []);
  assert.deepEqual(implementation?.requiredCapabilities, ['READ_FILE', 'WRITE_FILE', 'TEST']);
  assert.match(implementation?.acceptanceCriteria.join('\n') ?? '', /系统证据/);
  assert.deepEqual(result.proposal.nodes[2]?.dependsOn, ['implement']);
  assert.equal(result.permissions.taskCreate, false);
  assert.equal(result.permissions.runtimeDispatch, false);
  assert.equal(result.permissions.planPublish, false);
});

test('Planner targets the active Plan when generating a replan proposal', () => {
  const context: PlannerContextPackage = {
    packageId: 'package-2', packageType: 'PLANNER',
    version: { stateRevision: 8, planVersion: 3, executionWatermark: 20, contextGeneratedAt: '', contextPackageVersion: '1.0' },
    project: { projectId: 'project-1', displayName: 'Demo' },
    state: { goal: { content: 'Ship' }, stage: { content: 'Stage 5' }, blocker: null },
    activePlan: {
      planId: 'plan-1', versionNumber: 3, name: 'Current', objective: 'Current objective',
      nodes: [
        { nodeKey: 'scope', title: 'Scope', objective: 'Existing scope', executionState: 'COMPLETED' },
        { nodeKey: 'implement-v3', title: 'Implement', objective: 'Old', executionState: 'RUNNING' },
        { nodeKey: 'verify-v3', title: 'Verify', objective: 'Old verify', executionState: 'NOT_READY' },
      ],
    },
    constraints: [],
  };
  const result = runProjectPlanner(context, '修订现有计划');
  assert.equal(result.proposal.planId, 'plan-1');
  assert.equal(result.proposal.basePlanVersion, 3);
  assert.equal(result.proposal.nodes[1]?.nodeKey, 'implement-v4');
  assert.equal(result.proposal.nodes[1]?.previousNodeKey, 'implement-v3');
});
