package com.zhishu.task;

import java.time.Instant;
import java.util.UUID;

import com.zhishu.runtime.RuntimeHealthStatus;

public record TaskHistoryResponse(
        UUID taskId,
        UUID projectId,
        UUID profileId,
        String title,
        String objective,
        AttemptStatus status,
        AttemptStatus attemptStatus,
        ResolutionStatus resolutionStatus,
        UUID attemptId,
        Integer attemptNumber,
        String runtimeRunId,
        RuntimeHealthStatus runtimeHealthStatus,
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
    public static TaskHistoryResponse from(TaskView view) {
        return new TaskHistoryResponse(
                view.taskId(), view.projectId(), view.profileId(), view.title(), view.objective(),
                view.status(), view.attemptStatus(), view.resolutionStatus(), view.attemptId(),
                view.attemptNumber(), view.runtimeRunId(), view.runtimeHealthStatus(),
                view.lastHeartbeatAt(), view.leaseExpiresAt(), view.unknownSince(), view.lostAt(),
                view.lostReason(), view.createdAt(), view.startedAt(), view.completedAt(),
                view.errorCode(), view.errorMessage(), view.archivedAt(), view.archivedBy(),
                view.archiveReason()
        );
    }
}
