package com.zhishu.event;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

public record StoredTaskEvent(
        long id,
        String eventId,
        UUID taskId,
        UUID attemptId,
        String runtimeRunId,
        long sequenceNo,
        RuntimeEventType eventType,
        Map<String, Object> payload,
        Instant occurredAt,
        Instant receivedAt
) {
}
