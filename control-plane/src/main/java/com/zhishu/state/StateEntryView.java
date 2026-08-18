package com.zhishu.state;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record StateEntryView(
        UUID entryId,
        String entryType,
        String title,
        String content,
        String authorityLevel,
        String sourceType,
        String sourceId,
        String createdBy,
        String rationale,
        Instant observedAt,
        Instant confirmedAt,
        String status,
        UUID supersedesId,
        long createdRevision,
        List<UUID> evidenceReferenceIds,
        Instant createdAt
) {
}
