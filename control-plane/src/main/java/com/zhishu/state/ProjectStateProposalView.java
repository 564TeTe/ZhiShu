package com.zhishu.state;

import java.time.Instant;
import java.util.UUID;

import com.fasterxml.jackson.databind.JsonNode;

public record ProjectStateProposalView(
        UUID proposalId,
        UUID projectId,
        String schemaVersion,
        String proposalType,
        String status,
        long baseStateRevision,
        JsonNode payload,
        JsonNode validationResult,
        String sourceType,
        String sourceId,
        String createdBy,
        Instant createdAt,
        String decidedBy,
        Instant decidedAt,
        Long appliedRevision
) {
}
