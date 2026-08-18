package com.zhishu.task;

import java.time.Instant;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

public record TaskFollowUp(
        UUID id,
        UUID taskId,
        UUID parentAttemptId,
        UUID attemptId,
        String clientRequestId,
        String actor,
        String feedback,
        String requestedAcceptance,
        Map<String, Object> additionalContext,
        Instant createdAt
) {
    public TaskFollowUp {
        Objects.requireNonNull(id, "id");
        Objects.requireNonNull(taskId, "taskId");
        Objects.requireNonNull(parentAttemptId, "parentAttemptId");
        Objects.requireNonNull(attemptId, "attemptId");
        Objects.requireNonNull(clientRequestId, "clientRequestId");
        Objects.requireNonNull(actor, "actor");
        Objects.requireNonNull(feedback, "feedback");
        Objects.requireNonNull(requestedAcceptance, "requestedAcceptance");
        additionalContext = Map.copyOf(Objects.requireNonNull(additionalContext, "additionalContext"));
        Objects.requireNonNull(createdAt, "createdAt");
    }
}
