package com.zhishu.task;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

public record TaskFollowUpView(
        UUID id,
        UUID taskId,
        UUID parentAttemptId,
        UUID attemptId,
        String clientRequestId,
        String actor,
        String feedback,
        String requestedAcceptance,
        Map<String, Object> additionalContext,
        int attemptNumber,
        AttemptStatus attemptStatus,
        String errorCode,
        String errorMessage,
        AcceptanceDecision acceptanceDecision,
        String acceptanceReason,
        Instant acceptanceAt,
        Instant createdAt
) {
}
