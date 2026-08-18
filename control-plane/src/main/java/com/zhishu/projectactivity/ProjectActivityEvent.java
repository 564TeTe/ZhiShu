package com.zhishu.projectactivity;

import java.time.Instant;
import java.util.UUID;

public record ProjectActivityEvent(
        long cursor,
        UUID eventId,
        UUID projectId,
        String changeType,
        String resourceType,
        String resourceId,
        UUID taskId,
        UUID attemptId,
        String sourceEventId,
        Instant occurredAt
) {
}
