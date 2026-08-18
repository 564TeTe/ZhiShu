package com.zhishu.workspace;

import java.nio.file.Path;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.zhishu.scheduler.ParallelScheduleService;
import com.zhishu.scheduler.ParallelScheduleView;
import com.zhishu.state.ProjectStateConflictException;

/**
 * Owns the recoverable provisioning state machine for approved schedule leases.
 * Database state is claimed before physical work, and every cleanup requires
 * the persisted opaque ownership token. Physical adapters are selected from the
 * Lease fact; callers cannot substitute an adapter at request time.
 */
@Service
public class WorkspaceProvisionerService {

    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    private final ObjectMapper json;
    private final ParallelScheduleService schedules;
    private final Map<String, WorkspaceProvisioningPort> ports;
    private final WorkspaceProvisionerProperties properties;
    private final Clock clock;

    @Autowired
    public WorkspaceProvisionerService(
            JdbcTemplate jdbc,
            TransactionTemplate transactions,
            ObjectMapper json,
            ParallelScheduleService schedules,
            List<WorkspaceProvisioningPort> ports,
            WorkspaceProvisionerProperties properties
    ) {
        this(jdbc, transactions, json, schedules, ports, properties, Clock.systemUTC());
    }

    WorkspaceProvisionerService(
            JdbcTemplate jdbc,
            TransactionTemplate transactions,
            ObjectMapper json,
            ParallelScheduleService schedules,
            List<WorkspaceProvisioningPort> ports,
            WorkspaceProvisionerProperties properties,
            Clock clock
    ) {
        this.jdbc = jdbc;
        this.transactions = transactions;
        this.json = json;
        this.schedules = schedules;
        this.ports = indexPorts(ports);
        this.properties = properties;
        this.clock = clock;
    }

    public ParallelScheduleView provision(
            UUID projectId,
            UUID scheduleId,
            UUID leaseId,
            String actor,
            String clientRequestId
    ) {
        String normalizedActor = requireText(actor, "actor");
        String normalizedRequestId = requireText(clientRequestId, "clientRequestId");
        ProvisioningClaim claim = transactions.execute(status -> claim(
                projectId, scheduleId, leaseId, normalizedActor, normalizedRequestId
        ));
        if (claim == null) throw new IllegalStateException("Workspace provisioning claim returned no result");
        if (claim.replayed()) return schedules.get(projectId, scheduleId);

        try {
            WorkspaceProvisioningPort port = portFor(claim.physicalWorkspaceKind());
            WorkspaceProvisioningPort.ProvisionedWorkspace provisioned = port.provision(
                    new WorkspaceProvisioningPort.ProvisionRequest(
                            claim.leaseId(), claim.scheduleId(), claim.assignmentId(),
                            claim.workspacePath(), claim.ownershipToken(), claim.repositoryRoot(),
                            claim.baseCommit(), claim.branchRef()
                    )
            );
            transactions.executeWithoutResult(status -> finalizeProvisioning(
                    claim, provisioned.workspacePath(), normalizedActor
            ));
            return schedules.get(projectId, scheduleId);
        } catch (Exception error) {
            compensateFailure(claim, normalizedActor, error);
            throw new ProjectStateConflictException(
                    "Workspace provisioning failed: " + safeMessage(error)
            );
        }
    }

    /** Reconciles interrupted provisioning and expires provisioned leases after their TTL. */
    public WorkspaceProvisioningSweepResult sweep() {
        Instant now = clock.instant();
        int recovered = 0;
        int expired = 0;
        int cleanupPending = 0;
        for (LeaseRecord lease : findProvisioningCandidates(now)) {
            if ("PROVISIONING".equals(lease.provisioningState())) {
                try {
                    WorkspaceProvisioningPort port = portFor(lease.physicalWorkspaceKind());
                    WorkspaceProvisioningPort.ProvisionedWorkspace provisioned = port.provision(
                            new WorkspaceProvisioningPort.ProvisionRequest(
                                    lease.leaseId(), lease.scheduleId(), lease.assignmentId(),
                                    lease.workspacePath(), lease.ownershipToken(), lease.repositoryRoot(),
                                    lease.baseCommit(), lease.branchRef()
                            )
                    );
                    boolean changed = transactions.execute(status -> recoverProvisioning(lease, provisioned.workspacePath()));
                    if (Boolean.TRUE.equals(changed)) recovered += 1;
                } catch (Exception error) {
                    compensateFailure(lease, "system:workspace-provisioner", error);
                    cleanupPending += 1;
                }
            } else if ("PROVISIONED".equals(lease.provisioningState())) {
                try {
                    WorkspaceProvisioningPort port = portFor(lease.physicalWorkspaceKind());
                    appendCleanupStarted(lease);
                    port.cleanup(new WorkspaceProvisioningPort.CleanupRequest(
                            lease.workspacePath(), lease.ownershipToken(), lease.repositoryRoot(), lease.branchRef()
                    ));
                    boolean changed = transactions.execute(status -> expireLease(lease));
                    if (Boolean.TRUE.equals(changed)) expired += 1;
                } catch (Exception error) {
                    transactions.executeWithoutResult(status -> markCleanupPending(
                            lease, "EXPIRE_CLEANUP_FAILED", safeMessage(error), "system:workspace-provisioner"
                    ));
                    cleanupPending += 1;
                }
            } else if ("CLEANUP_PENDING".equals(lease.provisioningState())) {
                try {
                    WorkspaceProvisioningPort port = portFor(lease.physicalWorkspaceKind());
                    appendCleanupStarted(lease);
                    port.cleanup(new WorkspaceProvisioningPort.CleanupRequest(
                            lease.workspacePath(), lease.ownershipToken(), lease.repositoryRoot(), lease.branchRef()
                    ));
                    boolean changed = transactions.execute(status -> markCleaned(lease));
                    if (Boolean.TRUE.equals(changed)) expired += 1;
                } catch (Exception error) {
                    transactions.executeWithoutResult(status -> markCleanupPending(
                            lease, "CLEANUP_RETRY_FAILED", safeMessage(error), "system:workspace-provisioner"
                    ));
                    cleanupPending += 1;
                }
            }
        }
        return new WorkspaceProvisioningSweepResult(recovered, expired, cleanupPending);
    }

    private ProvisioningClaim claim(
            UUID projectId,
            UUID scheduleId,
            UUID leaseId,
            String actor,
            String requestId
    ) {
        Map<String, Object> row;
        try {
            row = jdbc.queryForMap("""
                    SELECT l.id, l.schedule_id, l.assignment_id, l.status, l.provisioning_state,
                           l.provisioning_request_id, l.workspace_path, l.ownership_token,
                           l.physical_workspace_kind, l.repository_root, l.base_commit, l.branch_ref,
                           a.plan_id, a.worker_slot, a.status AS assignment_status,
                           p.status AS schedule_status
                    FROM workspace_lease l
                    JOIN parallel_schedule_assignment a ON a.id = l.assignment_id
                    JOIN parallel_schedule_proposal p ON p.id = l.schedule_id
                    WHERE l.id = ? AND l.project_id = ? AND l.schedule_id = ?
                    FOR UPDATE OF l
                    """, leaseId, projectId, scheduleId);
        } catch (EmptyResultDataAccessException error) {
            throw new ProjectStateConflictException("Workspace Lease was not found for this Schedule.");
        }
        String state = String.valueOf(row.get("provisioning_state"));
        String existingRequest = nullable(row.get("provisioning_request_id"));
        if ("PROVISIONED".equals(state) && requestId.equals(existingRequest)) {
            return ProvisioningClaim.replayed(
                    (UUID) row.get("id"), (UUID) row.get("schedule_id"), (UUID) row.get("assignment_id")
            );
        }
        if (!"APPROVED".equals(row.get("schedule_status"))) {
            throw new ProjectStateConflictException("Only an approved Parallel Schedule can be provisioned.");
        }
        if (!"READY_FOR_PROVISIONING".equals(row.get("assignment_status"))) {
            throw new ProjectStateConflictException("Assignment is not READY_FOR_PROVISIONING.");
        }
        if (!"RESERVED".equals(row.get("status"))) {
            throw new ProjectStateConflictException("Workspace Lease is no longer reserved.");
        }
        if ("PROVISIONING".equals(state)) {
            throw new ProjectStateConflictException("Workspace Lease provisioning is already in progress.");
        }
        if (!List.of("NOT_STARTED", "CLEANED").contains(state)) {
            throw new ProjectStateConflictException("Workspace Lease cannot be provisioned from state " + state + ".");
        }
        UUID ownershipToken = UUID.randomUUID();
        Path path = properties.root()
                .resolve("project-" + projectId)
                .resolve("schedule-" + scheduleId)
                .resolve("worker-" + row.get("worker_slot"));
        Instant now = clock.instant();
        jdbc.update("""
                UPDATE workspace_lease
                SET provisioning_state = 'PROVISIONING', provisioning_request_id = ?,
                    workspace_path = ?, ownership_token = ?, lease_expires_at = ?,
                    provisioning_started_at = ?, provisioned_at = NULL,
                    failed_at = NULL, failure_code = NULL, failure_message = NULL,
                    cleanup_started_at = NULL, cleaned_at = NULL, last_reconciled_at = ? ,
                    updated_at = now()
                WHERE id = ? AND provisioning_state IN ('NOT_STARTED', 'CLEANED')
                """, requestId, path.toString(), ownershipToken.toString(),
                Timestamp.from(now.plus(properties.leaseDuration())), Timestamp.from(now), Timestamp.from(now), leaseId);
        appendEvent(leaseId, "PROVISIONING_STARTED", actor, json.createObjectNode()
                .put("clientRequestId", requestId).put("workspacePath", path.toString())
                .put("physicalWorkspaceKind", String.valueOf(row.get("physical_workspace_kind"))));
        if ("GIT_WORKTREE".equals(row.get("physical_workspace_kind"))) {
            appendEvent(leaseId, "WORKTREE_VALIDATION_STARTED", actor, json.createObjectNode()
                    .put("workspacePath", path.toString())
                    .put("baseCommit", String.valueOf(row.get("base_commit")))
                    .put("branchRef", String.valueOf(row.get("branch_ref"))));
        }
        return new ProvisioningClaim(
                leaseId, (UUID) row.get("schedule_id"), (UUID) row.get("assignment_id"),
                path, ownershipToken.toString(), String.valueOf(row.get("physical_workspace_kind")),
                nullablePath(row.get("repository_root")), nullable(row.get("base_commit")),
                nullable(row.get("branch_ref")), false
        );
    }

    private void finalizeProvisioning(ProvisioningClaim claim, Path path, String actor) {
        int updated = jdbc.update("""
                UPDATE workspace_lease
                SET status = 'PROVISIONED', provisioning_state = 'PROVISIONED',
                    workspace_path = ?, provisioned_at = now(), last_reconciled_at = now(), updated_at = now()
                WHERE id = ? AND ownership_token = ? AND provisioning_state = 'PROVISIONING'
                """, path.toString(), claim.leaseId(), claim.ownershipToken());
        if (updated != 1) throw new ProjectStateConflictException("Workspace Lease changed during provisioning.");
        int assignmentUpdated = jdbc.update("""
                UPDATE parallel_schedule_assignment
                SET status = 'PROVISIONED', updated_at = now()
                WHERE id = ? AND status = 'READY_FOR_PROVISIONING'
                """, claim.assignmentId());
        if (assignmentUpdated != 1) {
            throw new ProjectStateConflictException("Assignment changed during workspace provisioning.");
        }
        appendEvent(claim.leaseId(), "PROVISIONED", actor, json.createObjectNode()
                .put("workspacePath", path.toString())
                .put("physicalWorkspaceKind", claim.physicalWorkspaceKind()));
        if ("GIT_WORKTREE".equals(claim.physicalWorkspaceKind())) {
            appendEvent(claim.leaseId(), "WORKTREE_CREATED", actor, json.createObjectNode()
                    .put("workspacePath", path.toString())
                    .put("baseCommit", claim.baseCommit())
                    .put("branchRef", claim.branchRef()));
        }
    }

    private void compensateFailure(LeaseRecord lease, String actor, Exception error) {
        compensateFailure(new ProvisioningClaim(
                lease.leaseId(), lease.scheduleId(), lease.assignmentId(),
                lease.workspacePath(), lease.ownershipToken(), lease.physicalWorkspaceKind(),
                lease.repositoryRoot(), lease.baseCommit(), lease.branchRef(), false
        ), actor, error);
    }

    private void compensateFailure(ProvisioningClaim claim, String actor, Exception error) {
        transactions.executeWithoutResult(status -> markFailure(claim, actor, error));
        try {
            WorkspaceProvisioningPort port = portFor(claim.physicalWorkspaceKind());
            port.cleanup(new WorkspaceProvisioningPort.CleanupRequest(
                    claim.workspacePath(), claim.ownershipToken(), claim.repositoryRoot(), claim.branchRef()
            ));
            transactions.executeWithoutResult(status -> markCleanedAfterFailure(claim, actor));
        } catch (Exception cleanupError) {
            transactions.executeWithoutResult(status -> markCleanupPending(
                    claim, "PROVISIONING_CLEANUP_FAILED", safeMessage(cleanupError), actor
            ));
        }
    }

    private void markFailure(ProvisioningClaim claim, String actor, Exception error) {
        int updated = jdbc.update("""
                UPDATE workspace_lease
                SET provisioning_state = 'FAILED', failed_at = now(),
                    failure_code = 'PROVISIONING_FAILED', failure_message = ?,
                    last_reconciled_at = now(), updated_at = now()
                WHERE id = ? AND ownership_token = ? AND provisioning_state = 'PROVISIONING'
                """, safeMessage(error), claim.leaseId(), claim.ownershipToken());
        if (updated == 1) appendEvent(claim.leaseId(), "PROVISIONING_FAILED", actor,
                json.createObjectNode().put("message", safeMessage(error)));
        if (updated == 1 && "GIT_WORKTREE".equals(claim.physicalWorkspaceKind())) {
            appendEvent(claim.leaseId(), "WORKTREE_CREATE_FAILED", actor, json.createObjectNode()
                    .put("message", safeMessage(error))
                    .put("baseCommit", claim.baseCommit())
                    .put("branchRef", claim.branchRef()));
        }
    }

    private void markCleanedAfterFailure(ProvisioningClaim claim, String actor) {
        int updated = jdbc.update("""
                UPDATE workspace_lease
                SET provisioning_state = 'CLEANED', workspace_path = NULL, ownership_token = NULL,
                    cleanup_started_at = NULL, cleaned_at = now(), last_reconciled_at = now(), updated_at = now()
                WHERE id = ? AND ownership_token = ? AND provisioning_state = 'FAILED'
                """, claim.leaseId(), claim.ownershipToken());
        if (updated == 1) appendEvent(claim.leaseId(), "CLEANED_AFTER_FAILURE", actor, json.createObjectNode());
    }

    private Boolean recoverProvisioning(LeaseRecord lease, Path path) {
        int updated = jdbc.update("""
                UPDATE workspace_lease
                SET status = 'PROVISIONED', provisioning_state = 'PROVISIONED',
                    workspace_path = ?, provisioned_at = COALESCE(provisioned_at, now()),
                    last_reconciled_at = now(), updated_at = now()
                WHERE id = ? AND ownership_token = ? AND provisioning_state = 'PROVISIONING'
                """, path.toString(), lease.leaseId(), lease.ownershipToken());
        if (updated != 1) return false;
        int assignmentUpdated = jdbc.update("""
                UPDATE parallel_schedule_assignment SET status = 'PROVISIONED', updated_at = now()
                WHERE id = ? AND status = 'READY_FOR_PROVISIONING'
                """, lease.assignmentId());
        if (assignmentUpdated != 1) {
            throw new ProjectStateConflictException("Assignment changed during workspace recovery.");
        }
        appendEvent(lease.leaseId(), "PROVISIONING_RECOVERED", "system:workspace-provisioner", json.createObjectNode());
        if ("GIT_WORKTREE".equals(lease.physicalWorkspaceKind())) {
            appendEvent(lease.leaseId(), "WORKTREE_RECOVERED", "system:workspace-provisioner",
                    json.createObjectNode().put("branchRef", lease.branchRef()));
        }
        return true;
    }

    private Boolean expireLease(LeaseRecord lease) {
        int updated = jdbc.update("""
                UPDATE workspace_lease
                SET status = 'EXPIRED', provisioning_state = 'CLEANED', workspace_path = NULL,
                    ownership_token = NULL, cleaned_at = now(), last_reconciled_at = now(), updated_at = now()
                WHERE id = ? AND ownership_token = ? AND provisioning_state = 'PROVISIONED'
                """, lease.leaseId(), lease.ownershipToken());
        if (updated != 1) return false;
        jdbc.update("""
                UPDATE parallel_schedule_assignment SET status = 'CANCELLED', updated_at = now()
                WHERE id = ? AND status IN ('PROVISIONED', 'READY_FOR_PROVISIONING')
                """, lease.assignmentId());
        appendEvent(lease.leaseId(), "EXPIRED", "system:workspace-provisioner", json.createObjectNode());
        if ("GIT_WORKTREE".equals(lease.physicalWorkspaceKind())) {
            appendEvent(lease.leaseId(), "WORKTREE_CLEANED", "system:workspace-provisioner",
                    json.createObjectNode().put("branchRef", lease.branchRef()));
        }
        return true;
    }

    private void markCleanupPending(LeaseRecord lease, String code, String message, String actor) {
        markCleanupPending(new ProvisioningClaim(
                lease.leaseId(), lease.scheduleId(), lease.assignmentId(),
                lease.workspacePath(), lease.ownershipToken(), lease.physicalWorkspaceKind(),
                lease.repositoryRoot(), lease.baseCommit(), lease.branchRef(), false
        ), code, message, actor);
    }

    private void markCleanupPending(ProvisioningClaim claim, String code, String message, String actor) {
        int updated = jdbc.update("""
                UPDATE workspace_lease
                SET provisioning_state = 'CLEANUP_PENDING', cleanup_started_at = COALESCE(cleanup_started_at, now()),
                    failure_code = ?, failure_message = ?, last_reconciled_at = now(), updated_at = now()
                WHERE id = ? AND ownership_token = ?
                  AND provisioning_state IN ('PROVISIONED', 'FAILED', 'CLEANUP_PENDING')
                """, code, message, claim.leaseId(), claim.ownershipToken());
        if (updated == 1) appendEvent(claim.leaseId(), "CLEANUP_PENDING", actor,
                json.createObjectNode().put("code", code).put("message", message));
        if (updated == 1 && "GIT_WORKTREE".equals(claim.physicalWorkspaceKind())) {
            appendEvent(claim.leaseId(), "WORKTREE_CLEANUP_FAILED", actor,
                    json.createObjectNode().put("code", code).put("message", message));
        }
    }

    private Boolean markCleaned(LeaseRecord lease) {
        int updated = jdbc.update("""
                UPDATE workspace_lease
                SET status = 'EXPIRED', provisioning_state = 'CLEANED', workspace_path = NULL,
                    ownership_token = NULL, cleaned_at = now(), last_reconciled_at = now(), updated_at = now()
                WHERE id = ? AND ownership_token = ? AND provisioning_state = 'CLEANUP_PENDING'
                """, lease.leaseId(), lease.ownershipToken());
        if (updated != 1) return false;
        jdbc.update("""
                UPDATE parallel_schedule_assignment SET status = 'CANCELLED', updated_at = now()
                WHERE id = ? AND status IN ('PROVISIONED', 'READY_FOR_PROVISIONING')
                """, lease.assignmentId());
        appendEvent(lease.leaseId(), "CLEANED", "system:workspace-provisioner", json.createObjectNode());
        if ("GIT_WORKTREE".equals(lease.physicalWorkspaceKind())) {
            appendEvent(lease.leaseId(), "WORKTREE_CLEANED", "system:workspace-provisioner",
                    json.createObjectNode().put("branchRef", lease.branchRef()));
        }
        return true;
    }

    private List<LeaseRecord> findProvisioningCandidates(Instant now) {
        return jdbc.query("""
                SELECT lease.id, lease.schedule_id, lease.assignment_id, lease.provisioning_state,
                       lease.workspace_path, lease.ownership_token, lease.physical_workspace_kind,
                       lease.repository_root, lease.base_commit, lease.branch_ref
                FROM workspace_lease lease
                JOIN parallel_schedule_assignment assignment ON assignment.id = lease.assignment_id
                WHERE (lease.provisioning_state = 'PROVISIONING'
                       AND provisioning_started_at <= ?)
                   OR (lease.provisioning_state = 'PROVISIONED'
                       AND lease_expires_at <= ?
                       AND (
                           lease.physical_workspace_kind = 'DIRECTORY_ONLY'
                           OR (
                               assignment.status IN ('VERIFIED', 'FAILED', 'CANCELLED')
                               AND EXISTS (
                                   SELECT 1
                                   FROM integration_gate_proposal gate
                                   JOIN integration_execution_run run ON run.gate_id = gate.id
                                   WHERE gate.schedule_id = lease.schedule_id AND run.status = 'SUCCEEDED'
                               )
                           )
                       ))
                   OR lease.provisioning_state = 'CLEANUP_PENDING'
                ORDER BY lease.id
                """, (row, number) -> new LeaseRecord(
                row.getObject("id", UUID.class), row.getObject("schedule_id", UUID.class),
                row.getObject("assignment_id", UUID.class), row.getString("provisioning_state"),
                Path.of(row.getString("workspace_path")), row.getString("ownership_token"),
                row.getString("physical_workspace_kind"), nullablePath(row.getString("repository_root")),
                row.getString("base_commit"), row.getString("branch_ref")
        ), Timestamp.from(now.minus(properties.operationTimeout())), Timestamp.from(now));
    }

    private void appendCleanupStarted(LeaseRecord lease) {
        if (!"GIT_WORKTREE".equals(lease.physicalWorkspaceKind())) return;
        transactions.executeWithoutResult(status -> appendEvent(
                lease.leaseId(), "WORKTREE_CLEANUP_STARTED", "system:workspace-provisioner",
                json.createObjectNode().put("branchRef", lease.branchRef())
        ));
    }

    private WorkspaceProvisioningPort portFor(String physicalWorkspaceKind) {
        WorkspaceProvisioningPort port = ports.get(physicalWorkspaceKind);
        if (port == null) {
            throw new ProjectStateConflictException(
                    "No Workspace adapter is registered for " + physicalWorkspaceKind + "."
            );
        }
        return port;
    }

    private Map<String, WorkspaceProvisioningPort> indexPorts(List<WorkspaceProvisioningPort> values) {
        Map<String, WorkspaceProvisioningPort> result = new LinkedHashMap<>();
        for (WorkspaceProvisioningPort value : values) {
            WorkspaceProvisioningPort previous = result.put(value.physicalWorkspaceKind(), value);
            if (previous != null) {
                throw new IllegalArgumentException(
                        "Duplicate Workspace adapter for " + value.physicalWorkspaceKind()
                );
            }
        }
        return Map.copyOf(result);
    }

    private void appendEvent(UUID leaseId, String eventType, String actor, ObjectNode payload) {
        jdbc.update("""
                INSERT INTO workspace_lease_event (lease_id, event_type, actor, payload)
                VALUES (?, ?, ?, CAST(? AS jsonb))
                """, leaseId, eventType, actor, write(payload));
    }

    private String write(Object value) {
        try {
            return json.writeValueAsString(value);
        } catch (JsonProcessingException error) {
            throw new IllegalStateException("Workspace Lease event serialization failed", error);
        }
    }

    private String requireText(String value, String field) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(field + " is required");
        return value.trim();
    }

    private String nullable(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private Path nullablePath(Object value) {
        String text = nullable(value);
        return text == null || text.isBlank() ? null : Path.of(text);
    }

    private String safeMessage(Exception error) {
        String message = error.getMessage();
        return message == null || message.isBlank() ? error.getClass().getSimpleName() : message;
    }

    public record WorkspaceProvisioningSweepResult(int recovered, int expired, int cleanupPending) {
    }

    private record ProvisioningClaim(
            UUID leaseId,
            UUID scheduleId,
            UUID assignmentId,
            Path workspacePath,
            String ownershipToken,
            String physicalWorkspaceKind,
            Path repositoryRoot,
            String baseCommit,
            String branchRef,
            boolean replayed
    ) {
        private static ProvisioningClaim replayed(UUID leaseId, UUID scheduleId, UUID assignmentId) {
            return new ProvisioningClaim(
                    leaseId, scheduleId, assignmentId, null, null, null, null, null, null, true
            );
        }
    }

    private record LeaseRecord(
            UUID leaseId,
            UUID scheduleId,
            UUID assignmentId,
            String provisioningState,
            Path workspacePath,
            String ownershipToken,
            String physicalWorkspaceKind,
            Path repositoryRoot,
            String baseCommit,
            String branchRef
    ) {
    }
}
