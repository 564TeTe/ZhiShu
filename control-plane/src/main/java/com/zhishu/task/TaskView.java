package com.zhishu.task;

import java.time.Instant;
import java.util.UUID;

public record TaskView(
        UUID taskId,
        UUID projectId,
        UUID profileId,
        String title,
        String objective,
        AttemptStatus status,
        ResolutionStatus resolutionStatus,
        UUID attemptId,
        Integer attemptNumber,
        String runtimeRunId,
        com.zhishu.runtime.RuntimeHealthStatus runtimeHealthStatus,
        Instant lastHeartbeatAt,
        Instant leaseExpiresAt,
        Instant unknownSince,
        Instant lostAt,
        String lostReason,
        Instant createdAt,
        Instant startedAt,
        Instant completedAt,
        String errorCode,
        String errorMessage,
        Instant archivedAt,
        String archivedBy,
        String archiveReason
) {
    public AttemptStatus attemptStatus() {
        return status;
    }
}
