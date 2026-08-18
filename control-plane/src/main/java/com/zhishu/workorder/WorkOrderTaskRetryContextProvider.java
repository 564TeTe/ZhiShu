package com.zhishu.workorder;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zhishu.state.ProjectStateConflictException;
import com.zhishu.task.TaskRetryContextProvider;
import com.zhishu.task.TaskView;

@Component
public class WorkOrderTaskRetryContextProvider implements TaskRetryContextProvider {

    private static final List<String> RETRYABLE_STATUSES = List.of("FAILED", "LOST", "ABORTED");

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final WorkOrderProjectionService projection;

    public WorkOrderTaskRetryContextProvider(
            JdbcTemplate jdbc,
            ObjectMapper json,
            WorkOrderProjectionService projection
    ) {
        this.jdbc = jdbc;
        this.json = json;
        this.projection = projection;
    }

    @Override
    public Map<String, Object> prepareRetry(TaskView task) {
        Map<String, Object> workOrder;
        try {
            workOrder = jdbc.queryForMap("""
                    SELECT w.id, w.plan_id, w.plan_version_id, v.version_number, w.node_key,
                           w.objective, w.acceptance_criteria::text AS acceptance_criteria,
                           w.required_capabilities::text AS required_capabilities,
                           w.context_version::text AS context_version, w.created_at, x.status,
                           w.schedule_id, w.schedule_assignment_id, w.workspace_lease_id,
                           w.execution_workspace_path
                    FROM work_order_execution_binding b
                    JOIN work_order w ON w.id = b.work_order_id
                    JOIN work_order_execution x ON x.work_order_id = w.id
                    JOIN plan_version v ON v.id = w.plan_version_id
                    WHERE b.task_id = ?
                    FOR UPDATE OF x
                    """, task.taskId());
        } catch (EmptyResultDataAccessException ignored) {
            return Map.of();
        }

        UUIDs values = new UUIDs(
                (java.util.UUID) workOrder.get("id"),
                (java.util.UUID) workOrder.get("plan_id"),
                (java.util.UUID) workOrder.get("plan_version_id")
        );
        String nodeKey = (String) workOrder.get("node_key");
        jdbc.queryForObject("""
                SELECT state FROM plan_execution_state
                WHERE plan_id = ? AND node_key = ?
                FOR UPDATE
                """, String.class, values.planId(), nodeKey);

        String status = (String) workOrder.get("status");
        if (!RETRYABLE_STATUSES.contains(status)) {
            throw new ProjectStateConflictException(
                    "Work Order retry requires a current execution failure; current status is " + status + "."
            );
        }
        Integer newer = jdbc.queryForObject("""
                SELECT count(*) FROM work_order
                WHERE plan_id = ? AND node_key = ?
                  AND (created_at, id) > (?, ?)
                """, Integer.class, values.planId(), nodeKey, workOrder.get("created_at"), values.workOrderId());
        if (newer != null && newer > 0) {
            throw new ProjectStateConflictException(
                    "This historical Work Order cannot be retried because a newer Work Order exists."
            );
        }

        jdbc.update("""
                UPDATE work_order_execution
                SET status = 'DISPATCHING', status_reason = NULL,
                    dispatch_lease_id = NULL, dispatch_lease_expires_at = NULL, updated_at = now()
                WHERE work_order_id = ?
                """, values.workOrderId());
        jdbc.update("""
                UPDATE plan_execution_state
                SET state = 'DISPATCHING', task_id = ?, updated_at = now()
                WHERE plan_id = ? AND node_key = ?
                """, task.taskId(), values.planId(), nodeKey);
        if (workOrder.get("schedule_assignment_id") != null) {
            jdbc.update("""
                    UPDATE parallel_schedule_assignment SET status = 'RUNNING', updated_at = now()
                    WHERE id = ? AND schedule_id = ? AND status = 'FAILED'
                    """, workOrder.get("schedule_assignment_id"), workOrder.get("schedule_id"));
        }
        projection.appendEvent(values.workOrderId(), "WORK_ORDER_RETRY_CLAIMED", "CONTROL_PLANE", Map.of(
                "taskId", task.taskId(), "previousAttemptId", task.attemptId()
        ));

        Map<String, Object> context = new LinkedHashMap<>();
        context.put("schemaVersion", "1.0");
        context.put("workOrderId", values.workOrderId());
        context.put("planId", values.planId());
        context.put("planVersionId", values.planVersionId());
        context.put("planVersion", workOrder.get("version_number"));
        context.put("nodeKey", nodeKey);
        context.put("objective", workOrder.get("objective"));
        context.put("acceptanceCriteria", read((String) workOrder.get("acceptance_criteria")));
        context.put("requiredCapabilities", read((String) workOrder.get("required_capabilities")));
        context.put("contextVersion", read((String) workOrder.get("context_version")));
        if (workOrder.get("schedule_assignment_id") != null) {
            context.put("scheduleId", workOrder.get("schedule_id"));
            context.put("scheduleAssignmentId", workOrder.get("schedule_assignment_id"));
            context.put("workspaceLeaseId", workOrder.get("workspace_lease_id"));
            context.put("executionWorkspacePath", workOrder.get("execution_workspace_path"));
        }
        return Map.of("workOrderContext", context);
    }

    private com.fasterxml.jackson.databind.JsonNode read(String value) {
        try {
            return json.readTree(value);
        } catch (JsonProcessingException error) {
            throw new IllegalStateException("Stored Work Order JSON is unreadable", error);
        }
    }

    private record UUIDs(
            java.util.UUID workOrderId,
            java.util.UUID planId,
            java.util.UUID planVersionId
    ) {
    }
}
