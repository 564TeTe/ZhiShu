package com.zhishu.integration;

import java.nio.file.Path;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import com.zhishu.approval.ApprovalMode;
import com.zhishu.profile.Capability;
import com.zhishu.task.CreateTaskCommand;
import com.zhishu.task.TaskApplicationService;
import com.zhishu.task.TaskView;
import com.zhishu.state.ProjectStateConflictException;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;

/** Starts the existing Runtime Agent only inside a failed, retained Integration Worktree. */
@Service
public class IntegrationAgentService {

    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    private final ObjectMapper json;
    private final TaskApplicationService tasks;

    public IntegrationAgentService(
            JdbcTemplate jdbc,
            TransactionTemplate transactions,
            ObjectMapper json,
            TaskApplicationService tasks
    ) {
        this.jdbc = jdbc;
        this.transactions = transactions;
        this.json = json;
        this.tasks = tasks;
    }

    public IntegrationAgentRunView start(
            UUID projectId,
            UUID planId,
            UUID gateId,
            UUID integrationRunId,
            String actor,
            String clientRequestId,
            UUID requestedProfileId
    ) {
        String normalizedActor = requireText(actor, "actor");
        String requestId = requireText(clientRequestId, "clientRequestId");
        String requestHash = requestHash(projectId, planId, gateId, integrationRunId, requestedProfileId);
        AgentClaim claim = transactions.execute(status -> claim(
                projectId, planId, gateId, integrationRunId, normalizedActor, requestId,
                requestHash, requestedProfileId
        ));
        if (claim == null) throw new IllegalStateException("Integration Agent claim returned no result");
        if (claim.replayed()) return get(projectId, planId, gateId, integrationRunId, claim.agentRunId(), true);

        TaskApplicationService.PreparedTask prepared = null;
        try {
            prepared = tasks.prepareInWorkspace(
                    new CreateTaskCommand(
                            projectId, claim.profileId(), "Integration Agent: " + integrationRunId,
                            claim.objective(), null, null, null, ApprovalMode.MANUAL,
                            Map.of("integrationRunId", integrationRunId.toString(),
                                    "gateId", gateId.toString(),
                                    "role", "integration-agent:v1")
                    ),
                    claim.workspacePath().toString()
            );
            int linked = jdbc.update("""
                    UPDATE integration_agent_run
                    SET task_id = ?, attempt_id = ?, status = 'RUNNING', started_at = now()
                    WHERE id = ? AND status = 'PREPARING'
                    """, prepared.taskId(), prepared.attempt().id(), claim.agentRunId());
            if (linked != 1) throw new IllegalStateException("Integration Agent claim changed before dispatch.");
            appendEvent(gateId, "INTEGRATION_AGENT_STARTED", normalizedActor,
                    "agentRunId", claim.agentRunId(), "taskId", prepared.taskId());
            tasks.dispatch(prepared);
        } catch (RuntimeException error) {
            TaskApplicationService.PreparedTask failedTask = prepared;
            transactions.executeWithoutResult(status -> {
                if (failedTask == null) {
                    jdbc.update("""
                            UPDATE integration_agent_run
                            SET status = 'FAILED', failure_message = ?, completed_at = now()
                            WHERE id = ? AND status IN ('PREPARING', 'RUNNING')
                            """, safeMessage(error), claim.agentRunId());
                } else {
                    jdbc.update("""
                            UPDATE integration_agent_run
                            SET task_id = COALESCE(task_id, ?), attempt_id = COALESCE(attempt_id, ?),
                                status = 'FAILED', failure_message = ?, completed_at = now()
                            WHERE id = ? AND status IN ('PREPARING', 'RUNNING')
                            """, failedTask.taskId(), failedTask.attempt().id(), safeMessage(error), claim.agentRunId());
                }
                appendFailureEvent(
                        gateId, normalizedActor, claim.agentRunId(),
                        failedTask == null ? null : failedTask.taskId(),
                        failedTask == null ? null : failedTask.attempt().id(), safeMessage(error)
                );
            });
        }
        return get(projectId, planId, gateId, integrationRunId, claim.agentRunId(), false);
    }

    public IntegrationAgentRunView get(
            UUID projectId,
            UUID planId,
            UUID gateId,
            UUID integrationRunId,
            UUID agentRunId,
            boolean replayed
    ) {
        try {
            Map<String, Object> row = jdbc.queryForMap("""
                    SELECT run.id, run.project_id, run.gate_id, run.integration_run_id,
                           run.profile_id, run.task_id, run.attempt_id, run.status,
                           run.objective, run.created_by, run.created_at, run.started_at,
                           run.completed_at, run.failure_message
                    FROM integration_agent_run run
                    JOIN integration_execution_run execution
                      ON execution.id = run.integration_run_id AND execution.plan_id = ?
                    WHERE run.id = ? AND run.project_id = ? AND run.gate_id = ?
                      AND run.integration_run_id = ?
                    """, planId, agentRunId, projectId, gateId, integrationRunId);
            return new IntegrationAgentRunView(
                    (UUID) row.get("id"), (UUID) row.get("project_id"), (UUID) row.get("gate_id"),
                    (UUID) row.get("integration_run_id"), (UUID) row.get("profile_id"),
                    (UUID) row.get("task_id"), (UUID) row.get("attempt_id"), String.valueOf(row.get("status")),
                    String.valueOf(row.get("objective")), String.valueOf(row.get("created_by")),
                    ((Timestamp) row.get("created_at")).toInstant(), instant(row.get("started_at")),
                    instant(row.get("completed_at")), nullable(row.get("failure_message")), replayed
            );
        } catch (EmptyResultDataAccessException error) {
            throw new ProjectStateConflictException("Integration Agent Run was not found.");
        }
    }

    private AgentClaim claim(
            UUID projectId,
            UUID planId,
            UUID gateId,
            UUID integrationRunId,
            String actor,
            String requestId,
            String requestHash,
            UUID requestedProfileId
    ) {
        jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))",
                Object.class, projectId + "|integration-agent|" + requestId);
        List<Map<String, Object>> replay = jdbc.queryForList("""
                SELECT run.id, execution.plan_id, run.gate_id, run.integration_run_id, run.request_hash
                FROM integration_agent_run run
                JOIN integration_execution_run execution ON execution.id = run.integration_run_id
                WHERE run.project_id = ? AND run.created_by = ? AND run.client_request_id = ?
                """, projectId, actor, requestId);
        if (!replay.isEmpty()) {
            Map<String, Object> existing = replay.get(0);
            if (!planId.equals(existing.get("plan_id"))
                    || !gateId.equals(existing.get("gate_id"))
                    || !integrationRunId.equals(existing.get("integration_run_id"))
                    || !requestHash.equals(existing.get("request_hash"))) {
                throw new ProjectStateConflictException("clientRequestId was reused for a different Integration Agent.");
            }
            return new AgentClaim((UUID) existing.get("id"), null, null, null, null, true);
        }
        Map<String, Object> run;
        try {
            run = jdbc.queryForMap("""
                    SELECT id, project_id, plan_id, gate_id, status, integration_workspace_path,
                           workspace_state, failure_message
                    FROM integration_execution_run
                    WHERE id = ? AND project_id = ? AND plan_id = ? AND gate_id = ?
                    FOR UPDATE
                    """, integrationRunId, projectId, planId, gateId);
        } catch (EmptyResultDataAccessException error) {
            throw new ProjectStateConflictException("Integration execution Run was not found.");
        }
        if (!"FAILED".equals(run.get("status")) || !"RETAINED".equals(run.get("workspace_state"))) {
            throw new ProjectStateConflictException(
                    "Integration Agent requires a failed Run with a retained Integration Worktree."
            );
        }
        UUID profileId = requestedProfileId == null
                ? findProfile(projectId) : validateProfile(projectId, requestedProfileId);
        String objective = "Diagnose and repair the failed Integration Run " + integrationRunId
                + " inside the isolated Worktree. Preserve the two Worker results, resolve conflicts, "
                + "and leave reproducible evidence for a later Integration retry.";
        UUID agentRunId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO integration_agent_run (
                    id, project_id, gate_id, integration_run_id, profile_id, status,
                    client_request_id, request_hash, created_by, objective
                ) VALUES (?, ?, ?, ?, ?, 'PREPARING', ?, ?, ?, ?)
                """, agentRunId, projectId, gateId, integrationRunId, profileId,
                requestId, requestHash, actor, objective);
        return new AgentClaim(
                agentRunId, profileId, Path.of(String.valueOf(run.get("integration_workspace_path"))),
                objective, null, false
        );
    }

    private UUID findProfile(UUID projectId) {
        try {
            return jdbc.queryForObject("""
                    SELECT id FROM agent_profile
                    WHERE project_id = ? AND enabled = TRUE
                      AND capabilities @> CAST('["READ_FILE","WRITE_FILE","SHELL","GIT","TEST"]' AS jsonb)
                    ORDER BY name, id LIMIT 1
                    """, UUID.class, projectId);
        } catch (EmptyResultDataAccessException error) {
            throw new ProjectStateConflictException(
                    "No enabled Integration Agent Profile provides READ_FILE, WRITE_FILE, SHELL, GIT and TEST."
            );
        }
    }

    private UUID validateProfile(UUID projectId, UUID profileId) {
        Integer count = jdbc.queryForObject("""
                SELECT count(*) FROM agent_profile
                WHERE id = ? AND project_id = ? AND enabled = TRUE
                  AND capabilities @> CAST('["READ_FILE","WRITE_FILE","SHELL","GIT","TEST"]' AS jsonb)
                """, Integer.class, profileId, projectId);
        if (count == null || count != 1) {
            throw new ProjectStateConflictException("Requested Integration Agent Profile is not eligible.");
        }
        return profileId;
    }

    private void appendEvent(UUID gateId, String eventType, String actor, String key, UUID value, String key2, UUID value2) {
        jdbc.update("""
                INSERT INTO integration_gate_event (gate_id, event_type, actor, payload)
                VALUES (?, ?, ?, CAST(? AS jsonb))
                """, gateId, eventType, actor,
                "{\"" + key + "\":\"" + value + "\",\"" + key2 + "\":\"" + value2 + "\"}");
    }

    private void appendFailureEvent(
            UUID gateId,
            String actor,
            UUID agentRunId,
            UUID taskId,
            UUID attemptId,
            String message
    ) {
        var payload = json.createObjectNode()
                .put("agentRunId", agentRunId.toString())
                .put("message", message);
        if (taskId != null) payload.put("taskId", taskId.toString());
        if (attemptId != null) payload.put("attemptId", attemptId.toString());
        try {
            jdbc.update("""
                    INSERT INTO integration_gate_event (gate_id, event_type, actor, payload)
                    VALUES (?, 'INTEGRATION_AGENT_FAILED', ?, CAST(? AS jsonb))
                    """, gateId, actor, json.writeValueAsString(payload));
        } catch (JsonProcessingException serializationError) {
            throw new IllegalStateException("Integration Agent failure event serialization failed.", serializationError);
        }
    }

    private String requireText(String value, String field) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(field + " is required");
        return value.trim();
    }

    static String requestHash(
            UUID projectId,
            UUID planId,
            UUID gateId,
            UUID integrationRunId,
            UUID requestedProfileId
    ) {
        return projectId + "|" + planId + "|" + gateId + "|" + integrationRunId + "|"
                + (requestedProfileId == null ? "AUTO" : requestedProfileId);
    }

    private String safeMessage(Throwable error) {
        String message = error.getMessage();
        return message == null || message.isBlank() ? error.getClass().getSimpleName() : message;
    }

    private String nullable(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private Instant instant(Object value) {
        return value == null ? null : ((Timestamp) value).toInstant();
    }

    private record AgentClaim(
            UUID agentRunId,
            UUID profileId,
            Path workspacePath,
            String objective,
            UUID taskId,
            boolean replayed
    ) {
    }
}
