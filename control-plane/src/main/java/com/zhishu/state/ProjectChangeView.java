package com.zhishu.state;

import java.time.Instant;
import java.util.UUID;

import com.fasterxml.jackson.databind.JsonNode;

public record ProjectChangeView(
        UUID changeId,
        UUID projectId,
        String changeType,
        String actor,
        String sourceType,
        String sourceId,
        long beforeRevision,
        long afterRevision,
        JsonNode payload,
        Instant occurredAt
) {
}
