package com.zhishu.workorder;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zhishu.artifact.ArtifactType;
import com.zhishu.artifact.TaskArtifactRepository;
import com.zhishu.artifact.TaskArtifactView;
import com.zhishu.event.TaskLifecycleObserver;
import com.zhishu.task.AttemptStatus;

/** Maintains only the Work Order projection; Task/Attempt remain the execution truth. */
@Service
public class WorkOrderProjectionService implements TaskLifecycleObserver {

    private final JdbcTemplate jdbc;
    private final TaskArtifactRepository artifacts;
    private final ObjectMapper json;

    public WorkOrderProjectionService(JdbcTemplate jdbc, TaskArtifactRepository artifacts, ObjectMapper json) {
        this.jdbc = jdbc;
        this.artifacts = artifacts;
        this.json = json;
    }

    @Override
    @Transactional
    public void observe(UUID taskId, UUID attemptId, AttemptStatus status) {
        List<Map<String, Object>> bindings = jdbc.query("""
                SELECT b.work_order_id, w.plan_id, w.node_key,
                       w.schedule_id, w.schedule_assignment_id
                FROM work_order_execution_binding b
                JOIN work_order w ON w.id = b.work_order_id
                WHERE b.task_id = ?
                """, (row, number) -> {
            Map<String, Object> value = new LinkedHashMap<>();
            value.put("workOrderId", row.getObject("work_order_id", UUID.class));
            value.put("planId", row.getObject("plan_id", UUID.class));
            value.put("nodeKey", row.getString("node_key"));
            value.put("scheduleId", row.getObject("schedule_id", UUID.class));
            value.put("scheduleAssignmentId", row.getObject("schedule_assignment_id", UUID.class));
            return value;
        }, taskId);
        if (bindings.isEmpty()) return;
        Map<String, Object> binding = bindings.get(0);
        UUID workOrderId = (UUID) binding.get("workOrderId");
        UUID planId = (UUID) binding.get("planId");
        String nodeKey = (String) binding.get("nodeKey");
        String workOrderStatus = workOrderStatus(status);
        String planState = planState(status);
        int updated = jdbc.update("""
                UPDATE work_order_execution
                SET status = ?, status_reason = NULL,
                    dispatch_lease_id = NULL, dispatch_lease_expires_at = NULL, updated_at = now()
                WHERE work_order_id = ? AND status NOT IN ('VERIFIED', 'REJECTED')
                """, workOrderStatus, workOrderId);
        if (updated != 1) return;
        jdbc.update("""
                UPDATE plan_execution_state SET state = ?, task_id = ?, updated_at = now()
                WHERE plan_id = ? AND node_key = ? AND state NOT IN ('COMPLETED', 'CANCELLED', 'SUPERSEDED')
                """, planState, taskId, planId, nodeKey);
        appendEvent(workOrderId, "ATTEMPT_" + status.name(), "CONTROL_PLANE",
                Map.of("taskId", taskId, "attemptId", attemptId));
        updateScheduledAssignment(binding, status, workOrderId, attemptId);
        if (isTerminal(status)) aggregateReport(workOrderId, taskId, attemptId, status);
    }

    @Transactional
    public void markDispatchFailed(UUID workOrderId, UUID taskId, UUID attemptId, String reason) {
        int updated = jdbc.update("""
                UPDATE work_order_execution
                SET status = 'FAILED', status_reason = ?,
                    dispatch_lease_id = NULL, dispatch_lease_expires_at = NULL, updated_at = now()
                WHERE work_order_id = ? AND status NOT IN ('VERIFIED', 'REJECTED')
                """, reason, workOrderId);
        if (updated != 1) return;
        jdbc.update("""
                UPDATE plan_execution_state s SET state = 'FAILED', task_id = ?, updated_at = now()
                FROM work_order w WHERE w.id = ? AND s.plan_id = w.plan_id AND s.node_key = w.node_key
                  AND s.state NOT IN ('COMPLETED', 'CANCELLED', 'SUPERSEDED')
                """, taskId, workOrderId);
        appendEvent(workOrderId, "RUNTIME_DISPATCH_FAILED", "CONTROL_PLANE",
                Map.of("taskId", taskId, "attemptId", attemptId, "reason", reason));
        updateScheduledAssignmentForWorkOrder(workOrderId, "FAILED", attemptId);
        aggregateReport(workOrderId, taskId, attemptId, AttemptStatus.FAILED);
    }

    private void updateScheduledAssignment(
            Map<String, Object> binding,
            AttemptStatus status,
            UUID workOrderId,
            UUID attemptId
    ) {
        UUID scheduleId = (UUID) binding.get("scheduleId");
        UUID assignmentId = (UUID) binding.get("scheduleAssignmentId");
        if (scheduleId == null || assignmentId == null) return;
        String assignmentStatus = switch (status) {
            case FAILED, LOST, ABORTED -> "FAILED";
            default -> "RUNNING";
        };
        updateScheduledAssignment(scheduleId, assignmentId, assignmentStatus, workOrderId, attemptId);
    }

    private void updateScheduledAssignmentForWorkOrder(
            UUID workOrderId,
            String status,
            UUID attemptId
    ) {
        List<Map<String, Object>> values = jdbc.query("""
                SELECT schedule_id, schedule_assignment_id FROM work_order
                WHERE id = ? AND schedule_assignment_id IS NOT NULL
                """, (row, number) -> Map.of(
                "scheduleId", row.getObject("schedule_id", UUID.class),
                "assignmentId", row.getObject("schedule_assignment_id", UUID.class)
        ), workOrderId);
        if (values.isEmpty()) return;
        updateScheduledAssignment(
                (UUID) values.get(0).get("scheduleId"),
                (UUID) values.get(0).get("assignmentId"),
                status,
                workOrderId,
                attemptId
        );
    }

    private void updateScheduledAssignment(
            UUID scheduleId,
            UUID assignmentId,
            String status,
            UUID workOrderId,
            UUID attemptId
    ) {
        int updated = jdbc.update("""
                UPDATE parallel_schedule_assignment SET status = ?, updated_at = now()
                WHERE id = ? AND schedule_id = ? AND status NOT IN ('VERIFIED', 'CANCELLED')
                  AND status <> ?
                """, status, assignmentId, scheduleId, status);
        if (updated == 0) return;
        jdbc.update("""
                INSERT INTO parallel_schedule_event (schedule_id, event_type, actor, payload)
                VALUES (?, 'ASSIGNMENT_EXECUTION_CHANGED', 'CONTROL_PLANE', CAST(? AS jsonb))
                """, scheduleId, write(Map.of(
                "assignmentId", assignmentId,
                "workOrderId", workOrderId,
                "attemptId", attemptId,
                "status", status
        )));
    }

    private void aggregateReport(UUID workOrderId, UUID taskId, UUID attemptId, AttemptStatus status) {
        List<Map<String, Object>> claims = new ArrayList<>();
        List<Map<String, Object>> evidence = new ArrayList<>();
        for (TaskArtifactView artifact : artifacts.findByAttemptId(attemptId)) {
            Map<String, Object> item = artifactValue(artifact);
            if (artifact.artifactType() == ArtifactType.SUMMARY
                    || artifact.artifactType() == ArtifactType.ERROR_REPORT) {
                claims.add(item);
            }
            if (isSystemEvidence(artifact)) evidence.add(item);
        }
        UUID reportId = UUID.randomUUID();
        int inserted = jdbc.update("""
                INSERT INTO execution_report (
                    id, work_order_id, task_id, attempt_id, attempt_status, agent_claims, system_evidence
                ) VALUES (?, ?, ?, ?, ?, CAST(? AS jsonb), CAST(? AS jsonb))
                ON CONFLICT (attempt_id) DO NOTHING
                """, reportId, workOrderId, taskId, attemptId, status.name(), write(claims), write(evidence));
        if (inserted == 1) {
            appendEvent(workOrderId, "EXECUTION_REPORT_GENERATED", "CONTROL_PLANE", Map.of(
                    "reportId", reportId, "attemptId", attemptId,
                    "agentClaimCount", claims.size(), "systemEvidenceCount", evidence.size()
            ));
        }
    }

    private boolean isSystemEvidence(TaskArtifactView artifact) {
        if (!"NODE_RUNTIME".equals(artifact.producer())) return false;
        if (!List.of(ArtifactType.FILE_CHANGE, ArtifactType.GIT_DIFF, ArtifactType.TEST_REPORT)
                .contains(artifact.artifactType())) return false;
        Object isError = artifact.metadata().get("isError");
        return !Boolean.TRUE.equals(isError) && artifact.hash() != null && !artifact.hash().isBlank();
    }

    private Map<String, Object> artifactValue(TaskArtifactView artifact) {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("artifactId", artifact.id());
        value.put("artifactType", artifact.artifactType().name());
        value.put("producer", artifact.producer());
        value.put("content", artifact.contentPlain());
        value.put("hash", artifact.hash());
        value.put("metadata", artifact.metadata());
        value.put("observedAt", artifact.createdAt());
        return value;
    }

    private String workOrderStatus(AttemptStatus status) {
        return switch (status) {
            case PENDING, STARTING -> "DISPATCHED";
            case RUNNING -> "RUNNING";
            case WAITING_APPROVAL -> "WAITING_APPROVAL";
            case CANCELLING -> "RUNNING";
            case SUCCEEDED -> "AWAITING_VERIFICATION";
            case FAILED -> "FAILED";
            case LOST -> "LOST";
            case ABORTED -> "ABORTED";
        };
    }

    private String planState(AttemptStatus status) {
        return switch (status) {
            case PENDING, STARTING -> "DISPATCHING";
            case RUNNING, CANCELLING -> "RUNNING";
            case WAITING_APPROVAL -> "WAITING_APPROVAL";
            case SUCCEEDED -> "VERIFYING";
            case FAILED, LOST, ABORTED -> "FAILED";
        };
    }

    private boolean isTerminal(AttemptStatus status) {
        return status == AttemptStatus.SUCCEEDED || status == AttemptStatus.FAILED
                || status == AttemptStatus.LOST || status == AttemptStatus.ABORTED;
    }

    void appendEvent(UUID workOrderId, String type, String actor, Object payload) {
        jdbc.update("""
                INSERT INTO work_order_event (work_order_id, event_type, actor, payload)
                VALUES (?, ?, ?, CAST(? AS jsonb))
                """, workOrderId, type, actor, write(payload));
    }

    private String write(Object value) {
        try { return json.writeValueAsString(value); }
        catch (JsonProcessingException error) {
            throw new IllegalArgumentException("Work Order projection JSON serialization failed", error);
        }
    }
}
