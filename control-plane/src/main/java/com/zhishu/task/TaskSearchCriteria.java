package com.zhishu.task;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

public record TaskSearchCriteria(
        UUID projectId,
        TaskArchiveScope archiveScope,
        AttemptStatus status,
        ResolutionStatus resolutionStatus,
        String searchPattern,
        Instant beforeCreatedAt,
        UUID beforeTaskId,
        int limit
) {
    public TaskSearchCriteria {
        Objects.requireNonNull(projectId, "projectId");
        Objects.requireNonNull(archiveScope, "archiveScope");
        if ((beforeCreatedAt == null) != (beforeTaskId == null)) {
            throw new IllegalArgumentException("Task history cursor must contain both timestamp and task id");
        }
        if (limit < 1) {
            throw new IllegalArgumentException("limit must be positive");
        }
    }
}
