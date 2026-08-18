package com.zhishu.workorder;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zhishu.approval.ApprovalMode;
import com.zhishu.brain.BrainCollaborationService;
import com.zhishu.state.ContextPackageView;
import com.zhishu.state.ProjectStateConflictException;
import com.zhishu.state.ProjectStateService;
import com.zhishu.task.AttemptStatus;
import com.zhishu.task.CreateTaskCommand;
import com.zhishu.task.TaskApplicationService;
import com.zhishu.task.TaskView;

@Service
public class WorkOrderService {

    private static final Logger log = LoggerFactory.getLogger(WorkOrderService.class);

    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    private final ObjectMapper json;
    private final TaskApplicationService tasks;
    private final WorkOrderProjectionService projection;
    private final ProjectStateService state;
    private final BrainCollaborationService brain;
    private final long dispatchLeaseSeconds;

    public WorkOrderService(
            JdbcTemplate jdbc,
            TransactionTemplate transactions,
            ObjectMapper json,
            TaskApplicationService tasks,
            WorkOrderProjectionService projection,
            ProjectStateService state,
            BrainCollaborationService brain,
            @Value("${zhishu.work-order.dispatch.lease-seconds:30}") long dispatchLeaseSeconds
    ) {
        this.jdbc = jdbc;
        this.transactions = transactions;
        this.json = json;
        this.tasks = tasks;
        this.projection = projection;
        this.state = state;
        this.brain = brain;
        if (dispatchLeaseSeconds <= 0) throw new IllegalArgumentException("dispatchLeaseSeconds must be positive");
        this.dispatchLeaseSeconds = dispatchLeaseSeconds;
    }

    public Map<String, Object> claimAndDispatch(UUID projectId, String actor, ClaimCommand command) {
        String normalizedActor = requireText(actor, "actor");
        String requestId = requireText(command.clientRequestId(), "clientRequestId");
        UUID requestedPlanId = command.planId();
        UUID profileId = command.profileId();
        String nodeKey = requireText(command.nodeKey(), "nodeKey");
        String requestHash = sha256(projectId + "|" + requestedPlanId + "|" + nodeKey + "|" + profileId
                + "|" + (command.approvalMode() == null ? "MANUAL" : command.approvalMode().name()));
        DispatchClaim claim = transactions.execute(tx -> claimInTransaction(
                projectId, normalizedActor, requestId, requestHash, requestedPlanId,
                profileId, nodeKey, command.approvalMode(), null
        ));
        if (claim == null) throw new IllegalStateException("Work Order claim returned no result");
        if (claim.leaseId() != null) dispatchLeased(claim.workOrderId(), claim.leaseId());
        Map<String, Object> result = get(projectId, claim.workOrderId());
        result.put("replayed", claim.replayed());
        return result;
    }

    public ScheduleDispatchView claimScheduleAndDispatch(
            UUID projectId,
            String actor,
            ScheduleDispatchCommand command
    ) {
        String normalizedActor = requireText(actor, "actor");
        String requestId = requireText(command.clientRequestId(), "clientRequestId");
        String requestHash = sha256(projectId + "|" + command.planId() + "|" + command.scheduleId()
                + "|" + (command.approvalMode() == null ? "MANUAL" : command.approvalMode().name()));
        ScheduleDispatchClaim dispatch = transactions.execute(tx -> claimScheduleInTransaction(
                projectId, normalizedActor, requestId, requestHash, command
        ));
        if (dispatch == null) throw new IllegalStateException("Schedule dispatch returned no result");
        RuntimeException firstFailure = null;
        for (DispatchClaim claim : dispatch.workOrders()) {
            if (claim.leaseId() == null) continue;
            try {
                dispatchLeased(claim.workOrderId(), claim.leaseId());
            } catch (RuntimeException error) {
                if (firstFailure == null) firstFailure = error;
            }
        }
        if (firstFailure != null) throw firstFailure;
        List<Map<String, Object>> workOrderViews = dispatch.workOrders().stream()
                .map(claim -> get(projectId, claim.workOrderId()))
                .toList();
        return new ScheduleDispatchView(
                dispatch.dispatchId(), command.scheduleId(), command.planId(), dispatch.replayed(), workOrderViews
        );
    }

    private ScheduleDispatchClaim claimScheduleInTransaction(
            UUID projectId,
            String actor,
            String requestId,
            String requestHash,
            ScheduleDispatchCommand command
    ) {
        jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))",
                Object.class, projectId + "|schedule-dispatch|" + requestId);
        List<Map<String, Object>> replay = jdbc.query("""
                SELECT id, plan_id, schedule_id, request_hash
                FROM parallel_schedule_dispatch
                WHERE project_id = ? AND created_by = ? AND client_request_id = ?
                FOR UPDATE
                """, (row, number) -> Map.of(
                "id", row.getObject("id", UUID.class),
                "planId", row.getObject("plan_id", UUID.class),
                "scheduleId", row.getObject("schedule_id", UUID.class),
                "requestHash", row.getString("request_hash")
        ), projectId, actor, requestId);
        if (!replay.isEmpty()) {
            Map<String, Object> existing = replay.get(0);
            if (!command.planId().equals(existing.get("planId"))
                    || !command.scheduleId().equals(existing.get("scheduleId"))
                    || !requestHash.equals(existing.get("requestHash"))) {
                throw new ProjectStateConflictException(
                        "clientRequestId was already used for a different Parallel Schedule dispatch."
                );
            }
            UUID dispatchId = (UUID) existing.get("id");
            return new ScheduleDispatchClaim(dispatchId, replayDispatchClaims(dispatchId), true);
        }

        Map<String, Object> schedule;
        try {
            schedule = jdbc.queryForMap("""
                    SELECT schedule.id, schedule.plan_version_id, schedule.status,
                           schedule.base_state_revision, schedule.base_plan_version,
                           plan.current_version_id, version.version_number,
                           state.state_revision
                    FROM parallel_schedule_proposal schedule
                    JOIN project_plan plan ON plan.id = schedule.plan_id
                    JOIN plan_version version ON version.id = plan.current_version_id
                    JOIN project_state_snapshot state ON state.project_id = schedule.project_id
                    WHERE schedule.id = ? AND schedule.project_id = ? AND schedule.plan_id = ?
                      AND plan.status = 'ACTIVE'
                    FOR UPDATE OF schedule
                    """, command.scheduleId(), projectId, command.planId());
        } catch (EmptyResultDataAccessException error) {
            throw new ProjectStateConflictException("Parallel Schedule was not found for dispatch.");
        }
        if (!"APPROVED".equals(schedule.get("status"))) {
            throw new ProjectStateConflictException("Parallel Schedule dispatch requires an approved Schedule.");
        }
        if (!schedule.get("plan_version_id").equals(schedule.get("current_version_id"))
                || ((Number) schedule.get("base_plan_version")).longValue()
                        != ((Number) schedule.get("version_number")).longValue()
                || ((Number) schedule.get("base_state_revision")).longValue()
                        != ((Number) schedule.get("state_revision")).longValue()) {
            throw new ProjectStateConflictException(
                    "Parallel Schedule dispatch requires the current Plan and State baseline."
            );
        }
        List<ScheduleAssignment> assignments = jdbc.query("""
                SELECT assignment.id, assignment.node_key, assignment.worker_slot,
                       assignment.profile_id, assignment.status,
                       lease.id AS lease_id, lease.status AS lease_status,
                       lease.provisioning_state, lease.workspace_path, lease.ownership_token,
                       lease.physical_workspace_kind,
                       execution.state AS execution_state
                FROM parallel_schedule_assignment assignment
                JOIN workspace_lease lease ON lease.assignment_id = assignment.id
                JOIN plan_execution_state execution
                  ON execution.plan_id = assignment.plan_id AND execution.node_key = assignment.node_key
                WHERE assignment.schedule_id = ? AND assignment.project_id = ?
                ORDER BY assignment.worker_slot
                FOR UPDATE OF assignment, lease, execution
                """, (row, number) -> new ScheduleAssignment(
                row.getObject("id", UUID.class), row.getString("node_key"), row.getInt("worker_slot"),
                row.getObject("profile_id", UUID.class), row.getString("status"),
                row.getObject("lease_id", UUID.class), row.getString("lease_status"),
                row.getString("provisioning_state"), row.getString("workspace_path"),
                row.getString("ownership_token"), row.getString("physical_workspace_kind"),
                row.getString("execution_state")
        ), command.scheduleId(), projectId);
        if (assignments.size() != 2) {
            throw new ProjectStateConflictException("Parallel Schedule dispatch requires exactly two Assignments.");
        }
        for (ScheduleAssignment assignment : assignments) {
            if (!"PROVISIONED".equals(assignment.status())
                    || !"PROVISIONED".equals(assignment.leaseStatus())
                    || !"PROVISIONED".equals(assignment.provisioningState())
                    || assignment.workspacePath() == null || assignment.workspacePath().isBlank()
                    || assignment.ownershipToken() == null || assignment.ownershipToken().isBlank()) {
                throw new ProjectStateConflictException(
                        "Parallel Schedule dispatch requires two fully provisioned isolated Leases."
                );
            }
            if (!"READY".equals(assignment.executionState())) {
                throw new ProjectStateConflictException(
                        "Scheduled Plan node is not READY: " + assignment.nodeKey()
                );
            }
        }
        if (!assignments.get(0).physicalWorkspaceKind().equals(assignments.get(1).physicalWorkspaceKind())) {
            throw new ProjectStateConflictException(
                    "Parallel Schedule dispatch requires one consistent physical Workspace kind."
            );
        }

        UUID dispatchId = UUID.randomUUID();
        try {
            jdbc.update("""
                    INSERT INTO parallel_schedule_dispatch (
                        id, project_id, plan_id, schedule_id, client_request_id, request_hash, created_by
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """, dispatchId, projectId, command.planId(), command.scheduleId(), requestId,
                    requestHash, actor);
        } catch (org.springframework.dao.DataIntegrityViolationException error) {
            throw new ProjectStateConflictException("Parallel Schedule was already dispatched.");
        }

        List<DispatchClaim> claims = new ArrayList<>();
        for (ScheduleAssignment assignment : assignments) {
            ScheduledExecution scheduled = new ScheduledExecution(
                    dispatchId, command.scheduleId(), assignment.assignmentId(), assignment.leaseId(),
                    assignment.workspacePath(), assignment.workerSlot()
            );
            String workOrderRequestId = "schedule-" + sha256(requestId + "|" + assignment.assignmentId());
            String workOrderRequestHash = sha256(
                    projectId + "|" + command.planId() + "|" + assignment.nodeKey() + "|"
                            + assignment.profileId() + "|" + command.scheduleId() + "|"
                            + assignment.assignmentId() + "|" + assignment.leaseId() + "|"
                            + assignment.workspacePath() + "|"
                            + (command.approvalMode() == null ? "MANUAL" : command.approvalMode().name())
            );
            claims.add(claimInTransaction(
                    projectId, actor, workOrderRequestId, workOrderRequestHash, command.planId(),
                    assignment.profileId(), assignment.nodeKey(), command.approvalMode(), scheduled
            ));
        }
        jdbc.update("""
                UPDATE parallel_schedule_assignment SET status = 'RUNNING', updated_at = now()
                WHERE schedule_id = ? AND status = 'PROVISIONED'
                """, command.scheduleId());
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("dispatchId", dispatchId);
        event.put("workOrderIds", claims.stream().map(DispatchClaim::workOrderId).toList());
        event.put("workspaceKind", assignments.get(0).physicalWorkspaceKind());
        jdbc.update("""
                INSERT INTO parallel_schedule_event (schedule_id, event_type, actor, payload)
                VALUES (?, 'DISPATCHED', ?, CAST(? AS jsonb))
                """, command.scheduleId(), actor, write(event));
        return new ScheduleDispatchClaim(dispatchId, List.copyOf(claims), false);
    }

    private List<DispatchClaim> replayDispatchClaims(UUID dispatchId) {
        List<UUID> workOrderIds = jdbc.query("""
                SELECT work_order.id
                FROM work_order
                JOIN parallel_schedule_assignment assignment
                  ON assignment.id = work_order.schedule_assignment_id
                WHERE work_order.schedule_dispatch_id = ?
                ORDER BY assignment.worker_slot
                """, (row, number) -> row.getObject("id", UUID.class), dispatchId);
        if (workOrderIds.size() != 2) {
            throw new IllegalStateException("Stored Parallel Schedule dispatch does not contain two Work Orders");
        }
        return workOrderIds.stream()
                .map(workOrderId -> new DispatchClaim(
                        workOrderId, acquireDispatchLease(workOrderId, true), true
                ))
                .toList();
    }

    private DispatchClaim claimInTransaction(
            UUID projectId,
            String actor,
            String requestId,
            String requestHash,
            UUID planId,
            UUID profileId,
            String nodeKey,
            ApprovalMode requestedApprovalMode,
            ScheduledExecution scheduled
    ) {
        jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))",
                Object.class, projectId + "|" + requestId);
        List<Map<String, Object>> replay = jdbc.query("""
                SELECT id, request_hash FROM work_order
                WHERE project_id = ? AND client_request_id = ? FOR UPDATE
                """, (row, number) -> Map.of(
                "id", row.getObject("id", UUID.class), "hash", row.getString("request_hash")
        ), projectId, requestId);
        if (!replay.isEmpty()) {
            if (!requestHash.equals(replay.get(0).get("hash"))) {
                throw new ProjectStateConflictException(
                        "clientRequestId was already used for a different Work Order claim.");
            }
            UUID workOrderId = (UUID) replay.get(0).get("id");
            return new DispatchClaim(workOrderId, acquireDispatchLease(workOrderId, true), true);
        }
        Map<String, Object> node;
        try {
            node = jdbc.queryForMap("""
                    SELECT p.id AS plan_id, p.current_version_id, v.version_number, v.base_state_revision,
                           n.title, n.objective, n.acceptance_criteria::text AS acceptance_criteria,
                           n.required_capabilities::text AS required_capabilities, n.executable,
                           s.state AS execution_state
                    FROM project_plan p
                    JOIN plan_version v ON v.id = p.current_version_id
                    JOIN plan_node_definition n ON n.plan_version_id = v.id AND n.node_key = ?
                    JOIN plan_execution_state s ON s.plan_id = p.id AND s.node_key = n.node_key
                    WHERE p.id = ? AND p.project_id = ? AND p.status = 'ACTIVE'
                    FOR UPDATE OF s
                    """, nodeKey, planId, projectId);
        } catch (EmptyResultDataAccessException error) {
            throw new ProjectStateConflictException("The current Plan node was not found.");
        }
        if (!Boolean.TRUE.equals(node.get("executable"))) {
            throw new ProjectStateConflictException("Plan node is not executable with the enabled project profiles.");
        }
        String executionState = (String) node.get("execution_state");
        if (!List.of("READY", "APPROVED_FOR_EXECUTION", "FAILED", "BLOCKED").contains(executionState)) {
            throw new ProjectStateConflictException("Plan node cannot be dispatched from state " + executionState + ".");
        }
        Integer active = jdbc.queryForObject("""
                SELECT count(*) FROM work_order w JOIN work_order_execution x ON x.work_order_id = w.id
                WHERE w.plan_id = ? AND w.node_key = ?
                  AND x.status IN ('CLAIMED','DISPATCHING','DISPATCHED','RUNNING','WAITING_APPROVAL','AWAITING_VERIFICATION')
                """, Integer.class, planId, nodeKey);
        if (active != null && active > 0) {
            throw new ProjectStateConflictException("Plan node already has an active Work Order.");
        }
        Long executionWatermark = jdbc.queryForObject("""
                SELECT COALESCE(max(te.id), 0) FROM task_event te
                JOIN agent_task t ON t.id = te.task_id WHERE t.project_id = ?
                """, Long.class, projectId);
        Map<String, Object> contextVersion = new LinkedHashMap<>();
        contextVersion.put("workOrderContextVersion", "1.0");
        contextVersion.put("planVersionId", node.get("current_version_id"));
        contextVersion.put("planVersion", node.get("version_number"));
        contextVersion.put("stateRevision", currentStateRevision(projectId));
        contextVersion.put("executionWatermark", executionWatermark == null ? 0 : executionWatermark);
        contextVersion.put("capturedAt", Instant.now());
        if (scheduled != null) {
            contextVersion.put("scheduleId", scheduled.scheduleId());
            contextVersion.put("scheduleAssignmentId", scheduled.assignmentId());
            contextVersion.put("workspaceLeaseId", scheduled.leaseId());
            contextVersion.put("executionWorkspacePath", scheduled.workspacePath());
        }
        UUID workOrderId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO work_order (
                    id, project_id, plan_id, plan_version_id, node_key, client_request_id, request_hash,
                    profile_id, title, objective, acceptance_criteria, required_capabilities,
                    context_version, created_by, schedule_dispatch_id, schedule_id,
                    schedule_assignment_id, workspace_lease_id, execution_workspace_path
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS jsonb), CAST(? AS jsonb),
                          CAST(? AS jsonb), ?, ?, ?, ?, ?, ?)
                """, workOrderId, projectId, planId, node.get("current_version_id"), nodeKey, requestId,
                requestHash, profileId, node.get("title"), node.get("objective"), node.get("acceptance_criteria"),
                node.get("required_capabilities"), write(contextVersion), actor,
                scheduled == null ? null : scheduled.dispatchId(),
                scheduled == null ? null : scheduled.scheduleId(),
                scheduled == null ? null : scheduled.assignmentId(),
                scheduled == null ? null : scheduled.leaseId(),
                scheduled == null ? null : scheduled.workspacePath());
        jdbc.update("INSERT INTO work_order_execution (work_order_id, status) VALUES (?, 'CLAIMED')", workOrderId);
        Map<String, Object> workOrderContext = new LinkedHashMap<>();
        workOrderContext.put("schemaVersion", "1.0");
        workOrderContext.put("workOrderId", workOrderId);
        workOrderContext.put("planId", planId);
        workOrderContext.put("planVersionId", node.get("current_version_id"));
        workOrderContext.put("planVersion", node.get("version_number"));
        workOrderContext.put("nodeKey", nodeKey);
        workOrderContext.put("objective", node.get("objective"));
        workOrderContext.put("acceptanceCriteria", read((String) node.get("acceptance_criteria")));
        workOrderContext.put("requiredCapabilities", read((String) node.get("required_capabilities")));
        workOrderContext.put("contextVersion", contextVersion);
        if (scheduled != null) {
            workOrderContext.put("scheduleId", scheduled.scheduleId());
            workOrderContext.put("scheduleAssignmentId", scheduled.assignmentId());
            workOrderContext.put("workspaceLeaseId", scheduled.leaseId());
            workOrderContext.put("workerSlot", scheduled.workerSlot());
            workOrderContext.put("executionWorkspacePath", scheduled.workspacePath());
        }
        CreateTaskCommand taskCommand = new CreateTaskCommand(
                projectId, profileId, (String) node.get("title"), (String) node.get("objective"),
                null, null, null, requestedApprovalMode, Map.of("workOrderContext", workOrderContext)
        );
        TaskApplicationService.PreparedTask prepared = scheduled == null
                ? tasks.prepare(taskCommand)
                : tasks.prepareInWorkspace(taskCommand, scheduled.workspacePath());
        validateCapabilities(node.get("required_capabilities"), prepared);
        jdbc.update("""
                INSERT INTO work_order_execution_binding (id, work_order_id, task_id, initial_attempt_id)
                VALUES (?, ?, ?, ?)
                """, UUID.randomUUID(), workOrderId, prepared.taskId(), prepared.attempt().id());
        jdbc.update("""
                UPDATE work_order_execution SET status = 'DISPATCHING', updated_at = now() WHERE work_order_id = ?
                """, workOrderId);
        jdbc.update("""
                UPDATE plan_execution_state SET state = 'DISPATCHING', task_id = ?, updated_at = now()
                WHERE plan_id = ? AND node_key = ?
                """, prepared.taskId(), planId, nodeKey);
        projection.appendEvent(workOrderId, "WORK_ORDER_CLAIMED", actor, Map.of(
                "clientRequestId", requestId, "taskId", prepared.taskId(),
                "initialAttemptId", prepared.attempt().id(), "contextVersion", contextVersion
        ));
        return new DispatchClaim(workOrderId, acquireDispatchLease(workOrderId), false);
    }

    /** Recovers bounded batches of post-commit dispatches whose short lease expired. */
    public void recoverDispatches(int limit) {
        int boundedLimit = Math.max(1, Math.min(limit, 100));
        List<UUID> candidates = jdbc.query("""
                SELECT work_order_id FROM work_order_execution
                WHERE status = 'DISPATCHING'
                  AND (dispatch_lease_id IS NULL OR dispatch_lease_expires_at <= now())
                ORDER BY updated_at
                LIMIT ?
                """, (row, number) -> row.getObject("work_order_id", UUID.class), boundedLimit);
        for (UUID workOrderId : candidates) {
            UUID leaseId = transactions.execute(tx -> acquireDispatchLease(workOrderId, false));
            if (leaseId == null) continue;
            try {
                dispatchLeased(workOrderId, leaseId);
            } catch (RuntimeException error) {
                // Keep the lease durable so the next bounded scan can retry after expiry.
                log.warn("Work Order dispatch recovery failed for {}", workOrderId, error);
            }
        }
    }

    private UUID acquireDispatchLease(UUID workOrderId) {
        return acquireDispatchLease(workOrderId, false);
    }

    private UUID acquireDispatchLease(UUID workOrderId, boolean allowReplayTakeover) {
        UUID leaseId = UUID.randomUUID();
        Timestamp expiresAt = Timestamp.from(Instant.now().plusSeconds(dispatchLeaseSeconds));
        String leaseGuard = allowReplayTakeover ? "" : """
                  AND (dispatch_lease_id IS NULL OR dispatch_lease_expires_at IS NULL
                       OR dispatch_lease_expires_at <= now())
                """;
        int updated = jdbc.update("""
                UPDATE work_order_execution
                SET dispatch_lease_id = ?, dispatch_lease_expires_at = ?,
                    dispatch_attempts = dispatch_attempts + 1, last_dispatch_at = now(), updated_at = now()
                WHERE work_order_id = ? AND status = 'DISPATCHING'
                """ + leaseGuard, leaseId, expiresAt, workOrderId);
        return updated == 1 ? leaseId : null;
    }

    private void dispatchLeased(UUID workOrderId, UUID leaseId) {
        Map<String, Object> row;
        try {
            row = jdbc.queryForMap("""
                    SELECT w.plan_id, w.plan_version_id, v.version_number, w.node_key, w.objective,
                           w.acceptance_criteria::text AS acceptance_criteria,
                           w.required_capabilities::text AS required_capabilities,
                           w.context_version::text AS context_version,
                           w.schedule_id, w.schedule_assignment_id, w.workspace_lease_id,
                           w.execution_workspace_path, assignment.worker_slot,
                           b.task_id, t.current_attempt_id, t.status,
                           (SELECT previous.id FROM task_attempt previous
                            JOIN task_attempt current_attempt ON current_attempt.id = t.current_attempt_id
                            WHERE previous.task_id = t.id
                              AND previous.attempt_number < current_attempt.attempt_number
                            ORDER BY previous.attempt_number DESC LIMIT 1) AS retry_of_attempt_id
                    FROM work_order w
                    JOIN plan_version v ON v.id = w.plan_version_id
                    JOIN work_order_execution x ON x.work_order_id = w.id
                    JOIN work_order_execution_binding b ON b.work_order_id = w.id
                    JOIN agent_task t ON t.id = b.task_id
                    LEFT JOIN parallel_schedule_assignment assignment
                      ON assignment.id = w.schedule_assignment_id
                    WHERE w.id = ? AND x.dispatch_lease_id = ? AND x.status = 'DISPATCHING'
                    """, workOrderId, leaseId);
        } catch (EmptyResultDataAccessException ignored) {
            return;
        }
        UUID taskId = (UUID) row.get("task_id");
        UUID attemptId = (UUID) row.get("current_attempt_id");
        if (attemptId == null) throw new IllegalStateException("Work Order Task has no current Attempt");
        Map<String, Object> context = new LinkedHashMap<>();
        context.put("schemaVersion", "1.0");
        context.put("workOrderId", workOrderId);
        context.put("planId", row.get("plan_id"));
        context.put("planVersionId", row.get("plan_version_id"));
        context.put("planVersion", row.get("version_number"));
        context.put("nodeKey", row.get("node_key"));
        context.put("objective", row.get("objective"));
        context.put("acceptanceCriteria", read((String) row.get("acceptance_criteria")));
        context.put("requiredCapabilities", read((String) row.get("required_capabilities")));
        context.put("contextVersion", read((String) row.get("context_version")));
        if (row.get("schedule_assignment_id") != null) {
            context.put("scheduleId", row.get("schedule_id"));
            context.put("scheduleAssignmentId", row.get("schedule_assignment_id"));
            context.put("workspaceLeaseId", row.get("workspace_lease_id"));
            context.put("workerSlot", row.get("worker_slot"));
            context.put("executionWorkspacePath", row.get("execution_workspace_path"));
        }

        TaskView current = tasks.get(taskId);
        if (!attemptId.equals(current.attemptId())) {
            throw new IllegalStateException("Work Order binding no longer references the current Task Attempt");
        }
        if (current.status() == AttemptStatus.PENDING) {
            try {
                Map<String, Object> additionalContext = new LinkedHashMap<>();
                additionalContext.put("workOrderContext", context);
                if (row.get("retry_of_attempt_id") != null) {
                    additionalContext.put("retryOfAttemptId", row.get("retry_of_attempt_id").toString());
                }
                TaskApplicationService.PreparedTask prepared = tasks.restorePending(
                        taskId, attemptId, current.objective(), additionalContext
                );
                tasks.dispatch(prepared);
            } catch (RuntimeException error) {
                TaskView after = tasks.get(taskId);
                if (after.status() == AttemptStatus.PENDING) throw error;
                projection.observe(taskId, after.attemptId(), after.status());
                return;
            }
        }
        TaskView after = tasks.get(taskId);
        projection.observe(taskId, after.attemptId(), after.status());
    }

    public List<Map<String, Object>> list(UUID projectId, UUID planId, String nodeKey) {
        StringBuilder sql = new StringBuilder("SELECT id FROM work_order WHERE project_id = ?");
        List<Object> args = new ArrayList<>();
        args.add(projectId);
        if (planId != null) { sql.append(" AND plan_id = ?"); args.add(planId); }
        if (nodeKey != null && !nodeKey.isBlank()) { sql.append(" AND node_key = ?"); args.add(nodeKey.trim()); }
        sql.append(" ORDER BY created_at DESC LIMIT 200");
        return jdbc.query(sql.toString(), (row, number) -> get(projectId, row.getObject("id", UUID.class)),
                args.toArray());
    }

    public Map<String, Object> get(UUID projectId, UUID workOrderId) {
        Map<String, Object> row;
        try {
            row = jdbc.queryForMap("""
                    SELECT w.id, w.project_id, w.plan_id, w.plan_version_id, v.version_number, w.node_key,
                           w.schema_version, w.client_request_id, w.profile_id, w.title, w.objective,
                           w.acceptance_criteria::text AS acceptance_criteria,
                           w.required_capabilities::text AS required_capabilities,
                           w.context_version::text AS context_version, w.created_by, w.created_at,
                           w.schedule_dispatch_id, w.schedule_id, w.schedule_assignment_id,
                           w.workspace_lease_id, w.execution_workspace_path,
                           x.status, x.status_reason, x.updated_at, x.dispatch_attempts, x.last_dispatch_at,
                           b.task_id, b.initial_attempt_id, b.bound_at
                    FROM work_order w JOIN work_order_execution x ON x.work_order_id = w.id
                    JOIN plan_version v ON v.id = w.plan_version_id
                    LEFT JOIN work_order_execution_binding b ON b.work_order_id = w.id
                    WHERE w.id = ? AND w.project_id = ?
                    """, workOrderId, projectId);
        } catch (EmptyResultDataAccessException error) {
            throw new ProjectStateConflictException("Work Order was not found.");
        }
        Map<String, Object> value = camelMap(row);
        value.put("workOrderId", value.remove("id"));
        value.put("acceptanceCriteria", read((String) row.get("acceptance_criteria")));
        value.put("requiredCapabilities", read((String) row.get("required_capabilities")));
        value.put("contextVersion", read((String) row.get("context_version")));
        value.put("reports", reports(workOrderId));
        value.put("events", events(workOrderId));
        return value;
    }

    public Map<String, Object> verify(
            UUID projectId, UUID workOrderId, String actor, UUID reportId, String decision, String reason
    ) {
        String normalizedDecision = requireText(decision, "decision").toUpperCase();
        if (!List.of("PASSED", "FAILED").contains(normalizedDecision)) {
            throw new IllegalArgumentException("decision must be PASSED or FAILED");
        }
        VerificationResult result = transactions.execute(tx -> verifyInTransaction(
                projectId, workOrderId, requireText(actor, "actor"), reportId,
                normalizedDecision, requireText(reason, "reason")
        ));
        if (result == null) throw new IllegalStateException("Verification transaction returned no result");
        ContextPackageView context = state.generateContext(projectId, "BRAIN");
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("workOrder", get(projectId, workOrderId));
        response.put("verificationId", result.verificationId());
        response.put("replayed", result.replayed());
        response.put("brainHandoff", Map.of(
                "threadId", result.brainThreadId(),
                "triggerId", result.verificationId(),
                "context", context,
                "question", "Summarize this verified execution and identify the next Plan step."
        ));
        return response;
    }

    public Map<String, Object> recordBrainHandoff(
            UUID projectId,
            UUID workOrderId,
            UUID verificationId,
            UUID threadId,
            String actor,
            BrainCollaborationService.RunRecord command
    ) {
        Integer count = jdbc.queryForObject("""
                SELECT count(*) FROM execution_verification v
                JOIN execution_report r ON r.id = v.report_id
                JOIN work_order w ON w.id = r.work_order_id
                WHERE v.id = ? AND v.brain_thread_id = ? AND w.id = ? AND w.project_id = ?
                """, Integer.class, verificationId, threadId, workOrderId, projectId);
        if (count == null || count != 1) {
            throw new ProjectStateConflictException("Brain handoff does not belong to this Work Order verification.");
        }
        return brain.recordTriggeredRun(projectId, threadId, actor,
                "EXECUTION_VERIFICATION", verificationId, command);
    }

    private VerificationResult verifyInTransaction(
            UUID projectId, UUID workOrderId, String actor, UUID reportId, String decision, String reason
    ) {
        Map<String, Object> report;
        try {
            report = jdbc.queryForMap("""
                    SELECT r.id, r.attempt_status, r.system_evidence::text AS system_evidence,
                           w.plan_id, w.node_key, w.title
                    FROM execution_report r JOIN work_order w ON w.id = r.work_order_id
                    WHERE r.id = ? AND r.work_order_id = ? AND w.project_id = ? FOR UPDATE OF r
                    """, reportId, workOrderId, projectId);
        } catch (EmptyResultDataAccessException error) {
            throw new ProjectStateConflictException("Execution Report was not found.");
        }
        List<Map<String, Object>> existing = jdbc.query("""
                SELECT id, brain_thread_id FROM execution_verification WHERE report_id = ?
                """, (row, number) -> Map.of(
                "id", row.getObject("id", UUID.class),
                "threadId", row.getObject("brain_thread_id", UUID.class)
        ), reportId);
        if (!existing.isEmpty()) {
            return new VerificationResult((UUID) existing.get(0).get("id"),
                    (UUID) existing.get(0).get("threadId"), true);
        }
        if (!"SUCCEEDED".equals(report.get("attempt_status"))) {
            throw new ProjectStateConflictException("Only a succeeded Attempt can pass through Verification.");
        }
        JsonNode systemEvidence = read((String) report.get("system_evidence"));
        if ("PASSED".equals(decision) && systemEvidence.isEmpty()) {
            throw new ProjectStateConflictException(
                    "Verification Gate requires Runtime-observed System Evidence; Agent Claims alone are insufficient.");
        }
        UUID verificationId = UUID.randomUUID();
        UUID stateEntryId = null;
        if ("PASSED".equals(decision)) {
            List<UUID> artifactIds = new ArrayList<>();
            systemEvidence.forEach(item -> artifactIds.add(UUID.fromString(item.path("artifactId").asText())));
            ProjectStateService.VerifiedExecutionFact fact = state.recordVerifiedExecutionFact(
                    projectId, reportId, workOrderId, actor,
                    "Verified execution: " + report.get("title"),
                    "Work Order " + workOrderId + " completed and passed human verification with "
                            + artifactIds.size() + " Runtime-observed evidence item(s).",
                    artifactIds
            );
            stateEntryId = fact.entryId();
        }
        UUID brainThreadId = UUID.randomUUID();
        Instant now = Instant.now();
        jdbc.update("""
                INSERT INTO brain_thread (id, project_id, title, created_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """, brainThreadId, projectId, "Execution follow-up: " + report.get("title"), actor,
                Timestamp.from(now), Timestamp.from(now));
        jdbc.update("""
                INSERT INTO execution_verification (
                    id, report_id, decision, reason, verified_by, system_evidence_count,
                    state_entry_id, brain_thread_id, verified_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, verificationId, reportId, decision, reason, actor, systemEvidence.size(),
                stateEntryId, brainThreadId, Timestamp.from(now));
        UUID planId = (UUID) report.get("plan_id");
        String nodeKey = (String) report.get("node_key");
        jdbc.update("""
                UPDATE work_order_execution SET status = ?, status_reason = ?, updated_at = now()
                WHERE work_order_id = ?
                """, "PASSED".equals(decision) ? "VERIFIED" : "REJECTED", reason, workOrderId);
        jdbc.update("""
                UPDATE plan_execution_state SET state = ?, updated_at = now()
                WHERE plan_id = ? AND node_key = ?
                """, "PASSED".equals(decision) ? "COMPLETED" : "FAILED", planId, nodeKey);
        updateScheduledAssignmentAfterVerification(
                workOrderId, "PASSED".equals(decision) ? "VERIFIED" : "FAILED", actor, verificationId
        );
        if ("PASSED".equals(decision)) markReadyNodes(planId);
        projection.appendEvent(workOrderId, "VERIFICATION_" + decision, actor, Map.of(
                "verificationId", verificationId, "reportId", reportId,
                "systemEvidenceCount", systemEvidence.size(), "reason", reason
        ));
        return new VerificationResult(verificationId, brainThreadId, false);
    }

    private void updateScheduledAssignmentAfterVerification(
            UUID workOrderId,
            String assignmentStatus,
            String actor,
            UUID verificationId
    ) {
        List<Map<String, Object>> scheduled = jdbc.query("""
                SELECT schedule_id, schedule_assignment_id
                FROM work_order
                WHERE id = ? AND schedule_assignment_id IS NOT NULL
                """, (row, number) -> Map.of(
                "scheduleId", row.getObject("schedule_id", UUID.class),
                "assignmentId", row.getObject("schedule_assignment_id", UUID.class)
        ), workOrderId);
        if (scheduled.isEmpty()) return;
        UUID scheduleId = (UUID) scheduled.get(0).get("scheduleId");
        UUID assignmentId = (UUID) scheduled.get(0).get("assignmentId");
        jdbc.update("""
                UPDATE parallel_schedule_assignment SET status = ?, updated_at = now()
                WHERE id = ? AND schedule_id = ? AND status IN ('RUNNING', 'FAILED')
                """, assignmentStatus, assignmentId, scheduleId);
        jdbc.update("""
                INSERT INTO parallel_schedule_event (schedule_id, event_type, actor, payload)
                VALUES (?, 'ASSIGNMENT_VERIFIED', ?, CAST(? AS jsonb))
                """, scheduleId, actor, write(Map.of(
                "assignmentId", assignmentId,
                "workOrderId", workOrderId,
                "verificationId", verificationId,
                "status", assignmentStatus
        )));
    }

    private void markReadyNodes(UUID planId) {
        jdbc.update("""
                UPDATE plan_execution_state s SET state = 'READY', updated_at = now()
                FROM project_plan p
                WHERE p.id = ? AND s.plan_id = p.id AND s.state = 'NOT_READY' AND NOT EXISTS (
                    SELECT 1 FROM plan_node_dependency d
                    LEFT JOIN plan_execution_state dependency_state
                      ON dependency_state.plan_id = s.plan_id
                     AND dependency_state.node_key = d.depends_on_node_key
                    WHERE d.plan_version_id = p.current_version_id AND d.node_key = s.node_key
                      AND COALESCE(dependency_state.state, 'NOT_READY') <> 'COMPLETED'
                )
                """, planId);
    }

    private List<Map<String, Object>> reports(UUID workOrderId) {
        return jdbc.query("""
                SELECT r.id, r.task_id, r.attempt_id, r.schema_version, r.attempt_status,
                       r.agent_claims::text AS agent_claims, r.system_evidence::text AS system_evidence,
                       r.generated_at, v.id AS verification_id, v.decision, v.reason,
                       v.verified_by, v.system_evidence_count, v.state_entry_id,
                       v.brain_thread_id, v.verified_at,
                       br.id AS brain_run_id, br.context_package_id AS brain_context_package_id,
                       bm.content AS brain_summary
                FROM execution_report r
                LEFT JOIN execution_verification v ON v.report_id = r.id
                LEFT JOIN brain_run br ON br.trigger_type = 'EXECUTION_VERIFICATION' AND br.trigger_id = v.id
                LEFT JOIN brain_message bm ON bm.run_id = br.id AND bm.role = 'BRAIN'
                WHERE r.work_order_id = ? ORDER BY r.generated_at DESC
                """, (row, number) -> {
            Map<String, Object> value = camelMap(rowToMap(row, List.of(
                    "id", "task_id", "attempt_id", "schema_version", "attempt_status", "generated_at",
                    "verification_id", "decision", "reason", "verified_by", "system_evidence_count",
                    "state_entry_id", "brain_thread_id", "verified_at", "brain_run_id",
                    "brain_context_package_id", "brain_summary"
            )));
            value.put("reportId", value.remove("id"));
            value.put("agentClaims", read(row.getString("agent_claims")));
            value.put("systemEvidence", read(row.getString("system_evidence")));
            return value;
        }, workOrderId);
    }

    private List<Map<String, Object>> events(UUID workOrderId) {
        return jdbc.query("""
                SELECT id, event_type, actor, payload::text AS payload, occurred_at
                FROM work_order_event WHERE work_order_id = ? ORDER BY id
                """, (row, number) -> {
            Map<String, Object> value = new LinkedHashMap<>();
            value.put("eventId", row.getLong("id"));
            value.put("eventType", row.getString("event_type"));
            value.put("actor", row.getString("actor"));
            value.put("payload", read(row.getString("payload")));
            value.put("occurredAt", row.getTimestamp("occurred_at").toInstant());
            return value;
        }, workOrderId);
    }

    private Map<String, Object> rowToMap(java.sql.ResultSet row, List<String> columns)
            throws java.sql.SQLException {
        Map<String, Object> value = new LinkedHashMap<>();
        for (String column : columns) {
            Object item = row.getObject(column);
            if (item instanceof Timestamp timestamp) item = timestamp.toInstant();
            value.put(column, item);
        }
        return value;
    }

    private Map<String, Object> camelMap(Map<String, Object> source) {
        Map<String, Object> value = new LinkedHashMap<>();
        source.forEach((key, item) -> value.put(camel(key), item instanceof Timestamp timestamp
                ? timestamp.toInstant() : item));
        return value;
    }

    private long currentStateRevision(UUID projectId) {
        Long revision = jdbc.queryForObject("SELECT state_revision FROM project_state_snapshot WHERE project_id = ?",
                Long.class, projectId);
        return revision == null ? 0 : revision;
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

    private void validateCapabilities(Object requiredValue, TaskApplicationService.PreparedTask prepared) {
        JsonNode required = read(String.valueOf(requiredValue));
        List<String> available = prepared.attempt().profileSnapshot().capabilities().stream()
                .map(Enum::name).toList();
        List<String> missing = new ArrayList<>();
        required.forEach(item -> {
            String capability = item.asText();
            if (!available.contains(capability)) missing.add(capability);
        });
        if (!missing.isEmpty()) {
            throw new ProjectStateConflictException(
                    "Selected Profile does not provide required capabilities: " + String.join(", ", missing)
            );
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

    private String write(Object value) {
        try { return json.writeValueAsString(value); }
        catch (JsonProcessingException error) {
            throw new IllegalArgumentException("Work Order JSON serialization failed", error);
        }
    }

    private JsonNode read(String value) {
        try { return json.readTree(value); }
        catch (JsonProcessingException error) {
            throw new IllegalStateException("Stored Work Order JSON is unreadable", error);
        }
    }

    public record ClaimCommand(
            String clientRequestId,
            UUID planId,
            String nodeKey,
            UUID profileId,
            ApprovalMode approvalMode
    ) {
    }

    public record ScheduleDispatchCommand(
            String clientRequestId,
            UUID planId,
            UUID scheduleId,
            ApprovalMode approvalMode
    ) {
    }

    public record ScheduleDispatchView(
            UUID dispatchId,
            UUID scheduleId,
            UUID planId,
            boolean replayed,
            List<Map<String, Object>> workOrders
    ) {
    }

    private record ScheduleAssignment(
            UUID assignmentId,
            String nodeKey,
            int workerSlot,
            UUID profileId,
            String status,
            UUID leaseId,
            String leaseStatus,
            String provisioningState,
            String workspacePath,
            String ownershipToken,
            String physicalWorkspaceKind,
            String executionState
    ) {
    }

    private record ScheduledExecution(
            UUID dispatchId,
            UUID scheduleId,
            UUID assignmentId,
            UUID leaseId,
            String workspacePath,
            int workerSlot
    ) {
    }

    private record ScheduleDispatchClaim(
            UUID dispatchId,
            List<DispatchClaim> workOrders,
            boolean replayed
    ) {
    }

    private record DispatchClaim(
            UUID workOrderId, UUID leaseId, boolean replayed
    ) {
    }

    private record VerificationResult(UUID verificationId, UUID brainThreadId, boolean replayed) {
    }
}
