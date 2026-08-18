package com.zhishu.state;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

@Service
public class StateStewardService {

    private static final Map<String, String> REPORT_FIELDS = reportFields();
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    private final ObjectMapper json;
    private final ProjectStateService states;
    private final StructuredExecutionReportService reports;

    public StateStewardService(
            JdbcTemplate jdbc,
            TransactionTemplate transactions,
            ObjectMapper json,
            ProjectStateService states,
            StructuredExecutionReportService reports
    ) {
        this.jdbc = jdbc;
        this.transactions = transactions;
        this.json = json;
        this.states = states;
        this.reports = reports;
    }

    @Transactional
    public ProjectStateProposalView createProposalFromReport(
            UUID projectId,
            UUID reportId,
            String actor
    ) {
        return createProposal(projectId, actor, reports.buildVerifiedReport(projectId, reportId, actor));
    }

    public ProjectStateProposalView createProposal(UUID projectId, String actor, JsonNode report) {
        String normalizedActor = requireText(actor, "actor");
        validateReport(report);
        UUID reportId = UUID.fromString(report.path("reportId").asText());
        ProjectStateProposalView result = transactions.execute(status -> {
            Optional<UUID> replay = findProposalId(projectId, reportId);
            if (replay.isPresent()) return states.getProposal(projectId, replay.get());
            ensureExecutionReportBelongsToProject(projectId, reportId);
            ProjectStateSnapshotView snapshot = states.getSnapshot(projectId);
            if (snapshot.stateRevision() == 0) {
                throw new ProjectStateConflictException("State Steward requires established Project State.");
            }
            ArrayNode candidates = analyzeCandidates(report, snapshot.entries());
            ObjectNode summary = summarize(candidates);
            ObjectNode payload = json.createObjectNode();
            payload.put("schemaVersion", "1.0");
            payload.put("proposalType", "STATE_CHANGE");
            payload.put("roleVersion", "state-steward:v1");
            payload.put("promptVersion", "state-steward-prompt:v1");
            payload.put("reportId", reportId.toString());
            payload.put("result", report.path("result").asText());
            payload.set("candidates", candidates);
            payload.set("summary", summary);
            payload.set("permissions", permissions());
            ObjectNode validation = json.createObjectNode();
            validation.put("valid", true);
            validation.put("schemaVersion", "1.0");
            validation.put("roleVersion", "state-steward:v1");
            validation.set("summary", summary.deepCopy());
            UUID proposalId = UUID.randomUUID();
            Instant now = Instant.now();
            int inserted = jdbc.update("""
                    INSERT INTO project_state_proposal (
                        id, project_id, proposal_type, status, base_state_revision, payload,
                        validation_result, source_type, source_id, created_by, created_at, updated_at
                    ) VALUES (?, ?, 'STATE_CHANGE', 'PENDING_APPROVAL', ?, CAST(? AS jsonb),
                              CAST(? AS jsonb), 'EXECUTION_REPORT', ?, ?, ?, ?)
                    ON CONFLICT (project_id, source_type, source_id)
                    WHERE proposal_type = 'STATE_CHANGE' AND source_type = 'EXECUTION_REPORT'
                    DO NOTHING
                    """, proposalId, projectId, snapshot.stateRevision(), write(payload), write(validation),
                    reportId.toString(), normalizedActor, Timestamp.from(now), Timestamp.from(now));
            UUID effectiveProposalId = inserted == 1
                    ? proposalId
                    : findProposalId(projectId, reportId).orElseThrow(
                            () -> new IllegalStateException("State Steward replay proposal was not found")
                    );
            return states.getProposal(projectId, effectiveProposalId);
        });
        if (result == null) throw new IllegalStateException("State Steward transaction returned no result");
        return result;
    }

    private ArrayNode analyzeCandidates(JsonNode report, List<StateEntryView> entries) {
        Map<String, Candidate> grouped = new LinkedHashMap<>();
        for (Map.Entry<String, String> source : REPORT_FIELDS.entrySet()) {
            JsonNode values = report.path(source.getKey());
            if (!values.isMissingNode() && !values.isArray()) {
                throw new IllegalArgumentException(source.getKey() + " must be an array");
            }
            if (!values.isArray()) continue;
            for (JsonNode value : values) {
                if (!value.isObject()) throw new IllegalArgumentException(source.getKey() + " entries must be objects");
                String entryType = value.path("entryType").asText(source.getValue());
                if (!source.getValue().equals(entryType)) {
                    throw new IllegalArgumentException("Unsupported State Steward entryType: " + entryType);
                }
                String title = requireText(value.path("title").asText(), source.getKey() + ".title");
                String content = requireText(value.path("content").asText(), source.getKey() + ".content");
                String key = candidateKey(entryType, title, content);
                Candidate candidate = grouped.computeIfAbsent(key,
                        ignored -> new Candidate(entryType, title, content, nullableText(value, "rationale")));
                candidate.count += 1;
                JsonNode evidence = value.path("evidenceReferenceIds");
                if (!evidence.isMissingNode() && !evidence.isArray()) {
                    throw new IllegalArgumentException("evidenceReferenceIds must be an array");
                }
                if (evidence.isArray()) evidence.forEach(item -> candidate.evidence.add(
                        UUID.fromString(requireText(item.asText(), "evidenceReferenceId")).toString()
                ));
            }
        }

        Map<String, StateEntryView> exact = new LinkedHashMap<>();
        Map<String, StateEntryView> sameTitle = new LinkedHashMap<>();
        entries.stream().filter(entry -> "ACTIVE".equals(entry.status())).forEach(entry -> {
            exact.putIfAbsent(candidateKey(entry.entryType(), entry.title(), entry.content()), entry);
            sameTitle.putIfAbsent(titleKey(entry.entryType(), entry.title()), entry);
        });
        ArrayNode result = json.createArrayNode();
        grouped.forEach((key, candidate) -> {
            StateEntryView exactEntry = exact.get(key);
            StateEntryView titledEntry = sameTitle.get(titleKey(candidate.entryType, candidate.title));
            String disposition = exactEntry != null ? "STALE" : titledEntry != null ? "CONFLICT" : "NEW";
            StateEntryView existing = exactEntry != null ? exactEntry : titledEntry;
            ObjectNode value = json.createObjectNode();
            value.put("candidateKey", key);
            value.put("entryType", candidate.entryType);
            value.put("title", candidate.title);
            value.put("content", candidate.content);
            if (candidate.rationale == null) value.putNull("rationale");
            else value.put("rationale", candidate.rationale);
            value.put("disposition", disposition);
            value.put("mergedCandidateCount", candidate.count);
            if (existing == null) value.putNull("existingEntryId");
            else value.put("existingEntryId", existing.entryId().toString());
            ArrayNode evidence = value.putArray("evidenceReferenceIds");
            candidate.evidence.forEach(evidence::add);
            result.add(value);
        });
        return result;
    }

    private ObjectNode summarize(ArrayNode candidates) {
        int fresh = 0;
        int stale = 0;
        int conflict = 0;
        int merged = 0;
        for (JsonNode candidate : candidates) {
            switch (candidate.path("disposition").asText()) {
                case "NEW" -> fresh += 1;
                case "STALE" -> stale += 1;
                case "CONFLICT" -> conflict += 1;
                default -> throw new IllegalStateException("Unknown State Steward disposition");
            }
            merged += Math.max(0, candidate.path("mergedCandidateCount").asInt() - 1);
        }
        return json.createObjectNode()
                .put("extracted", candidates.size())
                .put("newCandidates", fresh)
                .put("staleCandidates", stale)
                .put("conflictCandidates", conflict)
                .put("mergedCandidates", merged);
    }

    private ObjectNode permissions() {
        return json.createObjectNode()
                .put("readStructuredReport", true)
                .put("readProjectState", true)
                .put("generateStateChangeProposal", true)
                .put("shell", false)
                .put("git", false)
                .put("filesystemRead", false)
                .put("filesystemWrite", false)
                .put("stateWrite", false)
                .put("factWrite", false)
                .put("decisionWrite", false)
                .put("planWrite", false);
    }

    private void validateReport(JsonNode report) {
        if (report == null || !report.isObject()) throw new IllegalArgumentException("report is required");
        UUID.fromString(requireText(report.path("reportId").asText(), "reportId"));
        if (!"1.0".equals(report.path("reportVersion").asText())) {
            throw new IllegalArgumentException("State Steward requires ExecutionReportV1.");
        }
        if (!List.of("SUCCESS", "PARTIAL", "BLOCKED", "FAILED").contains(report.path("result").asText())) {
            throw new IllegalArgumentException("Unsupported Execution Report result.");
        }
    }

    private void ensureExecutionReportBelongsToProject(UUID projectId, UUID reportId) {
        Integer count = jdbc.queryForObject("""
                SELECT count(*) FROM execution_report r
                JOIN work_order w ON w.id = r.work_order_id
                WHERE r.id = ? AND w.project_id = ?
                """, Integer.class, reportId, projectId);
        if (count == null || count != 1) {
            throw new ProjectStateConflictException("Execution Report was not found for this project.");
        }
    }

    private Optional<UUID> findProposalId(UUID projectId, UUID reportId) {
        try {
            return Optional.ofNullable(jdbc.queryForObject("""
                    SELECT id FROM project_state_proposal
                    WHERE project_id = ? AND proposal_type = 'STATE_CHANGE'
                      AND source_type = 'EXECUTION_REPORT' AND source_id = ?
                    """, UUID.class, projectId, reportId.toString()));
        } catch (EmptyResultDataAccessException error) {
            return Optional.empty();
        }
    }

    private String candidateKey(String entryType, String title, String content) {
        return entryType + ":" + normalize(title) + ":" + normalize(content);
    }

    private String titleKey(String entryType, String title) {
        return entryType + ":" + normalize(title);
    }

    private String normalize(String value) {
        return value.trim().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
    }

    private String nullableText(JsonNode value, String field) {
        String text = value.path(field).asText("").trim();
        return text.isEmpty() ? null : text;
    }

    private String requireText(String value, String field) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(field + " is required");
        return value.trim();
    }

    private String write(JsonNode value) {
        try {
            return json.writeValueAsString(value);
        } catch (JsonProcessingException error) {
            throw new IllegalArgumentException("JSON serialization failed", error);
        }
    }

    private static Map<String, String> reportFields() {
        Map<String, String> fields = new LinkedHashMap<>();
        fields.put("discoveries", "DISCOVERY");
        fields.put("decisions", "DECISION");
        fields.put("constraints", "CONSTRAINT");
        fields.put("risks", "RISK");
        return fields;
    }

    private static final class Candidate {
        private final String entryType;
        private final String title;
        private final String content;
        private final String rationale;
        private final Set<String> evidence = new LinkedHashSet<>();
        private int count;

        private Candidate(String entryType, String title, String content, String rationale) {
            this.entryType = entryType;
            this.title = title;
            this.content = content;
            this.rationale = rationale;
        }
    }
}
