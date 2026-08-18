package com.zhishu.integration;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.fasterxml.jackson.databind.JsonNode;

public record IntegrationGateView(
        UUID gateId,
        UUID projectId,
        UUID planId,
        UUID planVersionId,
        UUID scheduleId,
        String schemaVersion,
        String status,
        String gateMode,
        String applyState,
        String evidenceStatus,
        int evidenceCount,
        long baseStateRevision,
        long basePlanVersion,
        JsonNode proposal,
        JsonNode conflictAssessment,
        List<UUID> evidenceReferenceIds,
        List<EvidenceView> evidence,
        String clientRequestId,
        String createdBy,
        Instant createdAt,
        String decidedBy,
        Instant decidedAt,
        String decisionReason,
        List<EventView> events,
        List<IntegrationExecutionView> executions
) {
    public record EvidenceView(
            UUID evidenceReferenceId,
            UUID projectId,
            UUID artifactId,
            String artifactHash,
            String sourceType,
            UUID sourceId,
            String purpose,
            Instant referenceCreatedAt,
            Instant capturedAt
    ) {
    }

    public record EventView(
            long eventId,
            String eventType,
            String actor,
            JsonNode payload,
            Instant occurredAt
    ) {
    }
}
