package com.zhishu.scheduler;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Read-only deterministic recommendation over evaluated Parallel Schedule candidate pairs.
 * The view exposes stable ranking inputs and never creates scheduling or execution state.
 */
public record SchedulerRecommendationView(
        UUID projectId,
        UUID planId,
        UUID planVersionId,
        String schemaVersion,
        long baseStateRevision,
        long basePlanVersion,
        int maxWorkers,
        String recommendationFingerprint,
        BaselineView baseline,
        DeterminismView determinism,
        SummaryView summary,
        RecommendationView recommendation,
        List<RankedCandidateView> rankedCandidates,
        Instant generatedAt
) {
    public record BaselineView(
            UUID planVersionId,
            long planVersion,
            long stateRevision,
            String status
    ) {
    }

    public record DeterminismView(
            String orderingRule,
            String scoreModelVersion,
            int candidateEvaluationLimit,
            int rankLimit,
            boolean stable
    ) {
    }

    public record SummaryView(
            int evaluatedPairCount,
            int eligiblePairCount,
            int blockedPairCount,
            int rankedCandidateCount,
            boolean truncated
    ) {
    }

    public record RecommendationView(
            String status,
            String pairKey,
            Integer rank,
            Long score,
            List<String> reasons
    ) {
    }

    public record RankedCandidateView(
            int rank,
            String pairKey,
            String leftNodeKey,
            String rightNodeKey,
            boolean eligible,
            long score,
            ScoreBreakdownView scoreBreakdown,
            List<String> reasons,
            List<String> blockers
    ) {
    }

    public record ScoreBreakdownView(
            long eligibility,
            long nodeReadiness,
            long planPriority,
            long dependency,
            long scope,
            long profileMatch,
            long scheduleAvailability,
            long blockerPenalty
    ) {
    }
}
