package com.zhishu.plan;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
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
import com.zhishu.state.ContextPackageView;
import com.zhishu.state.ProjectStateConflictException;
import com.zhishu.state.ProjectStateService;

/** Creates a deduplicated, approval-only Plan patch after a deterministic Integration failure. */
@Service
public class AutomaticReplanService {

    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    private final ObjectMapper json;
    private final ProjectStateService states;
    private final PlanCenterService plans;

    public AutomaticReplanService(
            JdbcTemplate jdbc,
            TransactionTemplate transactions,
            ObjectMapper json,
            ProjectStateService states,
            PlanCenterService plans
    ) {
        this.jdbc = jdbc;
        this.transactions = transactions;
        this.json = json;
        this.states = states;
        this.plans = plans;
    }

    public Map<String, Object> createForIntegrationFailure(
            UUID projectId,
            UUID planId,
            UUID integrationRunId,
            String actor,
            String failureSummary
    ) {
        Map<String, Object> replay = find(projectId, integrationRunId);
        if (replay != null) return replay;
        ContextPackageView context = states.generateContext(projectId, "PLANNER");
        ObjectNode payload = buildPayload(
                projectId, planId, integrationRunId, context, normalizedSummary(failureSummary)
        );
        String fingerprint = sha256(integrationRunId + "|" + payload.path("baseStateRevision").asLong()
                + "|" + payload.path("basePlanVersion").asLong() + "|" + failureSummary);
        Map<String, Object> result = transactions.execute(status -> {
            jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))",
                    Object.class, projectId + "|automatic-replan|" + integrationRunId);
            Map<String, Object> concurrent = find(projectId, integrationRunId);
            if (concurrent != null) return concurrent;
            Map<String, Object> proposal = plans.createProposal(
                    projectId, requireText(actor, "actor"), payload
            );
            UUID proposalId = (UUID) proposal.get("proposalId");
            jdbc.update("""
                    UPDATE plan_proposal
                    SET trigger_type = 'INTEGRATION_EXECUTION_FAILED', trigger_id = ?, trigger_fingerprint = ?
                    WHERE id = ? AND project_id = ? AND status = 'PENDING_APPROVAL'
                    """, integrationRunId, fingerprint, proposalId, projectId);
            jdbc.update("""
                    UPDATE integration_execution_run SET replan_proposal_id = ?
                    WHERE id = ? AND project_id = ? AND replan_proposal_id IS NULL
                    """, proposalId, integrationRunId, projectId);
            return plans.listProposals(projectId).stream()
                    .filter(value -> proposalId.equals(value.get("proposalId")))
                    .findFirst().orElse(proposal);
        });
        if (result == null) throw new IllegalStateException("Automatic Replan transaction returned no result");
        return result;
    }

    private ObjectNode buildPayload(
            UUID projectId,
            UUID planId,
            UUID runId,
            ContextPackageView context,
            String failureSummary
    ) {
        Map<String, Object> plan;
        try {
            plan = jdbc.queryForMap("""
                    SELECT plan.name, plan.current_version_id, version.version_number, version.objective,
                           state.state_revision
                    FROM project_plan plan
                    JOIN plan_version version ON version.id = plan.current_version_id
                    JOIN project_state_snapshot state ON state.project_id = plan.project_id
                    WHERE plan.id = ? AND plan.project_id = ? AND plan.status = 'ACTIVE'
                    """, planId, projectId);
        } catch (EmptyResultDataAccessException error) {
            throw new ProjectStateConflictException("Active Plan was not found for automatic Replan.");
        }
        UUID versionId = (UUID) plan.get("current_version_id");
        List<NodeSnapshot> currentNodes = jdbc.query("""
                SELECT node.node_key, node.title, node.objective, node.scope::text AS scope,
                       node.acceptance_criteria::text AS acceptance_criteria, node.priority,
                       node.required_capabilities::text AS required_capabilities,
                       node.requires_human_approval
                FROM plan_node_definition node
                WHERE node.plan_version_id = ? ORDER BY node.priority DESC, node.node_key
                """, (row, number) -> new NodeSnapshot(
                row.getString("node_key"), row.getString("title"), row.getString("objective"),
                read(row.getString("scope")), read(row.getString("acceptance_criteria")),
                row.getInt("priority"), read(row.getString("required_capabilities")),
                row.getBoolean("requires_human_approval")
        ), versionId);
        Map<String, List<String>> dependencies = new LinkedHashMap<>();
        jdbc.query("""
                SELECT node_key, depends_on_node_key FROM plan_node_dependency
                WHERE plan_version_id = ? ORDER BY node_key, depends_on_node_key
                """, (org.springframework.jdbc.core.RowCallbackHandler) row -> dependencies
                .computeIfAbsent(row.getString("node_key"), ignored -> new ArrayList<>())
                .add(row.getString("depends_on_node_key")), versionId);
        List<String> scheduledNodes = jdbc.query("""
                SELECT assignment.node_key
                FROM integration_execution_run run
                JOIN integration_gate_proposal gate ON gate.id = run.gate_id
                JOIN parallel_schedule_assignment assignment ON assignment.schedule_id = gate.schedule_id
                WHERE run.id = ? AND run.project_id = ? ORDER BY assignment.worker_slot
                """, (row, number) -> row.getString(1), runId, projectId);
        if (scheduledNodes.size() != 2) {
            throw new ProjectStateConflictException("Automatic Replan requires the failed two-Worker Integration Run.");
        }

        ObjectNode payload = json.createObjectNode()
                .put("schemaVersion", "1.0")
                .put("name", String.valueOf(plan.get("name")))
                .put("objective", String.valueOf(plan.get("objective")))
                .put("creationReason", "Automatic proposal after Integration failure " + runId)
                .put("baseStateRevision", ((Number) plan.get("state_revision")).longValue())
                .put("basePlanVersion", ((Number) plan.get("version_number")).longValue())
                .put("planId", planId.toString())
                .put("contextPackageId", context.packageId().toString())
                .put("provider", "zhishu-grounded")
                .put("model", "grounded-replan-v1");
        payload.set("permissions", json.createObjectNode()
                .put("taskCreate", false)
                .put("runtimeDispatch", false)
                .put("planPublish", false)
                .put("proposalOnly", true));
        ArrayNode nodes = payload.putArray("nodes");
        LinkedHashSet<String> recoveryScope = new LinkedHashSet<>();
        for (NodeSnapshot node : currentNodes) {
            ObjectNode value = nodes.addObject()
                    .put("nodeKey", node.nodeKey())
                    .put("title", node.title())
                    .put("objective", node.objective())
                    .put("priority", node.priority())
                    .put("requiresHumanApproval", node.requiresHumanApproval())
                    .put("relationType", "INHERITED")
                    .put("previousNodeKey", node.nodeKey());
            value.set("scope", node.scope().deepCopy());
            value.set("acceptanceCriteria", node.acceptanceCriteria().deepCopy());
            value.set("requiredCapabilities", node.requiredCapabilities().deepCopy());
            ArrayNode dependsOn = value.putArray("dependsOn");
            dependencies.getOrDefault(node.nodeKey(), List.of()).forEach(dependsOn::add);
            if (scheduledNodes.contains(node.nodeKey())) node.scope().forEach(item -> recoveryScope.add(item.asText()));
        }
        String recoveryNodeKey = "integration-recovery-" + runId.toString().substring(0, 8);
        ObjectNode recovery = nodes.addObject()
                .put("nodeKey", recoveryNodeKey)
                .put("title", "Resolve failed Integration")
                .put("objective", "Resolve the isolated Integration failure and preserve both Worker results. Failure: "
                        + failureSummary)
                .put("priority", 1_000)
                .put("requiresHumanApproval", true)
                .put("relationType", "NEW");
        ArrayNode scope = recovery.putArray("scope");
        recoveryScope.forEach(scope::add);
        recovery.putArray("acceptanceCriteria")
                .add("Integration apply completes without conflicts")
                .add("Configured build command passes")
                .add("Configured test command passes");
        recovery.putArray("requiredCapabilities")
                .add("READ_FILE").add("WRITE_FILE").add("SEARCH_CODE")
                .add("SHELL").add("GIT").add("TEST");
        ArrayNode recoveryDependencies = recovery.putArray("dependsOn");
        scheduledNodes.forEach(recoveryDependencies::add);
        return payload;
    }

    private Map<String, Object> find(UUID projectId, UUID runId) {
        return plans.listProposals(projectId).stream()
                .filter(value -> "INTEGRATION_EXECUTION_FAILED".equals(value.get("triggerType"))
                        && runId.equals(value.get("triggerId")))
                .findFirst().orElse(null);
    }

    private String normalizedSummary(String value) {
        String summary = requireText(value, "failureSummary");
        return summary.length() <= 1_000 ? summary : summary.substring(0, 1_000);
    }

    private JsonNode read(String value) {
        try {
            return json.readTree(value);
        } catch (JsonProcessingException error) {
            throw new IllegalStateException("Stored Plan JSON is unreadable", error);
        }
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

    private record NodeSnapshot(
            String nodeKey,
            String title,
            String objective,
            JsonNode scope,
            JsonNode acceptanceCriteria,
            int priority,
            JsonNode requiredCapabilities,
            boolean requiresHumanApproval
    ) {
    }
}
