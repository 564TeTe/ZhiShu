import type {
  StateStewardCandidate,
  StateStewardEntryType,
  StateStewardStateEntry,
  StructuredExecutionReportV1,
} from '@/shared/types.js';

type StateStewardCandidateDisposition = 'NEW' | 'STALE' | 'CONFLICT';

type StateStewardProposalCandidate = StateStewardCandidate & {
  candidateKey: string;
  disposition: StateStewardCandidateDisposition;
  mergedCandidateCount: number;
  existingEntryId: string | null;
  evidenceReferenceIds: string[];
};

type StateStewardProposal = {
  schemaVersion: '1.0';
  proposalType: 'STATE_CHANGE';
  roleVersion: 'state-steward:v1';
  promptVersion: 'state-steward-prompt:v1';
  reportId: string;
  baseStateRevision: number;
  result: StructuredExecutionReportV1['result'];
  candidates: StateStewardProposalCandidate[];
  summary: {
    extracted: number;
    newCandidates: number;
    staleCandidates: number;
    conflictCandidates: number;
    mergedCandidates: number;
  };
  permissions: typeof STATE_STEWARD_PERMISSIONS;
};

type ExistingStateStewardProposal = {
  reportId: string;
  proposal: StateStewardProposal;
};

type StateStewardResult = {
  replayed: boolean;
  proposal: StateStewardProposal;
};

const STATE_STEWARD_PERMISSIONS = {
  readStructuredReport: true,
  readProjectState: true,
  generateStateChangeProposal: true,
  shell: false,
  git: false,
  filesystemRead: false,
  filesystemWrite: false,
  stateWrite: false,
  factWrite: false,
  decisionWrite: false,
  planWrite: false,
} as const;

function normalize(value: string): string {
  return value.trim().replace(/\\s+/g, ' ').toLocaleLowerCase();
}

function candidateKey(candidate: Pick<StateStewardCandidate, 'entryType' | 'title' | 'content'>): string {
  return `${candidate.entryType}:${normalize(candidate.title)}:${normalize(candidate.content)}`;
}

function titleKey(candidate: Pick<StateStewardCandidate, 'entryType' | 'title'>): string {
  return `${candidate.entryType}:${normalize(candidate.title)}`;
}

function mergeCandidates(report: StructuredExecutionReportV1): StateStewardProposalCandidate[] {
  const grouped = new Map<string, StateStewardProposalCandidate>();
  const sources: Array<[StateStewardEntryType, StateStewardCandidate[] | undefined]> = [
    ['DISCOVERY', report.discoveries],
    ['DECISION', report.decisions],
    ['CONSTRAINT', report.constraints],
    ['RISK', report.risks],
  ];
  for (const [entryType, values] of sources) {
    for (const value of values ?? []) {
      if (value.entryType !== entryType) continue;
      if (!value || !value.title?.trim() || !value.content?.trim()) continue;
      const candidate = { ...value, entryType };
      const key = candidateKey(candidate);
      const previous = grouped.get(key);
      const evidenceReferenceIds = [
        ...(previous?.evidenceReferenceIds ?? []),
        ...(value.evidenceReferenceIds ?? []),
      ].filter((id, index, all) => Boolean(id?.trim()) && all.indexOf(id) === index);
      if (previous) {
        grouped.set(key, {
          ...previous,
          rationale: previous.rationale || value.rationale || null,
          evidenceReferenceIds,
          mergedCandidateCount: previous.mergedCandidateCount + 1,
        });
      } else {
        grouped.set(key, {
          entryType,
          title: value.title.trim(),
          content: value.content.trim(),
          rationale: value.rationale?.trim() || null,
          candidateKey: key,
          disposition: 'NEW',
          mergedCandidateCount: 1,
          existingEntryId: null,
          evidenceReferenceIds,
        });
      }
    }
  }
  return [...grouped.values()];
}

/**
 * Builds the proposal-only State Steward result consumed by Task Center Gateway.
 * The caller supplies authoritative State entries; this function never mutates
 * State and refuses unsupported entry types such as FACT.
 */
export function runStateSteward(
  report: StructuredExecutionReportV1,
  state: { stateRevision: number; entries: StateStewardStateEntry[] },
  existingProposals: ExistingStateStewardProposal[] = [],
): StateStewardResult {
  if (!report.reportId.trim()) throw new Error('State Steward reportId is required.');
  if (report.reportVersion !== '1.0') throw new Error('State Steward requires ExecutionReportV1.');
  if (!Number.isSafeInteger(state.stateRevision) || state.stateRevision < 0) {
    throw new Error('State Steward requires a non-negative state revision.');
  }
  const replay = existingProposals.find((item) => item.reportId === report.reportId);
  if (replay) return { replayed: true, proposal: replay.proposal };

  const candidates = mergeCandidates(report);
  const activeEntries = state.entries.filter((entry) => entry.status === 'ACTIVE');
  const byCandidate = new Map(activeEntries.map((entry) => [candidateKey(entry), entry]));
  const byTitle = new Map<string, StateStewardStateEntry[]>();
  for (const entry of activeEntries) {
    const key = titleKey(entry);
    byTitle.set(key, [...(byTitle.get(key) ?? []), entry]);
  }
  const classified = candidates.map((candidate) => {
    const exact = byCandidate.get(candidate.candidateKey);
    const sameTitle = byTitle.get(titleKey(candidate)) ?? [];
    if (exact) {
      return { ...candidate, disposition: 'STALE' as const, existingEntryId: exact.entryId };
    }
    if (sameTitle.length > 0) {
      return { ...candidate, disposition: 'CONFLICT' as const, existingEntryId: sameTitle[0].entryId };
    }
    return candidate;
  });
  const summary = {
    extracted: candidates.length,
    newCandidates: classified.filter((candidate) => candidate.disposition === 'NEW').length,
    staleCandidates: classified.filter((candidate) => candidate.disposition === 'STALE').length,
    conflictCandidates: classified.filter((candidate) => candidate.disposition === 'CONFLICT').length,
    mergedCandidates: classified.reduce((total, candidate) => total + Math.max(0, candidate.mergedCandidateCount - 1), 0),
  };
  return {
    replayed: false,
    proposal: {
      schemaVersion: '1.0',
      proposalType: 'STATE_CHANGE',
      roleVersion: 'state-steward:v1',
      promptVersion: 'state-steward-prompt:v1',
      reportId: report.reportId,
      baseStateRevision: state.stateRevision,
      result: report.result,
      candidates: classified,
      summary,
      permissions: STATE_STEWARD_PERMISSIONS,
    },
  };
}
