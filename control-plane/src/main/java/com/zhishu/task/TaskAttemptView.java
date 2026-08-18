package com.zhishu.task;

import java.time.Instant;
import java.util.UUID;

public record TaskAttemptView(
        UUID attemptId,
        int attemptNumber,
        String runtimeRunId,
        AttemptStatus status,
        com.zhishu.runtime.RuntimeHealthStatus runtimeHealthStatus,
        Instant lastHeartbeatAt,
        Instant leaseExpiresAt,
        Instant unknownSince,
        Instant lostAt,
        String lostReason,
        String executor,
        String modelAlias,
        String connectionRef,
        String approvalMode,
        String requestedApprovalMode,
        Instant startedAt,
        Instant completedAt,
        String errorCode,
        String errorMessage,
        Instant createdAt,
        UUID followUpId,
        UUID parentAttemptId,
        String followUpFeedback,
        String requestedAcceptance,
        AcceptanceDecision acceptanceDecision,
        String acceptanceReason,
        Instant acceptanceAt
) {
}
