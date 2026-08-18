import assert from 'node:assert/strict';
import test from 'node:test';

import type { StructuredExecutionReportV1 } from '@/shared/types.js';

import { runStateSteward } from './index.js';

function report(overrides: Partial<StructuredExecutionReportV1> = {}): StructuredExecutionReportV1 {
  return {
    reportId: 'report-1', reportVersion: '1.0', result: 'SUCCESS',
    discoveries: [], decisions: [], constraints: [], risks: [], ...overrides,
  };
}

test('State Steward extracts discoveries and merges duplicate candidates with evidence', () => {
  const result = runStateSteward(report({
    discoveries: [
      { entryType: 'DISCOVERY', title: ' Cache ', content: '  Redis is used  ', evidenceReferenceIds: ['e1'] },
      { entryType: 'DISCOVERY', title: 'Cache', content: 'Redis is used', evidenceReferenceIds: ['e1', 'e2'] },
    ],
  }), { stateRevision: 3, entries: [] });
  assert.equal(result.replayed, false);
  assert.equal(result.proposal.candidates.length, 1);
  assert.equal(result.proposal.candidates[0]?.mergedCandidateCount, 2);
  assert.deepEqual(result.proposal.candidates[0]?.evidenceReferenceIds, ['e1', 'e2']);
  assert.equal(result.proposal.summary.mergedCandidates, 1);
});

test('State Steward marks exact active entries stale and same-title changes conflict', () => {
  const result = runStateSteward(report({
    decisions: [{ entryType: 'DECISION', title: 'Database', content: 'PostgreSQL' }],
    constraints: [{ entryType: 'CONSTRAINT', title: 'Budget', content: 'Must stay below 100' }],
  }), {
    stateRevision: 4,
    entries: [
      { entryId: 'decision-1', entryType: 'DECISION', title: 'Database', content: 'PostgreSQL', status: 'ACTIVE' },
      { entryId: 'constraint-1', entryType: 'CONSTRAINT', title: 'Budget', content: 'Must stay below 200', status: 'ACTIVE' },
    ],
  });
  assert.equal(result.proposal.candidates[0]?.disposition, 'STALE');
  assert.equal(result.proposal.candidates[0]?.existingEntryId, 'decision-1');
  assert.equal(result.proposal.candidates[1]?.disposition, 'CONFLICT');
  assert.equal(result.proposal.summary.staleCandidates, 1);
  assert.equal(result.proposal.summary.conflictCandidates, 1);
});

test('State Steward is proposal-only and never accepts FACT candidates', () => {
  const result = runStateSteward(report({
    discoveries: [{ entryType: 'FACT' as never, title: 'Fact', content: 'Unsupported' }],
  }), { stateRevision: 1, entries: [] });
  assert.equal(result.proposal.candidates.length, 0);
  assert.equal(result.proposal.permissions.stateWrite, false);
  assert.equal(result.proposal.permissions.factWrite, false);
});

test('State Steward replays an existing proposal for the same report', () => {
  const first = runStateSteward(report(), { stateRevision: 2, entries: [] });
  const replay = runStateSteward(report(), { stateRevision: 9, entries: [] }, [
    { reportId: 'report-1', proposal: first.proposal },
  ]);
  assert.equal(replay.replayed, true);
  assert.equal(replay.proposal.baseStateRevision, 2);
});

test('State Steward rejects unsupported report versions', () => {
  assert.throws(
    () => runStateSteward(report({ reportVersion: '2.0' as '1.0' }), { stateRevision: 0, entries: [] }),
    /ExecutionReportV1/,
  );
});
