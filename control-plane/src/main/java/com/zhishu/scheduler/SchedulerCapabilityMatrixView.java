package com.zhishu.scheduler;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Read-only Scheduler and Worker Capability Matrix for a current Plan.
 * The view explains profile eligibility without reserving workers or changing scheduling state.
 */
public record SchedulerCapabilityMatrixView(
        UUID projectId,
        UUID planId,
        UUID planVersionId,
        String schemaVersion,
        long baseStateRevision,
        long basePlanVersion,
        int maxWorkers,
        SummaryView summary,
        List<ProfileView> profiles,
        List<NodeView> nodes,
        Instant generatedAt
) {
    public record SummaryView(
            int profileCount,
            int enabledProfileCount,
            int nodeCount,
            int schedulableNodeCount,
            int blockedNodeCount
    ) {
    }

    public record ProfileView(
            UUID profileId,
            String profileName,
            String executor,
            boolean enabled,
            List<String> capabilities
    ) {
    }

    public record NodeView(
            String nodeKey,
            String title,
            String executionState,
            boolean executable,
            List<String> scope,
            List<String> requiredCapabilities,
            int eligibleProfileCount,
            boolean schedulable,
            boolean activeSchedule,
            List<String> blockers,
            List<ProfileMatchView> profileMatches
    ) {
    }

    public record ProfileMatchView(
            UUID profileId,
            String profileName,
            String executor,
            boolean enabled,
            List<String> capabilities,
            List<String> missingCapabilities,
            boolean eligible
    ) {
    }
}
