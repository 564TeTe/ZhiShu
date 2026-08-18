package com.zhishu.plan;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.zhishu.state.ProjectStateConflictException;

@Service
public class PlanCenterService {

    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    private final ObjectMapper json;

    public PlanCenterService(JdbcTemplate jdbc, TransactionTemplate transactions, ObjectMapper json) {
        this.jdbc = jdbc;
        this.transactions = transactions;
        this.json = json;
    }

    public Map<String, Object> createProposal(UUID projectId, String actor, JsonNode payload) {
        validatePayload(payload);
        long revision = stateRevision(projectId);
        long requestedRevision = payload.path("baseStateRevision").asLong(-1);
        if (requestedRevision != revision) {
            throw new ProjectStateConflictException("Planner context is stale; refresh Project State before proposing.");
        }
        UUID proposalId = UUID.randomUUID();
        UUID planId = nullableUuid(payload.path("planId").asText(null));
        Long basePlanVersion = payload.path("basePlanVersion").isNumber()
                ? payload.path("basePlanVersion").asLong() : null;
        UUID contextPackageId = UUID.fromString(payload.path("contextPackageId").asText());
        Integer contextCount = jdbc.queryForObject("""
                SELECT count(*) FROM project_context_package_archive
                WHERE id = ? AND project_id = ? AND package_type = 'PLANNER'
                """, Integer.class, contextPackageId, projectId);
        if (contextCount == null || contextCount != 1) {
            throw new ProjectStateConflictException("Planner Context Package does not belong to this project.");
        }
        if (planId != null) {
            Map<String, Object> current = currentPlan(projectId, planId);
            Long currentVersion = current.get("version_number") == null
                    ? null : ((Number) current.get("version_number")).longValue();
            if (!java.util.Objects.equals(currentVersion, basePlanVersion)) {
                throw new ProjectStateConflictException("basePlanVersion does not match the current Plan Version.");
            }
        } else if (basePlanVersion != null) {
            throw new IllegalArgumentException("A new Plan Proposal cannot have basePlanVersion.");
        }
        String type = planId == null ? "PLAN_PROPOSAL_V1" : "PLAN_PATCH_PROPOSAL_V1";
        jdbc.update("""
                INSERT INTO plan_proposal (
                    id, project_id, plan_id, proposal_type, status, base_state_revision,
                    base_plan_version, payload, context_package_id, provider, model, permissions, created_by
                ) VALUES (?, ?, ?, ?, 'PENDING_APPROVAL', ?, ?, CAST(? AS jsonb), ?, ?, ?, CAST(? AS jsonb), ?)
                """, proposalId, projectId, planId, type, revision, basePlanVersion, write(payload),
                contextPackageId, requireText(payload.path("provider").asText(), "provider"),
                requireText(payload.path("model").asText(), "model"), write(payload.path("permissions")),
                requireText(actor, "actor"));
        return proposal(proposalId);
    }

    public List<Map<String, Object>> listProposals(UUID projectId) {
        return jdbc.query("""
                SELECT id FROM plan_proposal WHERE project_id = ? ORDER BY created_at DESC
                """, (row, number) -> proposal(row.getObject("id", UUID.class)), projectId);
    }

    public Map<String, Object> publish(
            UUID projectId,
            UUID proposalId,
            String actor,
            List<String> approvedNodeKeys
    ) {
        try {
            Map<String, Object> result = transactions.execute(status -> publishInTransaction(
                    projectId, proposalId, actor, approvedNodeKeys
            ));
            if (result == null) throw new IllegalStateException("Plan publish transaction returned no result");
            return result;
        } catch (ProjectStateConflictException error) {
            if (error.getMessage() != null && error.getMessage().startsWith("Plan Proposal is stale")) {
                jdbc.update("""
                        UPDATE plan_proposal SET status = 'STALE', decided_at = now()
                        WHERE id = ? AND project_id = ? AND status = 'PENDING_APPROVAL'
                        """, proposalId, projectId);
            }
            throw error;
        }
    }

    public Map<String, Object> reject(UUID projectId, UUID proposalId, String actor, String reason) {
        int updated = jdbc.update("""
                UPDATE plan_proposal SET status = 'REJECTED', decided_by = ?, decided_at = now(), rejection_reason = ?
                WHERE id = ? AND project_id = ? AND status = 'PENDING_APPROVAL'
                """, requireText(actor, "actor"), requireText(reason, "reason"), proposalId, projectId);
        if (updated != 1) throw new ProjectStateConflictException("Plan Proposal is no longer pending.");
        return proposal(proposalId);
    }

    public List<Map<String, Object>> listPlans(UUID projectId) {
        return jdbc.query("""
                SELECT id FROM project_plan WHERE project_id = ? AND status = 'ACTIVE' ORDER BY updated_at DESC
                """, (row, number) -> plan(row.getObject("id", UUID.class)), projectId);
    }

    public Map<String, Object> getPlan(UUID projectId, UUID planId) {
        Integer count = jdbc.queryForObject("SELECT count(*) FROM project_plan WHERE id = ? AND project_id = ?",
                Integer.class, planId, projectId);
        if (count == null || count != 1) throw new ProjectStateConflictException("Plan was not found.");
        return plan(planId);
    }

    private Map<String, Object> publishInTransaction(
            UUID projectId,
            UUID proposalId,
            String actor,
            List<String> approvedNodeKeys
    ) {
        Map<String, Object> row;
        try {
            row = jdbc.queryForMap("""
                    SELECT id, plan_id, status, base_state_revision, base_plan_version, payload::text AS payload,
                           published_version_id
                    FROM plan_proposal WHERE id = ? AND project_id = ? FOR UPDATE
                    """, proposalId, projectId);
        } catch (EmptyResultDataAccessException error) {
            throw new ProjectStateConflictException("Plan Proposal was not found.");
        }
        if (row.get("published_version_id") != null) {
            return plan((UUID) row.get("plan_id"));
        }
        if (!"PENDING_APPROVAL".equals(row.get("status"))) {
            throw new ProjectStateConflictException("Plan Proposal is no longer pending.");
        }
        long baseRevision = ((Number) row.get("base_state_revision")).longValue();
        if (stateRevision(projectId) != baseRevision) {
            throw new ProjectStateConflictException("Plan Proposal is stale because Project State changed.");
        }
        JsonNode payload = read((String) row.get("payload"));
        Set<String> selected = approvedNodeKeys == null || approvedNodeKeys.isEmpty()
                ? allNodeKeys(payload) : new HashSet<>(approvedNodeKeys);
        if (selected.isEmpty()) throw new IllegalArgumentException("At least one Plan node must be approved.");
        for (String selectedKey : selected) {
            if (!allNodeKeys(payload).contains(selectedKey)) {
                throw new IllegalArgumentException("Unknown approved nodeKey: " + selectedKey);
            }
        }

        UUID planId = (UUID) row.get("plan_id");
        if (planId == null) {
            planId = UUID.randomUUID();
            jdbc.update("""
                    INSERT INTO project_plan (id, project_id, name) VALUES (?, ?, ?)
                    """, planId, projectId, requireText(payload.path("name").asText(), "name"));
        }
        Map<String, Object> current = jdbc.queryForMap("""
                SELECT current_version_id FROM project_plan WHERE id = ? FOR UPDATE
                """, planId);
        UUID previousVersionId = (UUID) current.get("current_version_id");
        Long previousVersion = previousVersionId == null ? null : jdbc.queryForObject(
                "SELECT version_number FROM plan_version WHERE id = ?", Long.class, previousVersionId);
        Long expectedBasePlanVersion = row.get("base_plan_version") == null
                ? null : ((Number) row.get("base_plan_version")).longValue();
        if ((previousVersion == null && expectedBasePlanVersion != null)
                || (previousVersion != null && !previousVersion.equals(expectedBasePlanVersion))) {
            throw new ProjectStateConflictException("Plan Proposal is stale because the Plan Version changed.");
        }
        long versionNumber = previousVersion == null ? 1 : previousVersion + 1;
        UUID versionId = UUID.randomUUID();
        Set<String> referencedPreviousNodes = new HashSet<>();
        jdbc.update("""
                INSERT INTO plan_version (
                    id, plan_id, version_number, objective, creation_reason,
                    base_state_revision, source_proposal_id, previous_version_id, approved_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, versionId, planId, versionNumber, requireText(payload.path("objective").asText(), "objective"),
                payload.path("creationReason").asText("Planner Proposal"), baseRevision, proposalId,
                previousVersionId, requireText(actor, "actor"));
        Set<String> availableCapabilities = availableCapabilities(projectId);
        for (JsonNode node : payload.path("nodes")) {
            String nodeKey = node.path("nodeKey").asText();
            if (!selected.contains(nodeKey)) continue;
            List<String> required = stringList(node.path("requiredCapabilities"));
            List<String> warnings = required.stream().filter(capability -> !availableCapabilities.contains(capability))
                    .map(capability -> "No enabled project profile provides " + capability).toList();
            jdbc.update("""
                    INSERT INTO plan_node_definition (
                        id, plan_version_id, node_key, title, objective, scope,
                        acceptance_criteria, priority, required_capabilities,
                        requires_human_approval, executable, capability_warnings
                    ) VALUES (?, ?, ?, ?, ?, CAST(? AS jsonb), CAST(? AS jsonb), ?, CAST(? AS jsonb), ?, ?, CAST(? AS jsonb))
                    """, UUID.randomUUID(), versionId, nodeKey, requireText(node.path("title").asText(), "node.title"),
                    requireText(node.path("objective").asText(), "node.objective"), write(node.path("scope")),
                    write(node.path("acceptanceCriteria")), node.path("priority").asInt(0), write(required),
                    node.path("requiresHumanApproval").asBoolean(false), warnings.isEmpty(), write(warnings));
            String requestedRelation = node.path("relationType").asText("").trim();
            String relation = requestedRelation.isEmpty()
                    ? (previousNodeExists(previousVersionId, nodeKey) ? "INHERITED" : "NEW")
                    : requestedRelation;
            if (!Set.of("INHERITED", "SUPERSEDED", "NEW").contains(relation)) {
                throw new IllegalArgumentException("Unsupported node relationType: " + relation);
            }
            String previousNodeKey = "NEW".equals(relation) ? null
                    : node.path("previousNodeKey").asText(nodeKey).trim();
            if (previousNodeKey != null && !previousNodeExists(previousVersionId, previousNodeKey)) {
                throw new ProjectStateConflictException("Previous Plan node was not found: " + previousNodeKey);
            }
            if ("INHERITED".equals(relation)
                    && !sameDefinition(previousVersionId, previousNodeKey, node)) {
                throw new ProjectStateConflictException(
                        "INHERITED node definition changed; use SUPERSEDED with a new nodeKey: " + nodeKey
                );
            }
            if (previousNodeKey != null) referencedPreviousNodes.add(previousNodeKey);
            jdbc.update("""
                    INSERT INTO plan_node_version_relation (id, plan_version_id, node_key, previous_node_key, relation_type)
                    VALUES (?, ?, ?, ?, ?)
                    """, UUID.randomUUID(), versionId, nodeKey, previousNodeKey, relation);
            String previousState = previousNodeKey == null ? null : executionState(planId, previousNodeKey);
            String initialState = "INHERITED".equals(relation) && "COMPLETED".equals(previousState)
                    ? "COMPLETED" : "NOT_READY";
            jdbc.update("""
                    INSERT INTO plan_execution_state (plan_id, node_key, state)
                    VALUES (?, ?, ?)
                    ON CONFLICT (plan_id, node_key) DO UPDATE SET state = EXCLUDED.state, updated_at = now()
                    """, planId, nodeKey, initialState);
            if ("SUPERSEDED".equals(relation) && previousNodeKey != null && !previousNodeKey.equals(nodeKey)) {
                jdbc.update("""
                        UPDATE plan_execution_state SET state = 'SUPERSEDED', updated_at = now()
                        WHERE plan_id = ? AND node_key = ? AND state <> 'COMPLETED'
                        """, planId, previousNodeKey);
            }
        }
        insertDependencies(versionId, payload, selected);
        markReadyNodes(planId, versionId);
        if (previousVersionId != null) {
            recordCancelledNodes(planId, previousVersionId, versionId, referencedPreviousNodes);
        }
        jdbc.update("UPDATE project_plan SET current_version_id = ?, updated_at = now() WHERE id = ?", versionId, planId);
        jdbc.update("""
                UPDATE plan_proposal
                SET plan_id = ?, status = ?, decided_by = ?, decided_at = now(), published_version_id = ?
                WHERE id = ?
                """, planId, selected.equals(allNodeKeys(payload)) ? "APPROVED" : "PARTIALLY_APPROVED",
                actor, versionId, proposalId);
        jdbc.update("UPDATE project_state_snapshot SET current_plan_id = ? WHERE project_id = ?", planId, projectId);
        return plan(planId);
    }

    private void insertDependencies(UUID versionId, JsonNode payload, Set<String> selected) {
        for (JsonNode node : payload.path("nodes")) {
            String nodeKey = node.path("nodeKey").asText();
            if (!selected.contains(nodeKey)) continue;
            for (String dependency : stringList(node.path("dependsOn"))) {
                if (!selected.contains(dependency)) {
                    throw new IllegalArgumentException("Approved node depends on an unapproved node: " + dependency);
                }
                jdbc.update("""
                        INSERT INTO plan_node_dependency (plan_version_id, node_key, depends_on_node_key)
                        VALUES (?, ?, ?)
                        """, versionId, nodeKey, dependency);
            }
        }
    }

    private void markReadyNodes(UUID planId, UUID versionId) {
        jdbc.update("""
                UPDATE plan_execution_state s SET state = 'READY', updated_at = now()
                WHERE s.plan_id = ? AND s.state = 'NOT_READY' AND NOT EXISTS (
                    SELECT 1
                    FROM plan_node_dependency d
                    LEFT JOIN plan_execution_state dependency_state
                      ON dependency_state.plan_id = s.plan_id
                     AND dependency_state.node_key = d.depends_on_node_key
                    WHERE d.plan_version_id = ? AND d.node_key = s.node_key
                      AND COALESCE(dependency_state.state, 'NOT_READY') <> 'COMPLETED'
                )
                """, planId, versionId);
    }

    private void recordCancelledNodes(
            UUID planId,
            UUID previousVersionId,
            UUID versionId,
            Set<String> referencedPreviousNodes
    ) {
        List<String> previousKeys = jdbc.query("SELECT node_key FROM plan_node_definition WHERE plan_version_id = ?",
                (row, number) -> row.getString(1), previousVersionId);
        for (String oldKey : previousKeys) if (!referencedPreviousNodes.contains(oldKey)) {
            jdbc.update("""
                    INSERT INTO plan_node_version_relation (id, plan_version_id, node_key, previous_node_key, relation_type)
                    VALUES (?, ?, ?, ?, 'CANCELLED')
                    """, UUID.randomUUID(), versionId, oldKey, oldKey);
            jdbc.update("UPDATE plan_execution_state SET state = 'CANCELLED', updated_at = now() WHERE plan_id = ? AND node_key = ?",
                    planId, oldKey);
        }
    }

    private Map<String, Object> proposal(UUID proposalId) {
        Map<String, Object> row = jdbc.queryForMap("""
                SELECT id, project_id, plan_id, proposal_type, status, base_state_revision,
                       base_plan_version, payload::text AS payload, context_package_id,
                       source_role_version, prompt_version, provider, model, permissions::text AS permissions,
                       created_by, created_at, decided_by, decided_at, published_version_id, rejection_reason,
                       trigger_type, trigger_id, trigger_fingerprint
                FROM plan_proposal WHERE id = ?
                """, proposalId);
        Map<String, Object> value = new LinkedHashMap<>();
        row.forEach((key, item) -> value.put(camel(key), item instanceof Timestamp timestamp ? timestamp.toInstant() : item));
        value.put("payload", read((String) row.get("payload")));
        value.put("permissions", read((String) row.get("permissions")));
        value.put("proposalId", value.remove("id"));
        value.put("diff", proposalDiff((UUID) row.get("plan_id"), (JsonNode) value.get("payload")));
        return value;
    }

    private List<Map<String, Object>> proposalDiff(UUID planId, JsonNode payload) {
        List<Map<String, Object>> result = new ArrayList<>();
        Map<String, Map<String, String>> previous = new LinkedHashMap<>();
        if (planId != null) {
            UUID versionId = (UUID) jdbc.queryForMap(
                    "SELECT current_version_id FROM project_plan WHERE id = ?", planId
            ).get("current_version_id");
            if (versionId != null) {
                jdbc.query("""
                        SELECT node_key, title, objective FROM plan_node_definition WHERE plan_version_id = ?
                        """, row -> {
                    previous.put(row.getString("node_key"), Map.of(
                            "title", row.getString("title"), "objective", row.getString("objective")
                    ));
                }, versionId);
            }
        }
        Set<String> referenced = new HashSet<>();
        for (JsonNode node : payload.path("nodes")) {
            String key = node.path("nodeKey").asText();
            String previousKey = node.path("previousNodeKey").asText(key);
            Map<String, String> old = previous.get(previousKey);
            String explicit = node.path("relationType").asText("");
            String changeType;
            if ("SUPERSEDED".equals(explicit)) changeType = "SUPERSEDED";
            else if (old == null) changeType = "NEW";
            else if (old.get("title").equals(node.path("title").asText())
                    && old.get("objective").equals(node.path("objective").asText())) changeType = "INHERITED";
            else changeType = "MODIFIED";
            if (old != null) referenced.add(previousKey);
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("nodeKey", key);
            item.put("changeType", changeType);
            item.put("previousNodeKey", old == null ? null : previousKey);
            result.add(item);
        }
        for (String previousKey : previous.keySet()) if (!referenced.contains(previousKey)) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("nodeKey", previousKey);
            item.put("changeType", "CANCELLED");
            item.put("previousNodeKey", previousKey);
            result.add(item);
        }
        return result;
    }

    private Map<String, Object> plan(UUID planId) {
        Map<String, Object> row = jdbc.queryForMap("""
                SELECT p.id, p.project_id, p.name, p.status, p.current_version_id,
                       v.version_number, v.objective, v.creation_reason, v.base_state_revision,
                       v.previous_version_id, v.approved_by, v.published_at
                FROM project_plan p LEFT JOIN plan_version v ON v.id = p.current_version_id
                WHERE p.id = ?
                """, planId);
        UUID versionId = (UUID) row.get("current_version_id");
        List<Map<String, Object>> nodes = versionId == null ? List.of() : jdbc.query("""
                SELECT n.node_key, n.title, n.objective, n.scope::text AS scope,
                       n.acceptance_criteria::text AS acceptance_criteria, n.priority,
                       n.required_capabilities::text AS required_capabilities,
                       n.requires_human_approval, n.executable, n.capability_warnings::text AS capability_warnings,
                       s.state
                FROM plan_node_definition n
                LEFT JOIN plan_execution_state s ON s.plan_id = ? AND s.node_key = n.node_key
                WHERE n.plan_version_id = ? ORDER BY n.priority DESC, n.node_key
                """, (node, number) -> {
            Map<String, Object> value = new LinkedHashMap<>();
            value.put("nodeKey", node.getString("node_key"));
            value.put("title", node.getString("title"));
            value.put("objective", node.getString("objective"));
            value.put("scope", read(node.getString("scope")));
            value.put("acceptanceCriteria", read(node.getString("acceptance_criteria")));
            value.put("priority", node.getInt("priority"));
            value.put("requiredCapabilities", read(node.getString("required_capabilities")));
            value.put("requiresHumanApproval", node.getBoolean("requires_human_approval"));
            value.put("executable", node.getBoolean("executable"));
            value.put("capabilityWarnings", read(node.getString("capability_warnings")));
            value.put("executionState", node.getString("state"));
            value.put("dependsOn", jdbc.query("""
                    SELECT depends_on_node_key FROM plan_node_dependency
                    WHERE plan_version_id = ? AND node_key = ? ORDER BY depends_on_node_key
                    """, (dependency, dependencyNumber) -> dependency.getString(1), versionId, node.getString("node_key")));
            return value;
        }, planId, versionId);
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("planId", row.get("id"));
        value.put("projectId", row.get("project_id"));
        value.put("name", row.get("name"));
        value.put("status", row.get("status"));
        value.put("currentVersionId", versionId);
        value.put("versionNumber", row.get("version_number"));
        value.put("objective", row.get("objective"));
        value.put("creationReason", row.get("creation_reason"));
        value.put("baseStateRevision", row.get("base_state_revision"));
        value.put("previousVersionId", row.get("previous_version_id"));
        value.put("approvedBy", row.get("approved_by"));
        value.put("publishedAt", row.get("published_at") instanceof Timestamp time ? time.toInstant() : null);
        value.put("nodes", nodes);
        return value;
    }

    private Set<String> availableCapabilities(UUID projectId) {
        return new HashSet<>(jdbc.query("""
                SELECT DISTINCT jsonb_array_elements_text(capabilities) AS capability
                FROM agent_profile WHERE project_id = ? AND enabled = TRUE
                """, (row, number) -> row.getString("capability"), projectId));
    }

    private boolean previousNodeExists(UUID versionId, String nodeKey) {
        if (versionId == null) return false;
        Integer count = jdbc.queryForObject("SELECT count(*) FROM plan_node_definition WHERE plan_version_id = ? AND node_key = ?",
                Integer.class, versionId, nodeKey);
        return count != null && count == 1;
    }

    private boolean sameDefinition(UUID versionId, String nodeKey, JsonNode proposed) {
        if (versionId == null || nodeKey == null) return false;
        Map<String, Object> previous;
        try {
            previous = jdbc.queryForMap("""
                    SELECT title, objective, scope::text AS scope,
                           acceptance_criteria::text AS acceptance_criteria,
                           priority, required_capabilities::text AS required_capabilities,
                           requires_human_approval
                    FROM plan_node_definition WHERE plan_version_id = ? AND node_key = ?
                    """, versionId, nodeKey);
        } catch (EmptyResultDataAccessException error) {
            return false;
        }
        Set<String> oldDependencies = new HashSet<>(jdbc.query("""
                SELECT depends_on_node_key FROM plan_node_dependency
                WHERE plan_version_id = ? AND node_key = ?
                """, (row, number) -> row.getString(1), versionId, nodeKey));
        return previous.get("title").equals(proposed.path("title").asText())
                && previous.get("objective").equals(proposed.path("objective").asText())
                && read((String) previous.get("scope")).equals(proposed.path("scope"))
                && read((String) previous.get("acceptance_criteria")).equals(proposed.path("acceptanceCriteria"))
                && ((Number) previous.get("priority")).intValue() == proposed.path("priority").asInt(0)
                && read((String) previous.get("required_capabilities")).equals(proposed.path("requiredCapabilities"))
                && ((Boolean) previous.get("requires_human_approval")) == proposed.path("requiresHumanApproval").asBoolean(false)
                && oldDependencies.equals(new HashSet<>(stringList(proposed.path("dependsOn"))));
    }

    private String executionState(UUID planId, String nodeKey) {
        try {
            return jdbc.queryForObject("SELECT state FROM plan_execution_state WHERE plan_id = ? AND node_key = ?",
                    String.class, planId, nodeKey);
        } catch (EmptyResultDataAccessException error) {
            return null;
        }
    }

    private long stateRevision(UUID projectId) {
        try {
            Long revision = jdbc.queryForObject("SELECT state_revision FROM project_state_snapshot WHERE project_id = ?",
                    Long.class, projectId);
            return revision == null ? 0 : revision;
        } catch (EmptyResultDataAccessException error) {
            Integer project = jdbc.queryForObject("SELECT count(*) FROM project WHERE id = ?", Integer.class, projectId);
            if (project == null || project != 1) throw new ProjectStateConflictException("Project was not found.");
            jdbc.update("INSERT INTO project_state_snapshot (project_id) VALUES (?)", projectId);
            return 0;
        }
    }

    private Map<String, Object> currentPlan(UUID projectId, UUID planId) {
        try {
            return jdbc.queryForMap("""
                    SELECT p.id, v.version_number
                    FROM project_plan p LEFT JOIN plan_version v ON v.id = p.current_version_id
                    WHERE p.id = ? AND p.project_id = ? AND p.status = 'ACTIVE'
                    """, planId, projectId);
        } catch (EmptyResultDataAccessException error) {
            throw new ProjectStateConflictException("Plan was not found.");
        }
    }

    private void validatePayload(JsonNode payload) {
        if (payload == null || !payload.isObject()) throw new IllegalArgumentException("Plan Proposal payload is required.");
        if (!"1.0".equals(payload.path("schemaVersion").asText())) {
            throw new IllegalArgumentException("Plan Proposal schemaVersion must be 1.0.");
        }
        requireText(payload.path("name").asText(), "name");
        requireText(payload.path("objective").asText(), "objective");
        requireText(payload.path("contextPackageId").asText(), "contextPackageId");
        requireText(payload.path("provider").asText(), "provider");
        requireText(payload.path("model").asText(), "model");
        if (!payload.path("permissions").isObject()) {
            throw new IllegalArgumentException("Planner permission snapshot is required.");
        }
        if (!payload.path("nodes").isArray() || payload.path("nodes").isEmpty()) {
            throw new IllegalArgumentException("Plan Proposal requires at least one node.");
        }
        Set<String> keys = new HashSet<>();
        for (JsonNode node : payload.path("nodes")) {
            String key = requireText(node.path("nodeKey").asText(), "nodeKey");
            if (!keys.add(key)) throw new IllegalArgumentException("Duplicate nodeKey: " + key);
            requireText(node.path("title").asText(), "node.title");
            requireText(node.path("objective").asText(), "node.objective");
            if (!node.path("acceptanceCriteria").isArray() || node.path("acceptanceCriteria").isEmpty()) {
                throw new IllegalArgumentException("Each node requires acceptanceCriteria.");
            }
            node.path("acceptanceCriteria").forEach(value -> requireText(value.asText(), "acceptanceCriteria"));
            String relation = node.path("relationType").asText("").trim();
            if (!relation.isEmpty() && !Set.of("INHERITED", "SUPERSEDED", "NEW").contains(relation)) {
                throw new IllegalArgumentException("Unsupported relationType: " + relation);
            }
            if ("SUPERSEDED".equals(relation)
                    && key.equals(node.path("previousNodeKey").asText(key))) {
                throw new IllegalArgumentException("SUPERSEDED requires a distinct previousNodeKey.");
            }
        }
        for (JsonNode node : payload.path("nodes")) for (String dependency : stringList(node.path("dependsOn"))) {
            if (!keys.contains(dependency)) throw new IllegalArgumentException("Unknown dependency: " + dependency);
        }
    }

    private Set<String> allNodeKeys(JsonNode payload) {
        Set<String> keys = new HashSet<>();
        payload.path("nodes").forEach(node -> keys.add(node.path("nodeKey").asText()));
        return keys;
    }

    private List<String> stringList(JsonNode values) {
        List<String> result = new ArrayList<>();
        if (values instanceof ArrayNode array) array.forEach(value -> result.add(value.asText()));
        return result;
    }

    private UUID nullableUuid(String value) {
        return value == null || value.isBlank() ? null : UUID.fromString(value);
    }

    private String camel(String value) {
        StringBuilder result = new StringBuilder();
        boolean upper = false;
        for (char character : value.toCharArray()) {
            if (character == '_') upper = true;
            else { result.append(upper ? Character.toUpperCase(character) : character); upper = false; }
        }
        return result.toString();
    }

    private String requireText(String value, String field) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(field + " is required");
        return value.trim();
    }

    private String write(Object value) {
        try { return json.writeValueAsString(value); }
        catch (JsonProcessingException error) { throw new IllegalArgumentException("Plan JSON serialization failed", error); }
    }

    private JsonNode read(String value) {
        try { return json.readTree(value); }
        catch (JsonProcessingException error) { throw new IllegalStateException("Stored Plan JSON is unreadable", error); }
    }
}
