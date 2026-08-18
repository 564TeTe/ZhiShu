package com.zhishu.state;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

@Service
public class ProjectStateService {

    private static final List<String> ENTRY_TYPES = List.of(
            "GOAL", "STAGE", "FACT", "DECISION", "CONSTRAINT", "DISCOVERY", "RISK", "ASSUMPTION"
    );
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    private final ObjectMapper json;

    public ProjectStateService(JdbcTemplate jdbc, TransactionTemplate transactions, ObjectMapper json) {
        this.jdbc = jdbc;
        this.transactions = transactions;
        this.json = json;
    }

    public ProjectStateSnapshotView getSnapshot(UUID projectId) {
        ensureSnapshot(projectId);
        Map<String, Object> snapshot;
        try {
            snapshot = jdbc.queryForMap("""
                    SELECT project_id, state_revision, goal_entry_id, stage_entry_id,
                           summary, blocker, updated_at
                    FROM project_state_snapshot WHERE project_id = ?
                    """, projectId);
        } catch (EmptyResultDataAccessException error) {
            throw new ProjectStateConflictException("Project was not found.");
        }
        List<StateEntryView> entries = jdbc.query(ENTRY_SELECT + """
                WHERE e.project_id = ? AND e.status = 'ACTIVE'
                ORDER BY e.created_revision DESC, e.created_at DESC
                """, this::mapEntry, projectId);
        UUID goalId = (UUID) snapshot.get("goal_entry_id");
        UUID stageId = (UUID) snapshot.get("stage_entry_id");
        return new ProjectStateSnapshotView(
                "1.0", projectId, ((Number) snapshot.get("state_revision")).longValue(),
                findEntry(entries, goalId), findEntry(entries, stageId),
                (String) snapshot.get("summary"), (String) snapshot.get("blocker"),
                List.copyOf(entries), ((Timestamp) snapshot.get("updated_at")).toInstant()
        );
    }

    public ProjectStateProposalView createInitialProposal(
            UUID projectId,
            String actor,
            JsonNode payload
    ) {
        String normalizedActor = requireText(actor, "actor");
        validateInitialPayload(payload);
        ProjectStateSnapshotView snapshot = getSnapshot(projectId);
        if (snapshot.stateRevision() != 0) {
            throw new ProjectStateConflictException("Initial State is already established.");
        }
        UUID proposalId = UUID.randomUUID();
        Instant now = Instant.now();
        ObjectNode validation = json.createObjectNode().put("valid", true).put("schemaVersion", "1.0");
        jdbc.update("""
                INSERT INTO project_state_proposal (
                    id, project_id, proposal_type, status, base_state_revision, payload,
                    validation_result, source_type, source_id, created_by, created_at, updated_at
                ) VALUES (?, ?, 'INITIAL_STATE', 'PENDING_APPROVAL', 0, CAST(? AS jsonb),
                          CAST(? AS jsonb), 'USER_INPUT', ?, ?, ?, ?)
                """, proposalId, projectId, write(payload), write(validation),
                proposalId.toString(), normalizedActor, Timestamp.from(now), Timestamp.from(now));
        return findProposal(proposalId);
    }

    public ProjectStateProposalView getProposal(UUID projectId, UUID proposalId) {
        try {
            return jdbc.queryForObject(PROPOSAL_SELECT + " WHERE id = ? AND project_id = ?",
                    this::mapProposal, proposalId, projectId);
        } catch (EmptyResultDataAccessException error) {
            throw new ProjectStateConflictException("State proposal was not found.");
        }
    }

    public List<ProjectStateProposalView> listProposals(UUID projectId, String proposalType, int limit) {
        int boundedLimit = Math.max(1, Math.min(limit, 100));
        String normalizedType = proposalType == null || proposalType.isBlank()
                ? null : proposalType.trim().toUpperCase();
        if (normalizedType != null && !List.of("INITIAL_STATE", "STATE_CHANGE").contains(normalizedType)) {
            throw new IllegalArgumentException("Unsupported State proposal type.");
        }
        return jdbc.query(PROPOSAL_SELECT + """
                WHERE project_id = ? AND (? IS NULL OR proposal_type = ?)
                ORDER BY created_at DESC LIMIT ?
                """, this::mapProposal, projectId, normalizedType, normalizedType, boundedLimit);
    }

    public ProjectChangeView confirmProposal(
            UUID projectId,
            UUID proposalId,
            String actor,
            String clientRequestId
    ) {
        String normalizedActor = requireText(actor, "actor");
        String normalizedRequestId = requireText(clientRequestId, "clientRequestId");
        String requestHash = sha256(projectId + "|" + proposalId + "|CONFIRM");
        ProjectChangeView result = transactions.execute(status -> confirmInTransaction(
                projectId, proposalId, normalizedActor, normalizedRequestId, requestHash
        ));
        if (result == null) throw new IllegalStateException("State transaction returned no result");
        return result;
    }

    public ProjectChangeView rejectProposal(
            UUID projectId,
            UUID proposalId,
            String actor,
            String clientRequestId,
            String reason
    ) {
        String normalizedActor = requireText(actor, "actor");
        String normalizedRequestId = requireText(clientRequestId, "clientRequestId");
        String normalizedReason = requireText(reason, "reason");
        String requestHash = sha256(projectId + "|" + proposalId + "|REJECT|" + normalizedReason);
        ProjectChangeView result = transactions.execute(status -> {
            ProjectChangeView replay = findReplay(
                    projectId, normalizedActor, normalizedRequestId, requestHash
            ).orElse(null);
            if (replay != null) return replay;
            ProjectStateProposalView proposal = findProposalForUpdate(projectId, proposalId);
            if (!"PENDING_APPROVAL".equals(proposal.status())) {
                throw new ProjectStateConflictException("State proposal is no longer pending approval.");
            }
            Map<String, Object> snapshot = lockSnapshot(projectId);
            long revision = ((Number) snapshot.get("state_revision")).longValue();
            Instant now = Instant.now();
            jdbc.update("""
                    UPDATE project_state_proposal
                    SET status = 'REJECTED', decided_by = ?, decided_at = ?, updated_at = ?
                    WHERE id = ?
                    """, normalizedActor, Timestamp.from(now), Timestamp.from(now), proposalId);
            ObjectNode payload = json.createObjectNode()
                    .put("proposalId", proposalId.toString())
                    .put("proposalType", proposal.proposalType())
                    .put("reason", normalizedReason);
            UUID changeId = UUID.randomUUID();
            jdbc.update("""
                    INSERT INTO project_change_log (
                        id, project_id, change_type, actor, source_type, source_id,
                        client_request_id, request_hash, before_revision, after_revision, payload, occurred_at
                    ) VALUES (?, ?, 'STATE_PROPOSAL_REJECTED', ?, 'STATE_PROPOSAL', ?, ?, ?, ?, ?,
                              CAST(? AS jsonb), ?)
                    """, changeId, projectId, normalizedActor, proposalId.toString(), normalizedRequestId,
                    requestHash, revision, revision, write(payload), Timestamp.from(now));
            return new ProjectChangeView(changeId, projectId, "STATE_PROPOSAL_REJECTED", normalizedActor,
                    "STATE_PROPOSAL", proposalId.toString(), revision, revision, payload, now);
        });
        if (result == null) throw new IllegalStateException("State rejection transaction returned no result");
        return result;
    }

    public List<ProjectChangeView> listChanges(UUID projectId, long afterRevision, int limit) {
        int boundedLimit = Math.max(1, Math.min(limit, 100));
        return jdbc.query("""
                SELECT id, project_id, change_type, actor, source_type, source_id,
                       before_revision, after_revision, payload, occurred_at
                FROM project_change_log
                WHERE project_id = ? AND after_revision > ?
                ORDER BY after_revision, occurred_at
                LIMIT ?
                """, this::mapChange, projectId, afterRevision, boundedLimit);
    }

    public ContextPackageView generateContext(UUID projectId, String packageType) {
        if (!"BRAIN".equals(packageType) && !"PLANNER".equals(packageType)) {
            throw new IllegalArgumentException("packageType must be BRAIN or PLANNER");
        }
        ProjectStateSnapshotView state = getSnapshot(projectId);
        Map<String, Object> project;
        try {
            project = jdbc.queryForMap("""
                    SELECT id AS "projectId", name AS "displayName", repository_identity AS "repositoryIdentity",
                           status, identity_version AS "identityVersion"
                    FROM project WHERE id = ?
                    """, projectId);
        } catch (EmptyResultDataAccessException error) {
            throw new ProjectStateConflictException("Project was not found.");
        }
        Long watermark = jdbc.queryForObject("""
                SELECT COALESCE(max(te.id), 0)
                FROM task_event te JOIN agent_task t ON t.id = te.task_id
                WHERE t.project_id = ?
                """, Long.class, projectId);
        Long planVersion = jdbc.queryForObject("""
                SELECT v.version_number
                FROM project_state_snapshot s
                LEFT JOIN project_plan p ON p.id = s.current_plan_id
                LEFT JOIN plan_version v ON v.id = p.current_version_id
                WHERE s.project_id = ?
                """, Long.class, projectId);
        Map<String, Object> activePlan = null;
        try {
            Map<String, Object> planRow = jdbc.queryForMap("""
                    SELECT p.id, p.name, p.current_version_id, v.version_number, v.objective
                    FROM project_state_snapshot s
                    JOIN project_plan p ON p.id = s.current_plan_id
                    JOIN plan_version v ON v.id = p.current_version_id
                    WHERE s.project_id = ?
                    """, projectId);
            activePlan = new LinkedHashMap<>();
            activePlan.put("planId", planRow.get("id"));
            activePlan.put("name", planRow.get("name"));
            activePlan.put("versionNumber", planRow.get("version_number"));
            activePlan.put("objective", planRow.get("objective"));
            UUID activeVersionId = (UUID) planRow.get("current_version_id");
            List<Map<String, Object>> planNodes = jdbc.query("""
                    SELECT n.node_key, n.title, n.objective, s.state
                    FROM plan_node_definition n
                    LEFT JOIN plan_execution_state s ON s.plan_id = ? AND s.node_key = n.node_key
                    WHERE n.plan_version_id = ? ORDER BY n.priority DESC, n.node_key
                    """, (row, number) -> Map.of(
                    "nodeKey", row.getString("node_key"),
                    "title", row.getString("title"),
                    "objective", row.getString("objective"),
                    "executionState", row.getString("state")
            ), planRow.get("id"), activeVersionId);
            activePlan.put("nodes", planNodes);
        } catch (EmptyResultDataAccessException ignored) {
            // A project can legitimately have no published Plan yet.
        }
        List<Map<String, Object>> facts = derivedSystemFacts(projectId);
        List<ProjectChangeView> changes = listRecentChanges(projectId, 20);
        Instant generatedAt = Instant.now();
        UUID packageId = UUID.randomUUID();
        ContextPackageView value = new ContextPackageView(
                packageId, packageType,
                new ContextPackageView.CompositeContextVersion(
                        state.stateRevision(), planVersion, watermark == null ? 0 : watermark,
                        generatedAt, "1.0"
                ),
                Collections.unmodifiableMap(new LinkedHashMap<>(project)), state,
                activePlan == null ? null : Collections.unmodifiableMap(activePlan),
                entriesOfType(state, "DECISION"), entriesOfType(state, "CONSTRAINT"),
                entriesOfType(state, "RISK"), changes, facts,
                Map.of("truncated", false, "entryLimit", 100, "changeLimit", 20)
        );
        jdbc.update("""
                INSERT INTO project_context_package_archive (
                    id, project_id, package_type, state_revision, plan_version,
                    execution_watermark, generated_at, payload, truncation
                ) VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS jsonb), CAST(? AS jsonb))
                """, packageId, projectId, packageType, state.stateRevision(),
                planVersion, watermark == null ? 0 : watermark, Timestamp.from(generatedAt),
                write(value), write(value.truncation()));
        return value;
    }

    public Optional<ContextPackageView> getContext(UUID projectId, UUID packageId) {
        try {
            String payload = jdbc.queryForObject("""
                    SELECT payload::text FROM project_context_package_archive
                    WHERE id = ? AND project_id = ?
                    """, String.class, packageId, projectId);
            return Optional.of(json.readValue(payload, ContextPackageView.class));
        } catch (EmptyResultDataAccessException error) {
            return Optional.empty();
        } catch (JsonProcessingException error) {
            throw new IllegalStateException("Archived context package is unreadable", error);
        }
    }

    /** Reduces a Verification-Gate-approved report into one idempotent SYSTEM_VERIFIED Fact. */
    public VerifiedExecutionFact recordVerifiedExecutionFact(
            UUID projectId,
            UUID reportId,
            UUID workOrderId,
            String actor,
            String title,
            String content,
            List<UUID> artifactIds
    ) {
        VerifiedExecutionFact result = transactions.execute(status -> {
            List<Map<String, Object>> existing = jdbc.query("""
                    SELECT id, created_revision FROM project_state_entry
                    WHERE project_id = ? AND source_type = 'EXECUTION_REPORT' AND source_id = ?
                    """, (row, number) -> Map.of(
                    "id", row.getObject("id", UUID.class),
                    "revision", row.getLong("created_revision")
            ), projectId, reportId.toString());
            if (!existing.isEmpty()) {
                Map<String, Object> value = existing.get(0);
                return new VerifiedExecutionFact(
                        (UUID) value.get("id"), ((Number) value.get("revision")).longValue(), true
                );
            }
            Map<String, Object> snapshot = lockSnapshot(projectId);
            long beforeRevision = ((Number) snapshot.get("state_revision")).longValue();
            long afterRevision = beforeRevision + 1;
            UUID entryId = UUID.randomUUID();
            Instant now = Instant.now();
            jdbc.update("""
                    INSERT INTO project_state_entry (
                        id, project_id, entry_type, title, content, authority_level,
                        source_type, source_id, created_by, rationale, observed_at, confirmed_at,
                        status, created_revision, created_at, updated_at
                    ) VALUES (?, ?, 'FACT', ?, ?, 'SYSTEM_VERIFIED', 'EXECUTION_REPORT', ?, ?,
                              'Runtime-observed evidence passed the explicit Verification Gate.', ?, ?,
                              'ACTIVE', ?, ?, ?)
                    """, entryId, projectId, requireText(title, "title"), requireText(content, "content"),
                    reportId.toString(), requireText(actor, "actor"), Timestamp.from(now), Timestamp.from(now),
                    afterRevision, Timestamp.from(now), Timestamp.from(now));
            for (UUID artifactId : artifactIds.stream().distinct().toList()) {
                Integer count = jdbc.queryForObject("""
                        SELECT count(*) FROM task_artifact a
                        JOIN agent_task t ON t.id = a.task_id
                        WHERE a.id = ? AND t.project_id = ?
                        """, Integer.class, artifactId, projectId);
                if (count == null || count != 1) {
                    throw new IllegalArgumentException("Execution evidence does not belong to this project: " + artifactId);
                }
                jdbc.update("""
                        INSERT INTO evidence_reference (
                            id, project_id, artifact_id, source_type, source_id, purpose, created_by
                        ) VALUES (?, ?, ?, 'EXECUTION_REPORT', ?, 'VERIFICATION_GATE', ?)
                        ON CONFLICT (source_type, source_id, artifact_id) DO NOTHING
                        """, UUID.randomUUID(), projectId, artifactId, reportId, actor.trim());
                UUID evidenceId = jdbc.queryForObject("""
                        SELECT id FROM evidence_reference
                        WHERE source_type = 'EXECUTION_REPORT' AND source_id = ? AND artifact_id = ?
                        """, UUID.class, reportId, artifactId);
                jdbc.update("""
                        INSERT INTO project_state_entry_evidence (entry_id, evidence_reference_id)
                        VALUES (?, ?) ON CONFLICT DO NOTHING
                        """, entryId, evidenceId);
            }
            int updated = jdbc.update("""
                    UPDATE project_state_snapshot SET state_revision = ?, updated_at = now()
                    WHERE project_id = ? AND state_revision = ?
                    """, afterRevision, projectId, beforeRevision);
            if (updated != 1) throw new ProjectStateConflictException(
                    "Project State changed during execution reduction.");
            ObjectNode payload = json.createObjectNode()
                    .put("workOrderId", workOrderId.toString())
                    .put("reportId", reportId.toString())
                    .put("stateEntryId", entryId.toString())
                    .put("authorityLevel", "SYSTEM_VERIFIED")
                    .put("evidenceCount", artifactIds.stream().distinct().count());
            jdbc.update("""
                    INSERT INTO project_change_log (
                        id, project_id, change_type, actor, source_type, source_id,
                        client_request_id, request_hash, before_revision, after_revision, payload, occurred_at
                    ) VALUES (?, ?, 'VERIFIED_EXECUTION_REDUCED', ?, 'EXECUTION_REPORT', ?, ?, ?, ?, ?,
                              CAST(? AS jsonb), ?)
                    """, UUID.randomUUID(), projectId, actor.trim(), reportId.toString(),
                    "execution-report:" + reportId, sha256(projectId + "|" + reportId + "|VERIFIED"),
                    beforeRevision, afterRevision, write(payload), Timestamp.from(now));
            return new VerifiedExecutionFact(entryId, afterRevision, false);
        });
        if (result == null) throw new IllegalStateException("Execution Fact reducer returned no result");
        return result;
    }

    private ProjectChangeView confirmInTransaction(
            UUID projectId,
            UUID proposalId,
            String actor,
            String clientRequestId,
            String requestHash
    ) {
        ProjectChangeView replay = findReplay(projectId, actor, clientRequestId, requestHash).orElse(null);
        if (replay != null) return replay;
        ProjectStateProposalView proposal = findProposalForUpdate(projectId, proposalId);
        if (!"PENDING_APPROVAL".equals(proposal.status())) {
            throw new ProjectStateConflictException("State proposal is no longer pending approval.");
        }
        Map<String, Object> snapshot = lockSnapshot(projectId);
        long beforeRevision = ((Number) snapshot.get("state_revision")).longValue();
        if (beforeRevision != proposal.baseStateRevision()) {
            jdbc.update("UPDATE project_state_proposal SET status = 'STALE', updated_at = now() WHERE id = ?", proposalId);
            throw new ProjectStateConflictException("State proposal is stale.");
        }
        if ("STATE_CHANGE".equals(proposal.proposalType())) {
            return applyStateChangeProposal(projectId, proposal, actor, clientRequestId, requestHash, beforeRevision);
        }
        long afterRevision = beforeRevision + 1;
        JsonNode payload = proposal.payload();
        UUID goalId = insertEntry(projectId, "GOAL", payload.path("goal").asText(), payload.path("goal").asText(),
                payload.path("goalRationale").asText(null), proposalId, actor, afterRevision, List.of());
        UUID stageId = insertEntry(projectId, "STAGE", payload.path("stage").asText(), payload.path("stage").asText(),
                payload.path("stageRationale").asText(null), proposalId, actor, afterRevision, List.of());
        insertArrayEntries(projectId, proposalId, actor, afterRevision, "DECISION", payload.path("decisions"));
        insertArrayEntries(projectId, proposalId, actor, afterRevision, "CONSTRAINT", payload.path("constraints"));
        insertArrayEntries(projectId, proposalId, actor, afterRevision, "RISK", payload.path("risks"));
        jdbc.update("""
                UPDATE project_state_snapshot
                SET state_revision = ?, goal_entry_id = ?, stage_entry_id = ?, summary = ?, blocker = ?, updated_at = now()
                WHERE project_id = ? AND state_revision = ?
                """, afterRevision, goalId, stageId, nullableText(payload, "summary"),
                nullableText(payload, "blocker"), projectId, beforeRevision);
        Instant now = Instant.now();
        jdbc.update("""
                UPDATE project_state_proposal
                SET status = 'APPLIED', decided_by = ?, decided_at = ?, applied_revision = ?, updated_at = ?
                WHERE id = ?
                """, actor, Timestamp.from(now), afterRevision, Timestamp.from(now), proposalId);
        UUID changeId = UUID.randomUUID();
        ObjectNode changePayload = json.createObjectNode()
                .put("proposalId", proposalId.toString())
                .put("proposalType", proposal.proposalType())
                .put("schemaVersion", proposal.schemaVersion());
        jdbc.update("""
                INSERT INTO project_change_log (
                    id, project_id, change_type, actor, source_type, source_id,
                    client_request_id, request_hash, before_revision, after_revision, payload, occurred_at
                ) VALUES (?, ?, 'INITIAL_STATE_APPLIED', ?, 'STATE_PROPOSAL', ?, ?, ?, ?, ?, CAST(? AS jsonb), ?)
                """, changeId, projectId, actor, proposalId.toString(), clientRequestId, requestHash,
                beforeRevision, afterRevision, write(changePayload), Timestamp.from(now));
        return new ProjectChangeView(changeId, projectId, "INITIAL_STATE_APPLIED", actor,
                "STATE_PROPOSAL", proposalId.toString(), beforeRevision, afterRevision, changePayload, now);
    }

    private ProjectChangeView applyStateChangeProposal(
            UUID projectId,
            ProjectStateProposalView proposal,
            String actor,
            String clientRequestId,
            String requestHash,
            long beforeRevision
    ) {
        JsonNode candidates = proposal.payload().path("candidates");
        if (!candidates.isArray()) throw new ProjectStateConflictException("State Steward proposal has no candidates.");
        int appliedCount = 0;
        int skippedCount = 0;
        for (JsonNode candidate : candidates) {
            if (!"NEW".equals(candidate.path("disposition").asText())) {
                skippedCount += 1;
                continue;
            }
            String entryType = requireText(candidate.path("entryType").asText(), "candidate.entryType");
            if (!List.of("DISCOVERY", "DECISION", "CONSTRAINT", "RISK").contains(entryType)) {
                throw new ProjectStateConflictException("State Steward cannot apply this entry type.");
            }
            List<UUID> evidenceIds = new ArrayList<>();
            JsonNode evidence = candidate.path("evidenceReferenceIds");
            if (evidence.isArray()) evidence.forEach(item -> evidenceIds.add(UUID.fromString(item.asText())));
            insertEntry(projectId, entryType, candidate.path("title").asText(), candidate.path("content").asText(),
                    candidate.path("rationale").asText(null), proposal.proposalId(), actor, beforeRevision + 1, evidenceIds);
            appliedCount += 1;
        }
        long afterRevision = appliedCount == 0 ? beforeRevision : beforeRevision + 1;
        if (appliedCount > 0) {
            int updated = jdbc.update("""
                    UPDATE project_state_snapshot SET state_revision = ?, updated_at = now()
                    WHERE project_id = ? AND state_revision = ?
                    """, afterRevision, projectId, beforeRevision);
            if (updated != 1) throw new ProjectStateConflictException("Project State changed during Steward approval.");
        }
        Instant now = Instant.now();
        jdbc.update("""
                UPDATE project_state_proposal
                SET status = 'APPLIED', decided_by = ?, decided_at = ?, applied_revision = ?, updated_at = ?
                WHERE id = ?
                """, actor, Timestamp.from(now), afterRevision, Timestamp.from(now), proposal.proposalId());
        ObjectNode changePayload = json.createObjectNode()
                .put("proposalId", proposal.proposalId().toString())
                .put("reportId", proposal.sourceId())
                .put("roleVersion", "state-steward:v1")
                .put("appliedCount", appliedCount)
                .put("skippedCount", skippedCount);
        UUID changeId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO project_change_log (
                    id, project_id, change_type, actor, source_type, source_id,
                    client_request_id, request_hash, before_revision, after_revision, payload, occurred_at
                ) VALUES (?, ?, 'STATE_CHANGE_APPLIED', ?, 'STATE_PROPOSAL', ?, ?, ?, ?, ?, CAST(? AS jsonb), ?)
                """, changeId, projectId, actor, proposal.proposalId().toString(), clientRequestId, requestHash,
                beforeRevision, afterRevision, write(changePayload), Timestamp.from(now));
        return new ProjectChangeView(changeId, projectId, "STATE_CHANGE_APPLIED", actor,
                "STATE_PROPOSAL", proposal.proposalId().toString(), beforeRevision, afterRevision, changePayload, now);
    }

    private void insertArrayEntries(
            UUID projectId,
            UUID proposalId,
            String actor,
            long revision,
            String entryType,
            JsonNode values
    ) {
        if (!values.isArray()) return;
        for (JsonNode value : values) {
            List<UUID> evidenceIds = new ArrayList<>();
            if (value.path("evidenceReferenceIds").isArray()) {
                value.path("evidenceReferenceIds").forEach(item -> evidenceIds.add(UUID.fromString(item.asText())));
            }
            insertEntry(projectId, entryType, value.path("title").asText(), value.path("content").asText(),
                    value.path("rationale").asText(null), proposalId, actor, revision, evidenceIds);
        }
    }

    private UUID insertEntry(
            UUID projectId,
            String entryType,
            String title,
            String content,
            String rationale,
            UUID proposalId,
            String actor,
            long revision,
            List<UUID> evidenceIds
    ) {
        UUID entryId = UUID.randomUUID();
        Instant now = Instant.now();
        jdbc.update("""
                INSERT INTO project_state_entry (
                    id, project_id, entry_type, title, content, authority_level,
                    source_type, source_id, created_by, rationale, confirmed_at,
                    status, created_revision, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, 'USER_CONFIRMED', 'STATE_PROPOSAL', ?, ?, ?, ?,
                          'ACTIVE', ?, ?, ?)
                """, entryId, projectId, entryType, requireText(title, "entry.title"),
                requireText(content, "entry.content"), proposalId.toString(), actor, rationale,
                Timestamp.from(now), revision, Timestamp.from(now), Timestamp.from(now));
        for (UUID evidenceId : evidenceIds) {
            Integer count = jdbc.queryForObject("""
                    SELECT count(*) FROM evidence_reference WHERE id = ? AND project_id = ?
                    """, Integer.class, evidenceId, projectId);
            if (count == null || count != 1) {
                throw new IllegalArgumentException("Evidence Reference does not belong to this project: " + evidenceId);
            }
            jdbc.update("INSERT INTO project_state_entry_evidence (entry_id, evidence_reference_id) VALUES (?, ?)",
                    entryId, evidenceId);
        }
        return entryId;
    }

    private List<Map<String, Object>> derivedSystemFacts(UUID projectId) {
        Map<String, Object> counts = jdbc.queryForMap("""
                SELECT count(*) FILTER (WHERE archived_at IS NULL) AS "taskCount",
                       count(*) FILTER (WHERE archived_at IS NULL AND status IN ('PENDING','STARTING','RUNNING','WAITING_APPROVAL','CANCELLING')) AS "activeTaskCount",
                       count(*) FILTER (WHERE archived_at IS NULL AND status = 'SUCCEEDED') AS "succeededTaskCount",
                       count(*) FILTER (WHERE archived_at IS NULL AND status = 'FAILED') AS "failedTaskCount"
                FROM agent_task WHERE project_id = ?
                """, projectId);
        Long artifacts = jdbc.queryForObject("""
                SELECT count(*) FROM task_artifact a JOIN agent_task t ON t.id = a.task_id WHERE t.project_id = ?
                """, Long.class, projectId);
        Map<String, Object> taskFact = new LinkedHashMap<>(counts);
        taskFact.put("factType", "EXECUTION_TASK_COUNTS");
        taskFact.put("authorityLevel", "SYSTEM_VERIFIED");
        taskFact.put("sourceType", "CONTROL_PLANE_QUERY");
        Map<String, Object> artifactFact = new LinkedHashMap<>();
        artifactFact.put("factType", "ARTIFACT_COUNT");
        artifactFact.put("artifactCount", artifacts == null ? 0 : artifacts);
        artifactFact.put("authorityLevel", "SYSTEM_VERIFIED");
        artifactFact.put("sourceType", "CONTROL_PLANE_QUERY");
        return List.of(Map.copyOf(taskFact), Map.copyOf(artifactFact));
    }

    private List<ProjectChangeView> listRecentChanges(UUID projectId, int limit) {
        return jdbc.query("""
                SELECT id, project_id, change_type, actor, source_type, source_id,
                       before_revision, after_revision, payload, occurred_at
                FROM project_change_log WHERE project_id = ?
                ORDER BY after_revision DESC, occurred_at DESC LIMIT ?
                """, this::mapChange, projectId, limit);
    }

    private List<StateEntryView> entriesOfType(ProjectStateSnapshotView state, String type) {
        return state.entries().stream().filter(entry -> type.equals(entry.entryType())).toList();
    }

    private void ensureSnapshot(UUID projectId) {
        int inserted = jdbc.update("""
                INSERT INTO project_state_snapshot (project_id)
                SELECT id FROM project WHERE id = ?
                ON CONFLICT (project_id) DO NOTHING
                """, projectId);
        Integer count = jdbc.queryForObject("SELECT count(*) FROM project_state_snapshot WHERE project_id = ?",
                Integer.class, projectId);
        if (inserted == 0 && (count == null || count == 0)) {
            throw new ProjectStateConflictException("Project was not found.");
        }
    }

    private Map<String, Object> lockSnapshot(UUID projectId) {
        try {
            return jdbc.queryForMap("SELECT state_revision FROM project_state_snapshot WHERE project_id = ? FOR UPDATE", projectId);
        } catch (EmptyResultDataAccessException error) {
            throw new ProjectStateConflictException("Project State snapshot was not found.");
        }
    }

    private ProjectStateProposalView findProposal(UUID proposalId) {
        try {
            return jdbc.queryForObject(PROPOSAL_SELECT + " WHERE id = ?", this::mapProposal, proposalId);
        } catch (EmptyResultDataAccessException error) {
            throw new ProjectStateConflictException("State proposal was not found.");
        }
    }

    private ProjectStateProposalView findProposalForUpdate(UUID projectId, UUID proposalId) {
        try {
            return jdbc.queryForObject(PROPOSAL_SELECT + " WHERE id = ? AND project_id = ? FOR UPDATE",
                    this::mapProposal, proposalId, projectId);
        } catch (EmptyResultDataAccessException error) {
            throw new ProjectStateConflictException("State proposal was not found.");
        }
    }

    private Optional<ProjectChangeView> findReplay(
            UUID projectId,
            String actor,
            String clientRequestId,
            String requestHash
    ) {
        try {
            return Optional.ofNullable(jdbc.queryForObject("""
                    SELECT id, project_id, change_type, actor, source_type, source_id,
                           before_revision, after_revision, payload, occurred_at, request_hash
                    FROM project_change_log
                    WHERE project_id = ? AND actor = ? AND client_request_id = ?
                    """, (row, rowNumber) -> {
                        if (!requestHash.equals(row.getString("request_hash"))) {
                            throw new ProjectStateConflictException("clientRequestId was reused with different content.");
                        }
                        return mapChange(row, rowNumber);
                    }, projectId, actor, clientRequestId));
        } catch (EmptyResultDataAccessException error) {
            return Optional.empty();
        }
    }

    private StateEntryView mapEntry(ResultSet row, int rowNumber) throws SQLException {
        UUID entryId = row.getObject("id", UUID.class);
        List<UUID> evidence = jdbc.query("""
                SELECT evidence_reference_id FROM project_state_entry_evidence
                WHERE entry_id = ? ORDER BY evidence_reference_id
                """, (evidenceRow, evidenceNumber) -> evidenceRow.getObject(1, UUID.class), entryId);
        return new StateEntryView(
                entryId, row.getString("entry_type"), row.getString("title"), row.getString("content"),
                row.getString("authority_level"), row.getString("source_type"), row.getString("source_id"),
                row.getString("created_by"), row.getString("rationale"), instant(row, "observed_at"),
                instant(row, "confirmed_at"), row.getString("status"), row.getObject("supersedes_id", UUID.class),
                row.getLong("created_revision"), List.copyOf(evidence), row.getTimestamp("created_at").toInstant()
        );
    }

    private ProjectStateProposalView mapProposal(ResultSet row, int rowNumber) throws SQLException {
        return new ProjectStateProposalView(
                row.getObject("id", UUID.class), row.getObject("project_id", UUID.class),
                row.getString("schema_version"), row.getString("proposal_type"), row.getString("status"),
                row.getLong("base_state_revision"), readJson(row.getString("payload")),
                readJson(row.getString("validation_result")), row.getString("source_type"),
                row.getString("source_id"), row.getString("created_by"), row.getTimestamp("created_at").toInstant(),
                row.getString("decided_by"), instant(row, "decided_at"),
                row.getObject("applied_revision") == null ? null : row.getLong("applied_revision")
        );
    }

    private ProjectChangeView mapChange(ResultSet row, int rowNumber) throws SQLException {
        return new ProjectChangeView(
                row.getObject("id", UUID.class), row.getObject("project_id", UUID.class),
                row.getString("change_type"), row.getString("actor"), row.getString("source_type"),
                row.getString("source_id"), row.getLong("before_revision"), row.getLong("after_revision"),
                readJson(row.getString("payload")), row.getTimestamp("occurred_at").toInstant()
        );
    }

    private StateEntryView findEntry(List<StateEntryView> entries, UUID id) {
        if (id == null) return null;
        return entries.stream().filter(entry -> id.equals(entry.entryId())).findFirst().orElse(null);
    }

    private void validateInitialPayload(JsonNode payload) {
        if (payload == null || !payload.isObject()) throw new IllegalArgumentException("payload is required");
        requireText(payload.path("goal").asText(), "goal");
        requireText(payload.path("stage").asText(), "stage");
        for (String field : List.of("decisions", "constraints", "risks")) {
            JsonNode values = payload.path(field);
            if (!values.isMissingNode() && !values.isArray()) throw new IllegalArgumentException(field + " must be an array");
            if (values.isArray()) for (JsonNode value : values) {
                requireText(value.path("title").asText(), field + ".title");
                requireText(value.path("content").asText(), field + ".content");
            }
        }
    }

    private String nullableText(JsonNode node, String field) {
        String value = node.path(field).asText("").trim();
        return value.isEmpty() ? null : value;
    }

    private String requireText(String value, String field) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(field + " is required");
        return value.trim();
    }

    private String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("SHA-256 is unavailable", error);
        }
    }

    private String write(Object value) {
        try {
            return json.writeValueAsString(value);
        } catch (JsonProcessingException error) {
            throw new IllegalArgumentException("JSON serialization failed", error);
        }
    }

    private JsonNode readJson(String value) {
        try {
            return json.readTree(value);
        } catch (JsonProcessingException error) {
            throw new IllegalStateException("Stored JSON is unreadable", error);
        }
    }

    private Instant instant(ResultSet row, String column) throws SQLException {
        Timestamp value = row.getTimestamp(column);
        return value == null ? null : value.toInstant();
    }

    private static final String ENTRY_SELECT = """
            SELECT e.id, e.entry_type, e.title, e.content, e.authority_level,
                   e.source_type, e.source_id, e.created_by, e.rationale,
                   e.observed_at, e.confirmed_at, e.status, e.supersedes_id,
                   e.created_revision, e.created_at
            FROM project_state_entry e
            """;

    private static final String PROPOSAL_SELECT = """
            SELECT id, project_id, schema_version, proposal_type, status,
                   base_state_revision, payload::text AS payload,
                   validation_result::text AS validation_result,
                   source_type, source_id, created_by, created_at,
                   decided_by, decided_at, applied_revision
            FROM project_state_proposal
            """;

    public record VerifiedExecutionFact(UUID entryId, long stateRevision, boolean replayed) {
    }
}
