package com.zhishu.integration;

import java.util.Map;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zhishu.event.TaskLifecycleObserver;
import com.zhishu.task.AttemptStatus;

/** Persists Integration Agent lifecycle state from committed Task/Attempt transitions. */
@Service
public class IntegrationAgentProjectionService implements TaskLifecycleObserver {

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public IntegrationAgentProjectionService(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    @Override
    @Transactional
    public void observe(UUID taskId, UUID attemptId, AttemptStatus status) {
        String projectedStatus = projectedStatus(status);
        if (projectedStatus == null) return;
        String failureMessage = "FAILED".equals(projectedStatus)
                ? failureMessage(taskId, attemptId) : null;
        boolean terminal = isTerminal(projectedStatus);
        int updated = jdbc.update("""
                UPDATE integration_agent_run
                SET status = ?, started_at = COALESCE(started_at, now()),
                    completed_at = CASE WHEN ? THEN COALESCE(completed_at, now()) ELSE completed_at END,
                    failure_message = ?
                WHERE task_id = ? AND attempt_id = ?
                  AND status IN ('PREPARING', 'RUNNING') AND status <> ?
                """, projectedStatus, terminal, failureMessage, taskId, attemptId, projectedStatus);
        if (updated != 1) return;
        jdbc.update("""
                INSERT INTO integration_gate_event (gate_id, event_type, actor, payload)
                SELECT gate_id, ?, 'CONTROL_PLANE', CAST(? AS jsonb)
                FROM integration_agent_run WHERE task_id = ? AND attempt_id = ?
                """, "INTEGRATION_AGENT_" + projectedStatus, write(Map.of(
                "taskId", taskId,
                "attemptId", attemptId,
                "attemptStatus", status.name(),
                "status", projectedStatus
        )), taskId, attemptId);
    }

    static String projectedStatus(AttemptStatus status) {
        return switch (status) {
            case RUNNING, WAITING_APPROVAL, CANCELLING -> "RUNNING";
            case SUCCEEDED -> "SUCCEEDED";
            case FAILED, LOST -> "FAILED";
            case ABORTED -> "CANCELLED";
            case PENDING, STARTING -> null;
        };
    }

    private boolean isTerminal(String status) {
        return "SUCCEEDED".equals(status) || "FAILED".equals(status) || "CANCELLED".equals(status);
    }

    private String failureMessage(UUID taskId, UUID attemptId) {
        String message = jdbc.queryForObject("""
                SELECT COALESCE(NULLIF(error_message, ''), NULLIF(lost_reason, ''),
                                'Integration Agent attempt failed.')
                FROM task_attempt WHERE id = ? AND task_id = ?
                """, String.class, attemptId, taskId);
        return message == null || message.isBlank() ? "Integration Agent attempt failed." : message;
    }

    private String write(Object value) {
        try {
            return json.writeValueAsString(value);
        } catch (JsonProcessingException error) {
            throw new IllegalStateException("Integration Agent event JSON serialization failed", error);
        }
    }
}
