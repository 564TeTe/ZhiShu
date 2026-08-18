package com.zhishu.integration;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.zhishu.state.ProjectStateConflictException;

/**
 * Owns the proposal-only Integration Gate contract. It records review facts
 * and evidence references, but never merges, applies, builds, tests, or starts
 * an Agent.
 */
@Service
public class IntegrationGateService {

    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    private final ObjectMapper json;
    private final IntegrationExecutionService executions;

    public IntegrationGateService(
            JdbcTemplate jdbc,
            TransactionTemplate transactions,
            ObjectMapper json,
            IntegrationExecutionService executions
    ) {
        this.jdbc = jdbc;
        this.transactions = transactions;
        this.json = json;
        this.executions = executions;
    }

    public List<IntegrationGateView> list(UUID projectId, UUID planId, int limit) {
        int boundedLimit = Math.max(1, Math.min(limit, 100));
        return jdbc.query("""
                SELECT id FROM integration_gate_proposal
                WHERE project_id = ? AND plan_id = ?
                ORDER BY created_at DESC LIMIT ?
                """, (row, number) -> get(projectId, row.getObject("id", UUID.class)),
                projectId, planId, boundedLimit);
    }

    public IntegrationGateView get(UUID projectId, UUID gateId) {
        Map<String, Object> row;
        try {
            row = jdbc.queryForMap("""
                    SELECT id, project_id, plan_id, plan_version_id, schedule_id,
                           schema_version, status, gate_mode, apply_state, evidence_status, evidence_count,
                           base_state_revision, base_plan_version,
                           proposal_payload::text AS proposal_payload,
                           conflict_assessment::text AS conflict_assessment,
                           client_request_id, created_by, created_at,
                           decided_by, decided_at, decision_reason
                    FROM integration_gate_proposal
                    WHERE id = ? AND project_id = ?
                    """, gateId, projectId);
        } catch (EmptyResultDataAccessException error) {
            throw new ProjectStateConflictException("Integration Gate Proposal was not found.");
        }
        List<IntegrationGateView.EvidenceView> evidence = jdbc.query("""
                SELECT evidence_reference_id, project_id, artifact_id, artifact_hash,
                       source_type, source_id, purpose, reference_created_at, captured_at
                FROM integration_gate_evidence
                WHERE gate_id = ? ORDER BY ordinal
                """, (result, number) -> new IntegrationGateView.EvidenceView(
                result.getObject("evidence_reference_id", UUID.class),
                result.getObject("project_id", UUID.class),
                result.getObject("artifact_id", UUID.class),
                result.getString("artifact_hash"), result.getString("source_type"),
                result.getObject("source_id", UUID.class), result.getString("purpose"),
                result.getTimestamp("reference_created_at").toInstant(),
                result.getTimestamp("captured_at").toInstant()
        ), gateId);
        List<UUID> evidenceIds = evidence.stream()
                .map(IntegrationGateView.EvidenceView::evidenceReferenceId)
                .toList();
        List<IntegrationGateView.EventView> events = jdbc.query("""
                SELECT id, event_type, actor, payload::text AS payload, occurred_at
                FROM integration_gate_event WHERE gate_id = ? ORDER BY id
                """, (result, number) -> new IntegrationGateView.EventView(
                result.getLong("id"), result.getString("event_type"), result.getString("actor"),
                read(result.getString("payload")), result.getTimestamp("occurred_at").toInstant()
        ), gateId);
        return new IntegrationGateView(
                (UUID) row.get("id"), (UUID) row.get("project_id"), (UUID) row.get("plan_id"),
                (UUID) row.get("plan_version_id"), (UUID) row.get("schedule_id"),
                String.valueOf(row.get("schema_version")), String.valueOf(row.get("status")),
                String.valueOf(row.get("gate_mode")), String.valueOf(row.get("apply_state")),
                String.valueOf(row.get("evidence_status")), ((Number) row.get("evidence_count")).intValue(),
                ((Number) row.get("base_state_revision")).longValue(),
                ((Number) row.get("base_plan_version")).longValue(),
                read((String) row.get("proposal_payload")), read((String) row.get("conflict_assessment")),
                List.copyOf(evidenceIds), List.copyOf(evidence), String.valueOf(row.get("client_request_id")),
                String.valueOf(row.get("created_by")), ((Timestamp) row.get("created_at")).toInstant(),
                nullable(row.get("decided_by")), instant(row.get("decided_at")),
                nullable(row.get("decision_reason")), List.copyOf(events),
                executions.list((UUID) row.get("project_id"), (UUID) row.get("plan_id"), gateId)
        );
    }

    public IntegrationGateView get(UUID projectId, UUID planId, UUID gateId) {
        IntegrationGateView gate = get(projectId, gateId);
        if (!planId.equals(gate.planId())) {
            throw new ProjectStateConflictException("Integration Gate Proposal was not found for this Plan.");
        }
        return gate;
    }

    public IntegrationGateView create(
            UUID projectId,
            UUID planId,
            UUID scheduleId,
            String actor,
            String clientRequestId,
            long baseStateRevision,
            long basePlanVersion,
            List<UUID> evidenceReferenceIds
    ) {
        String normalizedActor = requireText(actor, "actor");
        String normalizedRequestId = requireText(clientRequestId, "clientRequestId");
        List<UUID> evidenceIds = normalizedEvidence(evidenceReferenceIds);
        String requestHash = sha256(projectId + "|" + planId + "|" + scheduleId + "|"
                + baseStateRevision + "|" + basePlanVersion + "|" + evidenceIds);
        IntegrationGateView result;
        try {
            result = transactions.execute(status -> {
                Map<String, Object> replay = findCreateReplay(projectId, normalizedActor, normalizedRequestId);
                if (replay != null) {
                    if (!requestHash.equals(replay.get("request_hash"))) {
                        throw new ProjectStateConflictException("clientRequestId was reused with different Integration Gate content.");
                    }
                    return get(projectId, planId, (UUID) replay.get("id"));
                }
                PlanSnapshot plan = lockPlan(projectId, planId);
                if (plan.stateRevision() != baseStateRevision || plan.versionNumber() != basePlanVersion) {
                    throw new ProjectStateConflictException("Integration Gate requires the current State Revision and Plan Version.");
                }
                ScheduleSnapshot schedule = lockSchedule(projectId, planId, scheduleId);
                if (!"APPROVED".equals(schedule.status())) {
                    throw new ProjectStateConflictException("Integration Gate requires an approved Parallel Schedule.");
                }
                if (!schedule.planVersionId().equals(plan.versionId())) {
                    throw new ProjectStateConflictException("Parallel Schedule is not based on the current Plan Version.");
                }
                if (schedule.baseStateRevision() != baseStateRevision
                        || schedule.basePlanVersion() != basePlanVersion) {
                    throw new ProjectStateConflictException("Parallel Schedule is stale for this Integration Gate.");
                }
                if (schedule.assignmentCount() != 2 || schedule.provisionedCount() != 2) {
                    throw new ProjectStateConflictException(
                            "Integration Gate requires exactly two available Schedule Assignments."
                    );
                }
                List<EvidenceSnapshot> evidence = loadEvidenceSnapshots(projectId, evidenceIds);
                UUID gateId = UUID.randomUUID();
                ObjectNode proposal = proposal(schedule, evidenceIds);
                ObjectNode assessment = assessment(schedule, evidenceIds);
                int inserted = jdbc.update("""
                        INSERT INTO integration_gate_proposal (
                            id, project_id, plan_id, plan_version_id, schedule_id,
                            status, gate_mode, apply_state, evidence_status, evidence_count,
                            base_state_revision, base_plan_version, proposal_payload,
                            conflict_assessment, client_request_id, request_hash, created_by
                        ) VALUES (?, ?, ?, ?, ?, 'PENDING_APPROVAL', 'EVIDENCE_ONLY', 'NOT_ATTEMPTED', ?, ?, ?, ?,
                                  CAST(? AS jsonb), CAST(? AS jsonb), ?, ?, ?)
                        ON CONFLICT (project_id, created_by, client_request_id) DO NOTHING
                        """, gateId, projectId, planId, plan.versionId(), scheduleId,
                        evidenceIds.isEmpty() ? "MISSING" : "PRESENT", evidence.size(),
                        baseStateRevision, basePlanVersion, write(proposal), write(assessment),
                        normalizedRequestId, requestHash, normalizedActor);
                if (inserted == 0) {
                    Map<String, Object> concurrent = findCreateReplay(projectId, normalizedActor, normalizedRequestId);
                    if (concurrent == null || !requestHash.equals(concurrent.get("request_hash"))) {
                        throw new ProjectStateConflictException("Integration Gate create replay could not be resolved.");
                    }
                    return get(projectId, planId, (UUID) concurrent.get("id"));
                }
                for (int index = 0; index < evidence.size(); index += 1) {
                    EvidenceSnapshot snapshot = evidence.get(index);
                    jdbc.update("""
                            INSERT INTO integration_gate_evidence (
                                gate_id, evidence_reference_id, ordinal, project_id, artifact_id,
                                artifact_hash, source_type, source_id, purpose, reference_created_at
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            """, gateId, snapshot.referenceId(), index, snapshot.projectId(), snapshot.artifactId(),
                            snapshot.artifactHash(), snapshot.sourceType(), snapshot.sourceId(), snapshot.purpose(),
                            Timestamp.from(snapshot.referenceCreatedAt()));
                }
                appendEvent(gateId, "PROPOSED", normalizedActor, proposal);
                return get(projectId, planId, gateId);
            });
        } catch (DuplicateKeyException error) {
            Map<String, Object> replay = findCreateReplay(projectId, normalizedActor, normalizedRequestId);
            if (replay != null && requestHash.equals(replay.get("request_hash"))) {
                return get(projectId, planId, (UUID) replay.get("id"));
            }
            throw new ProjectStateConflictException("An active Integration Gate already exists for this Schedule.");
        }
        if (result == null) throw new IllegalStateException("Integration Gate transaction returned no result");
        return result;
    }

    public IntegrationGateView confirm(
            UUID projectId, UUID planId, UUID gateId, String actor, String clientRequestId
    ) {
        return decide(projectId, planId, gateId, actor, clientRequestId, true, null);
    }

    public IntegrationGateView reject(
            UUID projectId, UUID planId, UUID gateId, String actor, String clientRequestId, String reason
    ) {
        return decide(projectId, planId, gateId, actor, clientRequestId, false, requireText(reason, "reason"));
    }

    private IntegrationGateView decide(
            UUID projectId, UUID planId, UUID gateId, String actor, String clientRequestId,
            boolean approve, String reason
    ) {
        String normalizedActor = requireText(actor, "actor");
        String normalizedRequestId = requireText(clientRequestId, "clientRequestId");
        String decision = approve ? "CONFIRM" : "REJECT";
        String decisionHash = sha256(gateId + "|" + decision + "|" + (reason == null ? "" : reason));
        Map<String, Object> replay = findDecisionReplay(projectId, normalizedActor, normalizedRequestId);
        if (replay != null) {
            if (!decisionHash.equals(replay.get("decision_hash"))) {
                throw new ProjectStateConflictException("clientRequestId was reused with a different Integration Gate decision.");
            }
            return get(projectId, planId, (UUID) replay.get("id"));
        }
        IntegrationGateView result;
        try {
            result = transactions.execute(status -> {
                Map<String, Object> row = lockGate(projectId, planId, gateId);
                if (!"PENDING_APPROVAL".equals(row.get("status"))) {
                    Map<String, Object> concurrent = findDecisionReplay(
                            projectId, normalizedActor, normalizedRequestId
                    );
                    if (concurrent != null
                            && gateId.equals(concurrent.get("id"))
                            && decisionHash.equals(concurrent.get("decision_hash"))) {
                        return get(projectId, planId, gateId);
                    }
                    throw new ProjectStateConflictException("Integration Gate Proposal is no longer pending.");
                }
                PlanSnapshot plan = lockPlan(projectId, planId);
                if (plan.stateRevision() != ((Number) row.get("base_state_revision")).longValue()
                        || plan.versionNumber() != ((Number) row.get("base_plan_version")).longValue()
                        || !plan.versionId().equals(row.get("plan_version_id"))) {
                    throw new StaleGateException(
                            "BASE_VERSION_CHANGED", "Integration Gate Proposal base version changed."
                    );
                }
                if (approve && "MISSING".equals(row.get("evidence_status"))) {
                    throw new ProjectStateConflictException("Integration Gate approval requires Evidence References.");
                }
                UUID scheduleId = (UUID) row.get("schedule_id");
                ScheduleSnapshot schedule = lockSchedule(projectId, planId, scheduleId);
                if (!"APPROVED".equals(schedule.status())
                        || !schedule.planVersionId().equals(row.get("plan_version_id"))
                        || schedule.baseStateRevision() != ((Number) row.get("base_state_revision")).longValue()
                        || schedule.basePlanVersion() != ((Number) row.get("base_plan_version")).longValue()) {
                    throw new StaleGateException(
                            "SCHEDULE_BASE_CHANGED", "Integration Gate Parallel Schedule changed."
                    );
                }
                if (schedule.assignmentCount() != 2 || schedule.provisionedCount() != 2) {
                    throw new StaleGateException(
                            "ASSIGNMENT_PROVISIONING_CHANGED",
                            "Integration Gate Schedule Assignments are no longer available."
                    );
                }
                if (approve && countEvidence(gateId) != ((Number) row.get("evidence_count")).intValue()) {
                    throw new StaleGateException(
                            "EVIDENCE_MANIFEST_INVALID", "Integration Gate Evidence manifest is incomplete."
                    );
                }
                Instant now = Instant.now();
                jdbc.update("""
                        UPDATE integration_gate_proposal
                        SET status = ?, decided_by = ?, decided_at = ?,
                            decision_request_id = ?, decision_hash = ?, decision_reason = ?
                        WHERE id = ? AND status = 'PENDING_APPROVAL'
                        """, approve ? "APPROVED" : "REJECTED", normalizedActor, Timestamp.from(now),
                        normalizedRequestId, decisionHash, reason, gateId);
                ObjectNode payload = json.createObjectNode()
                        .put("clientRequestId", normalizedRequestId)
                        .put("applyState", "NOT_ATTEMPTED");
                if (reason == null) payload.putNull("reason");
                else payload.put("reason", reason);
                appendEvent(gateId, approve ? "APPROVED" : "REJECTED", normalizedActor, payload);
                return get(projectId, planId, gateId);
            });
        } catch (StaleGateException error) {
            markStale(projectId, planId, gateId, normalizedActor, error.reasonCode(), error.getMessage());
            throw new ProjectStateConflictException(error.getMessage());
        } catch (DuplicateKeyException error) {
            Map<String, Object> concurrent = findDecisionReplay(projectId, normalizedActor, normalizedRequestId);
            if (concurrent != null && decisionHash.equals(concurrent.get("decision_hash"))) {
                return get(projectId, planId, (UUID) concurrent.get("id"));
            }
            throw new ProjectStateConflictException(
                    "clientRequestId was concurrently reused with a different Integration Gate decision."
            );
        }
        if (result == null) throw new IllegalStateException("Integration Gate decision returned no result");
        return result;
    }

    private Map<String, Object> findCreateReplay(UUID projectId, String actor, String requestId) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT id, request_hash FROM integration_gate_proposal
                WHERE project_id = ? AND created_by = ? AND client_request_id = ?
                """, projectId, actor, requestId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    private Map<String, Object> findDecisionReplay(UUID projectId, String actor, String requestId) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT id, decision_hash FROM integration_gate_proposal
                WHERE project_id = ? AND decided_by = ? AND decision_request_id = ?
                """, projectId, actor, requestId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    private Map<String, Object> lockGate(UUID projectId, UUID planId, UUID gateId) {
        try {
            return jdbc.queryForMap("""
                    SELECT id, project_id, plan_id, plan_version_id, schedule_id, status,
                           evidence_status, evidence_count, base_state_revision, base_plan_version
                    FROM integration_gate_proposal
                    WHERE id = ? AND project_id = ? AND plan_id = ?
                    FOR UPDATE
                    """, gateId, projectId, planId);
        } catch (EmptyResultDataAccessException error) {
            throw new ProjectStateConflictException("Integration Gate Proposal was not found for this Plan.");
        }
    }

    private PlanSnapshot lockPlan(UUID projectId, UUID planId) {
        try {
            Map<String, Object> row = jdbc.queryForMap("""
                    SELECT p.current_version_id, v.version_number, s.state_revision
                    FROM project_plan p
                    JOIN plan_version v ON v.id = p.current_version_id
                    JOIN project_state_snapshot s ON s.project_id = p.project_id
                    WHERE p.id = ? AND p.project_id = ? AND p.status = 'ACTIVE'
                    FOR UPDATE OF p
                    """, planId, projectId);
            return new PlanSnapshot(
                    (UUID) row.get("current_version_id"),
                    ((Number) row.get("version_number")).longValue(),
                    ((Number) row.get("state_revision")).longValue()
            );
        } catch (EmptyResultDataAccessException error) {
            throw new ProjectStateConflictException("Active Plan was not found for Integration Gate.");
        }
    }

    private ScheduleSnapshot lockSchedule(UUID projectId, UUID planId, UUID scheduleId) {
        try {
            Map<String, Object> row = jdbc.queryForMap("""
                    SELECT id, plan_id, plan_version_id, status,
                           base_state_revision, base_plan_version,
                           conflict_assessment::text AS conflict_assessment
                    FROM parallel_schedule_proposal
                    WHERE id = ? AND project_id = ? AND plan_id = ?
                    FOR UPDATE
                    """, scheduleId, projectId, planId);
            Integer assignmentCount = jdbc.queryForObject(
                    "SELECT count(*) FROM parallel_schedule_assignment WHERE schedule_id = ?", Integer.class, scheduleId);
            Integer provisionedCount = jdbc.queryForObject(
                    "SELECT count(*) FROM parallel_schedule_assignment WHERE schedule_id = ? AND status IN ('PROVISIONED', 'VERIFIED')",
                    Integer.class, scheduleId);
            List<String> workspaceKinds = jdbc.query("""
                    SELECT DISTINCT physical_workspace_kind FROM workspace_lease
                    WHERE schedule_id = ? ORDER BY physical_workspace_kind
                    """, (result, number) -> result.getString(1), scheduleId);
            if (workspaceKinds.size() != 1) {
                throw new ProjectStateConflictException(
                        "Parallel Schedule has inconsistent physical Workspace kinds."
                );
            }
            return new ScheduleSnapshot(
                    (UUID) row.get("id"), (UUID) row.get("plan_id"), (UUID) row.get("plan_version_id"),
                    String.valueOf(row.get("status")),
                    ((Number) row.get("base_state_revision")).longValue(),
                    ((Number) row.get("base_plan_version")).longValue(),
                    assignmentCount == null ? 0 : assignmentCount,
                    provisionedCount == null ? 0 : provisionedCount, workspaceKinds.get(0),
                    read((String) row.get("conflict_assessment"))
            );
        } catch (EmptyResultDataAccessException error) {
            throw new ProjectStateConflictException("Parallel Schedule was not found for Integration Gate.");
        }
    }

    private List<EvidenceSnapshot> loadEvidenceSnapshots(UUID projectId, List<UUID> evidenceIds) {
        if (evidenceIds.isEmpty()) return List.of();
        String placeholders = String.join(",", evidenceIds.stream().map(value -> "?").toList());
        List<Object> arguments = concat(projectId, evidenceIds);
        arguments.add(projectId);
        List<EvidenceSnapshot> found = jdbc.query(
                """
                        SELECT evidence_ref.id AS reference_id, evidence_ref.project_id, evidence_ref.artifact_id,
                               artifact.hash AS artifact_hash, evidence_ref.source_type, evidence_ref.source_id,
                               evidence_ref.purpose, evidence_ref.created_at AS reference_created_at
                        FROM evidence_reference evidence_ref
                        JOIN task_artifact artifact ON artifact.id = evidence_ref.artifact_id
                        JOIN agent_task task ON task.id = artifact.task_id
                        WHERE evidence_ref.project_id = ? AND evidence_ref.id IN (%s) AND task.project_id = ?
                        FOR SHARE OF evidence_ref, artifact, task
                        """.formatted(placeholders),
                (row, number) -> new EvidenceSnapshot(
                        row.getObject("reference_id", UUID.class), row.getObject("project_id", UUID.class),
                        row.getObject("artifact_id", UUID.class), row.getString("artifact_hash"),
                        row.getString("source_type"), row.getObject("source_id", UUID.class),
                        row.getString("purpose"), row.getTimestamp("reference_created_at").toInstant()
                ),
                arguments.toArray()
        );
        if (found.size() != evidenceIds.size()) {
            throw new ProjectStateConflictException(
                    "Integration Gate Evidence Reference or its Artifact is outside this project."
            );
        }
        List<EvidenceSnapshot> ordered = new ArrayList<>();
        for (UUID evidenceId : evidenceIds) {
            EvidenceSnapshot snapshot = found.stream()
                    .filter(candidate -> evidenceId.equals(candidate.referenceId()))
                    .findFirst()
                    .orElseThrow(() -> new ProjectStateConflictException(
                            "Integration Gate Evidence Reference could not be snapshotted."
                    ));
            ordered.add(snapshot);
        }
        return List.copyOf(ordered);
    }

    private ObjectNode proposal(ScheduleSnapshot schedule, List<UUID> evidenceIds) {
        ObjectNode proposal = json.createObjectNode()
                .put("proposalType", "INTEGRATION_GATE_V1")
                .put("gateMode", "EVIDENCE_ONLY")
                .put("applyState", "NOT_ATTEMPTED")
                .put("physicalWorkspaceKind", schedule.physicalWorkspaceKind())
                .put("evidenceStatus", evidenceIds.isEmpty() ? "MISSING" : "PRESENT");
        proposal.set("scheduleConflictAssessment", schedule.conflictAssessment());
        ArrayNode evidence = proposal.putArray("evidenceReferenceIds");
        evidenceIds.forEach(id -> evidence.add(id.toString()));
        return proposal;
    }

    private ObjectNode assessment(ScheduleSnapshot schedule, List<UUID> evidenceIds) {
        return json.createObjectNode()
                .put("schedulePrecheck", "PASSED")
                .put("scopeConflict", "PRECHECKED_DISJOINT")
                .put("automaticApply", false)
                .put("mergeAttempted", false)
                .put("buildAttempted", false)
                .put("testAttempted", false)
                .put("evidenceStatus", evidenceIds.isEmpty() ? "MISSING" : "PRESENT")
                .put("physicalWorkspaceKind", schedule.physicalWorkspaceKind())
                .put("scheduleId", schedule.scheduleId().toString());
    }

    private int countEvidence(UUID gateId) {
        Integer count = jdbc.queryForObject(
                "SELECT count(*) FROM integration_gate_evidence WHERE gate_id = ?", Integer.class, gateId
        );
        return count == null ? 0 : count;
    }

    private void markStale(
            UUID projectId, UUID planId, UUID gateId, String actor, String reasonCode, String reason
    ) {
        int updated = jdbc.update("""
                UPDATE integration_gate_proposal SET status = 'STALE', decided_by = ?, decided_at = now(),
                    decision_reason = ?
                WHERE id = ? AND project_id = ? AND plan_id = ? AND status = 'PENDING_APPROVAL'
                """, actor, reason, gateId, projectId, planId);
        if (updated == 1) appendEvent(gateId, "STALE", actor,
                json.createObjectNode().put("reason", reasonCode).put("detail", reason));
    }

    private List<UUID> normalizedEvidence(List<UUID> values) {
        if (values == null || values.isEmpty()) return List.of();
        if (values.size() > 100) throw new IllegalArgumentException("At most 100 Evidence References are allowed.");
        List<UUID> result = new ArrayList<>();
        for (UUID value : values) {
            if (value == null || result.contains(value)) throw new IllegalArgumentException("Evidence References must be unique and non-null.");
            result.add(value);
        }
        return List.copyOf(result);
    }

    private List<Object> concat(UUID projectId, List<UUID> values) {
        List<Object> args = new ArrayList<>();
        args.add(projectId);
        args.addAll(values);
        return args;
    }

    private void appendEvent(UUID gateId, String eventType, String actor, ObjectNode payload) {
        jdbc.update("""
                INSERT INTO integration_gate_event (gate_id, event_type, actor, payload)
                VALUES (?, ?, ?, CAST(? AS jsonb))
                """, gateId, eventType, actor, write(payload));
    }

    private String requireText(String value, String field) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(field + " is required");
        return value.trim();
    }

    private String nullable(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private Instant instant(Object value) {
        return value == null ? null : ((Timestamp) value).toInstant();
    }

    private JsonNode read(String value) {
        try {
            return json.readTree(value);
        } catch (JsonProcessingException error) {
            throw new IllegalStateException("Integration Gate JSON is unreadable", error);
        }
    }

    private String write(Object value) {
        try {
            return json.writeValueAsString(value);
        } catch (JsonProcessingException error) {
            throw new IllegalStateException("Integration Gate JSON serialization failed", error);
        }
    }

    private String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("SHA-256 is unavailable", error);
        }
    }

    private record PlanSnapshot(UUID versionId, long versionNumber, long stateRevision) {
    }

    private record ScheduleSnapshot(
            UUID scheduleId,
            UUID planId,
            UUID planVersionId,
            String status,
            long baseStateRevision,
            long basePlanVersion,
            int assignmentCount,
            int provisionedCount,
            String physicalWorkspaceKind,
            JsonNode conflictAssessment
    ) {
    }

    private record EvidenceSnapshot(
            UUID referenceId,
            UUID projectId,
            UUID artifactId,
            String artifactHash,
            String sourceType,
            UUID sourceId,
            String purpose,
            Instant referenceCreatedAt
    ) {
    }

    private static final class StaleGateException extends RuntimeException {
        private final String reasonCode;

        private StaleGateException(String reasonCode, String message) {
            super(message);
            this.reasonCode = reasonCode;
        }

        private String reasonCode() {
            return reasonCode;
        }
    }
}
