package com.zhishu.projectactivity;

import java.time.Instant;
import java.util.UUID;

public record ProjectMetricsView(
        String schemaVersion,
        UUID projectId,
        int windowHours,
        Instant generatedAt,
        AttemptMetrics attempts,
        TokenMetrics tokens,
        ActivityMetrics activity
) {
    public record AttemptMetrics(
            long total,
            long terminal,
            long succeeded,
            long failed,
            long lost,
            long aborted,
            long active,
            long unknownHealth,
            long lostHealth,
            double failureRate,
            long p50DurationMs,
            long p95DurationMs
    ) {
    }

    public record TokenMetrics(
            long brainRuns,
            long inputTokens,
            long outputTokens,
            long totalTokens
    ) {
    }

    public record ActivityMetrics(
            long eventCount,
            long latestCursor,
            long retentionFloorCursor,
            Instant latestEventAt,
            Long latestEventLagMs
    ) {
    }
}
