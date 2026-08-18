package com.zhishu.task;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

public record AgentTask(
        UUID id,
        UUID projectId,
        UUID profileId,
        String title,
        String objective,
        AttemptStatus status,
        ResolutionStatus resolutionStatus,
        UUID currentAttemptId,
        Instant createdAt
) {
    public AgentTask {
        Objects.requireNonNull(id, "id");
        Objects.requireNonNull(projectId, "projectId");
        Objects.requireNonNull(profileId, "profileId");
        Objects.requireNonNull(title, "title");
        Objects.requireNonNull(objective, "objective");
        Objects.requireNonNull(status, "status");
        Objects.requireNonNull(resolutionStatus, "resolutionStatus");
        Objects.requireNonNull(createdAt, "createdAt");
        if (title.isBlank()) {
            throw new IllegalArgumentException("title is required");
        }
        if (objective.isBlank()) {
            throw new IllegalArgumentException("objective is required");
        }
    }

    public AgentTask(
            UUID id,
            UUID projectId,
            UUID profileId,
            String title,
            String objective,
            AttemptStatus status,
            UUID currentAttemptId,
            Instant createdAt
    ) {
        this(id, projectId, profileId, title, objective, status,
                ResolutionStatus.fromAttemptStatus(status), currentAttemptId, createdAt);
    }

    public static AgentTask pending(
            UUID id,
            UUID projectId,
            UUID profileId,
            String title,
            String objective,
            Instant createdAt
    ) {
        return new AgentTask(
                id,
                projectId,
                profileId,
                title.trim(),
                objective.trim(),
                AttemptStatus.PENDING,
                ResolutionStatus.OPEN,
                null,
                createdAt
        );
    }
}
