package com.zhishu.scheduler;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.fasterxml.jackson.databind.JsonNode;

public record ParallelScheduleView(
        UUID scheduleId,
        UUID projectId,
        UUID planId,
        UUID planVersionId,
        String schemaVersion,
        String status,
        long baseStateRevision,
        long basePlanVersion,
        int maxWorkers,
        JsonNode conflictAssessment,
        String clientRequestId,
        String createdBy,
        Instant createdAt,
        String decidedBy,
        Instant decidedAt,
        String decisionReason,
        List<AssignmentView> assignments,
        List<EventView> events
) {
    public record AssignmentView(
            UUID assignmentId,
            String nodeKey,
            int workerSlot,
            UUID profileId,
            String profileName,
            String executor,
            String status,
            JsonNode scope,
            JsonNode requiredCapabilities,
            JsonNode profileCapabilities,
            WorkspaceLeaseView workspaceLease
    ) {
    }

    public record WorkspaceLeaseView(
            UUID leaseId,
            String workspaceMode,
            String physicalWorkspaceKind,
            String workspaceRef,
            String branchRef,
            String status,
            String provisioningState,
            String workspacePath,
            Instant leaseExpiresAt,
            Instant provisioningStartedAt,
            Instant provisionedAt,
            String failureCode,
            String failureMessage,
            Instant cleanedAt,
            Instant createdAt,
            Instant releasedAt
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
