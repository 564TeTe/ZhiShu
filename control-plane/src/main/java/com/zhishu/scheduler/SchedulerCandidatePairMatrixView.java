package com.zhishu.scheduler;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Read-only evaluation of deterministic two-node Parallel Schedule candidates.
 * The view predicts dependency, scope, capability, and active Schedule blockers without reserving work.
 */
public record SchedulerCandidatePairMatrixView(
        UUID projectId,
        UUID planId,
        UUID planVersionId,
        String schemaVersion,
        long baseStateRevision,
        long basePlanVersion,
        int maxWorkers,
        SummaryView summary,
        List<CandidatePairView> candidates,
        Instant generatedAt
) {
    public record SummaryView(
            int nodeCount,
            long totalPairCount,
            int evaluatedPairCount,
            int eligiblePairCount,
            int blockedPairCount,
            boolean truncated
    ) {
    }

    public record CandidatePairView(
            String pairKey,
            CandidateNodeView leftNode,
            CandidateNodeView rightNode,
            String dependencyAssessment,
            String dependencyDirection,
            String scopeAssessment,
            List<ScopeConflictView> scopeConflicts,
            String workspaceIsolation,
            boolean activeScheduleConflict,
            boolean eligible,
            List<String> blockers
    ) {
    }

    public record CandidateNodeView(
            String nodeKey,
            String title,
            String executionState,
            List<String> scope,
            List<String> requiredCapabilities,
            MatchedProfileView matchedProfile,
            boolean schedulable,
            List<String> blockers
    ) {
    }

    public record MatchedProfileView(
            UUID profileId,
            String profileName,
            String executor
    ) {
    }

    public record ScopeConflictView(String leftScope, String rightScope) {
    }
}
