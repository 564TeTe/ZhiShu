package com.zhishu.task;

import java.time.Instant;
import java.util.UUID;

public record TaskAcceptanceView(
        UUID id,
        UUID taskId,
        UUID attemptId,
        String clientRequestId,
        String actor,
        AcceptanceDecision decision,
        String reason,
        Instant createdAt
) {
}
