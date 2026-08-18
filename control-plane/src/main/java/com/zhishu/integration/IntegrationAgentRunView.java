package com.zhishu.integration;

import java.time.Instant;
import java.util.UUID;

public record IntegrationAgentRunView(
        UUID agentRunId,
        UUID projectId,
        UUID gateId,
        UUID integrationRunId,
        UUID profileId,
        UUID taskId,
        UUID attemptId,
        String status,
        String objective,
        String createdBy,
        Instant createdAt,
        Instant startedAt,
        Instant completedAt,
        String failureMessage,
        boolean replayed
) {
}
