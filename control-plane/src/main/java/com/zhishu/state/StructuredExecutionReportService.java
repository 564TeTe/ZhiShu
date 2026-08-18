package com.zhishu.state;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

@Service
public class StructuredExecutionReportService {

    private static final List<String> CANDIDATE_TYPES = List.of(
            "DISCOVERY", "DECISION", "CONSTRAINT", "RISK"
    );
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public StructuredExecutionReportService(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    public ObjectNode buildVerifiedReport(UUID projectId, UUID reportId, String actor) {
        Map<String, Object> row = findReport(projectId, reportId);
        if (!"PASSED".equals(row.get("verification_decision"))) {
            throw new ProjectStateConflictException(
                    "State Steward requires an Execution Report that passed Human Verification."
            );
        }
        JsonNode claims = read((String) row.get("agent_claims"));
        JsonNode evidence = read((String) row.get("system_evidence"));
        ObjectNode report = json.createObjectNode();
        report.put("reportId", reportId.toString());
        report.put("reportVersion", "1.0");
        report.put("result", result((String) row.get("attempt_status")));
        report.put("summary", reportSummary(claims, (String) row.get("objective")));
        report.set("changes", filterArtifacts(evidence, List.of("FILE_CHANGE", "GIT_DIFF")));
        report.set("verification", verification(row));
        report.set("discoveries", json.createArrayNode());
        report.set("decisions", json.createArrayNode());
        report.set("constraints", json.createArrayNode());
        report.set("risks", json.createArrayNode());
        report.set("blockers", blockers(claims, (String) row.get("attempt_status")));
        report.set("suggestedNextActions", json.createArrayNode());
        report.set("evidenceRefs", evidence.deepCopy());
        report.set("authority", authority(claims, evidence, row));
        report.put("generatedAt", ((Timestamp) row.get("generated_at")).toInstant().toString());
        extractCandidates(projectId, reportId, actor, (String) row.get("title"), claims, report);
        return report;
    }

    private Map<String, Object> findReport(UUID projectId, UUID reportId) {
        try {
            return jdbc.queryForMap("""
                    SELECT r.attempt_status, r.agent_claims::text AS agent_claims,
                           r.system_evidence::text AS system_evidence, r.generated_at,
                           w.title, w.objective, v.decision AS verification_decision,
                           v.reason AS verification_reason, v.verified_by, v.verified_at
                    FROM execution_report r
                    JOIN work_order w ON w.id = r.work_order_id
                    LEFT JOIN execution_verification v ON v.report_id = r.id
                    WHERE r.id = ? AND w.project_id = ?
                    """, reportId, projectId);
        } catch (EmptyResultDataAccessException error) {
            throw new ProjectStateConflictException("Execution Report was not found for this project.");
        }
    }

    private void extractCandidates(
            UUID projectId,
            UUID reportId,
            String actor,
            String workOrderTitle,
            JsonNode claims,
            ObjectNode report
    ) {
        if (!claims.isArray()) return;
        for (JsonNode claim : claims) {
            List<DerivedCandidate> candidates = new ArrayList<>();
            JsonNode explicitCandidates = claim.path("metadata").path("stateCandidates");
            if (explicitCandidates.isArray()) {
                for (JsonNode candidate : explicitCandidates) {
                    String entryType = candidate.path("entryType").asText("").trim().toUpperCase();
                    String title = candidate.path("title").asText("").trim();
                    String content = candidate.path("content").asText("").trim();
                    if (!CANDIDATE_TYPES.contains(entryType) || title.isEmpty() || content.isEmpty()) continue;
                    candidates.add(new DerivedCandidate(
                            entryType, title, content, nullable(candidate.path("rationale").asText(null))
                    ));
                }
            }
            boolean hasExplicitCandidates = explicitCandidates.isArray() && !explicitCandidates.isEmpty();
            if (candidates.isEmpty() && !hasExplicitCandidates) {
                String artifactType = claim.path("artifactType").asText();
                String content = excerpt(claim.path("content").asText(null), 1500);
                if (content != null && "SUMMARY".equals(artifactType)) {
                    candidates.add(new DerivedCandidate(
                            "DISCOVERY", "执行摘要：" + workOrderTitle, content,
                            "来自 Agent SUMMARY Claim，需用户确认后才能进入 Project State。"
                    ));
                } else if (content != null && "ERROR_REPORT".equals(artifactType)) {
                    candidates.add(new DerivedCandidate(
                            "RISK", "执行风险：" + workOrderTitle, content,
                            "来自 Agent ERROR_REPORT Claim，需用户确认后才能进入 Project State。"
                    ));
                }
            }
            if (candidates.isEmpty()) continue;
            String artifactIdText = claim.path("artifactId").asText("").trim();
            if (artifactIdText.isEmpty()) continue;
            UUID artifactId = UUID.fromString(artifactIdText);
            UUID evidenceReferenceId = ensureEvidenceReference(projectId, reportId, artifactId, actor);
            candidates.forEach(candidate -> addCandidate(
                    report, candidate.entryType(), candidate.title(), candidate.content(),
                    candidate.rationale(), evidenceReferenceId
            ));
        }
    }

    private void addCandidate(
            ObjectNode report,
            String entryType,
            String title,
            String content,
            String rationale,
            UUID evidenceReferenceId
    ) {
        String field = switch (entryType) {
            case "DISCOVERY" -> "discoveries";
            case "DECISION" -> "decisions";
            case "CONSTRAINT" -> "constraints";
            case "RISK" -> "risks";
            default -> throw new IllegalArgumentException("Unsupported State candidate type: " + entryType);
        };
        ObjectNode candidate = json.createObjectNode()
                .put("entryType", entryType)
                .put("title", title)
                .put("content", content);
        if (rationale == null) candidate.putNull("rationale");
        else candidate.put("rationale", rationale);
        candidate.putArray("evidenceReferenceIds").add(evidenceReferenceId.toString());
        ((ArrayNode) report.path(field)).add(candidate);
    }

    private UUID ensureEvidenceReference(
            UUID projectId,
            UUID reportId,
            UUID artifactId,
            String actor
    ) {
        Integer count = jdbc.queryForObject("""
                SELECT count(*) FROM task_artifact a
                JOIN agent_task t ON t.id = a.task_id
                WHERE a.id = ? AND t.project_id = ?
                """, Integer.class, artifactId, projectId);
        if (count == null || count != 1) {
            throw new ProjectStateConflictException("Execution Report references an artifact outside this project.");
        }
        jdbc.update("""
                INSERT INTO evidence_reference (
                    id, project_id, artifact_id, source_type, source_id, purpose, created_by
                ) VALUES (?, ?, ?, 'EXECUTION_REPORT', ?, 'STATE_STEWARD_CANDIDATE', ?)
                ON CONFLICT (source_type, source_id, artifact_id) DO NOTHING
                """, UUID.randomUUID(), projectId, artifactId, reportId, actor.trim());
        return jdbc.queryForObject("""
                SELECT id FROM evidence_reference
                WHERE source_type = 'EXECUTION_REPORT' AND source_id = ? AND artifact_id = ?
                """, UUID.class, reportId, artifactId);
    }

    private ObjectNode verification(Map<String, Object> row) {
        ObjectNode value = json.createObjectNode()
                .put("decision", String.valueOf(row.get("verification_decision")))
                .put("reason", String.valueOf(row.get("verification_reason")))
                .put("verifiedBy", String.valueOf(row.get("verified_by")));
        Timestamp verifiedAt = (Timestamp) row.get("verified_at");
        if (verifiedAt == null) value.putNull("verifiedAt");
        else value.put("verifiedAt", verifiedAt.toInstant().toString());
        return value;
    }

    private ObjectNode authority(JsonNode claims, JsonNode evidence, Map<String, Object> row) {
        return json.createObjectNode()
                .put("agentClaimCount", claims.isArray() ? claims.size() : 0)
                .put("systemEvidenceCount", evidence.isArray() ? evidence.size() : 0)
                .put("humanVerification", String.valueOf(row.get("verification_decision")))
                .put("stateAuthority", "PROPOSAL_ONLY");
    }

    private ArrayNode filterArtifacts(JsonNode values, List<String> types) {
        ArrayNode result = json.createArrayNode();
        if (values.isArray()) values.forEach(value -> {
            if (types.contains(value.path("artifactType").asText())) result.add(value.deepCopy());
        });
        return result;
    }

    private ArrayNode blockers(JsonNode claims, String attemptStatus) {
        ArrayNode result = filterArtifacts(claims, List.of("ERROR_REPORT"));
        if (result.isEmpty() && !"SUCCEEDED".equals(attemptStatus)) {
            result.add("Attempt ended with status " + attemptStatus);
        }
        return result;
    }

    private String reportSummary(JsonNode claims, String fallback) {
        if (claims.isArray()) {
            for (JsonNode claim : claims) {
                if ("SUMMARY".equals(claim.path("artifactType").asText())) {
                    String content = excerpt(claim.path("content").asText(null), 1500);
                    if (content != null) return content;
                }
            }
        }
        return fallback;
    }

    private String result(String attemptStatus) {
        return switch (attemptStatus) {
            case "SUCCEEDED" -> "SUCCESS";
            case "FAILED" -> "FAILED";
            case "LOST", "ABORTED" -> "BLOCKED";
            default -> "PARTIAL";
        };
    }

    private String excerpt(String value, int limit) {
        if (value == null || value.isBlank()) return null;
        String normalized = value.trim();
        return normalized.length() <= limit ? normalized : normalized.substring(0, limit) + "...";
    }

    private String nullable(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private JsonNode read(String value) {
        try {
            return json.readTree(value);
        } catch (JsonProcessingException error) {
            throw new IllegalStateException("Execution Report JSON is unreadable", error);
        }
    }

    private record DerivedCandidate(String entryType, String title, String content, String rationale) {
    }
}
