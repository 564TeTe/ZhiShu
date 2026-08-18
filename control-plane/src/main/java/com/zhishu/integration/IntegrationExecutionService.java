package com.zhishu.integration;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
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

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.core.task.TaskExecutor;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.zhishu.plan.AutomaticReplanService;
import com.zhishu.state.ProjectStateConflictException;
import com.zhishu.workspace.GitCommandRunner;
import com.zhishu.workspace.WorkspaceProvisionerProperties;

/** Applies two verified Worker results and runs fixed build/test gates in an isolated Worktree. */
@Service
public class IntegrationExecutionService {

    private static final Path WORKSPACE_LEASE_MARKER = Path.of(".zhishu-workspace-lease.json");

    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    private final ObjectMapper json;
    private final IntegrationExecutionProperties properties;
    private final WorkspaceProvisionerProperties workspaceProperties;
    private final GitCommandRunner git;
    private final IntegrationCommandRunner commands;
    private final IntegrationPolicyResolver policies;
    private final GitIntegrationWorkspacePort integrationWorkspaces;
    private final AutomaticReplanService replans;
    private final TaskExecutor taskExecutor;

    public IntegrationExecutionService(
            JdbcTemplate jdbc,
            TransactionTemplate transactions,
            ObjectMapper json,
            IntegrationExecutionProperties properties,
            WorkspaceProvisionerProperties workspaceProperties,
            GitCommandRunner git,
            IntegrationCommandRunner commands,
            IntegrationPolicyResolver policies,
            GitIntegrationWorkspacePort integrationWorkspaces,
            AutomaticReplanService replans,
            @Qualifier("zhishuIntegrationTaskExecutor") TaskExecutor taskExecutor
    ) {
        this.jdbc = jdbc;
        this.transactions = transactions;
        this.json = json;
        this.properties = properties;
        this.workspaceProperties = workspaceProperties;
        this.git = git;
        this.commands = commands;
        this.policies = policies;
        this.integrationWorkspaces = integrationWorkspaces;
        this.replans = replans;
        this.taskExecutor = taskExecutor;
    }

    public IntegrationExecutionView execute(
            UUID projectId,
            UUID planId,
            UUID gateId,
            String actor,
            String clientRequestId
    ) {
        if (!properties.enabled()) {
            throw new ProjectStateConflictException("Integration execution is disabled by server policy.");
        }
        try {
            commands.verifySandboxCapability();
        } catch (IOException error) {
            throw new ProjectStateConflictException(error.getMessage());
        }
        String normalizedActor = requireText(actor, "actor");
        String requestId = requireText(clientRequestId, "clientRequestId");
        String requestHash = sha256(projectId + "|" + planId + "|" + gateId + "|EXECUTE");
        ExecutionClaim claim;
        try {
            claim = transactions.execute(status -> claim(
                    projectId, planId, gateId, normalizedActor, requestId, requestHash
            ));
        } catch (DataIntegrityViolationException error) {
            throw new ProjectStateConflictException("An Integration execution is already active for this Gate.");
        }
        if (claim == null) throw new IllegalStateException("Integration execution claim returned no result");
        if (claim.replayed()) return get(projectId, planId, gateId, claim.runId(), true);
        try {
            taskExecutor.execute(() -> runClaim(claim, projectId, planId, gateId, normalizedActor));
        } catch (RuntimeException error) {
            // The claim transaction has already projected PREPARING. Compensate
            // immediately so a saturated executor cannot leave a phantom run.
            IOException dispatchFailure = new IOException(
                    "Integration execution worker was unavailable.", error
            );
            fail(claim, normalizedActor, dispatchFailure);
            proposeAutomaticReplan(
                    projectId, planId, gateId, claim.runId(), safeMessage(dispatchFailure)
            );
        }
        return get(projectId, planId, gateId, claim.runId(), false);
    }

    private void runClaim(
            ExecutionClaim claim,
            UUID projectId,
            UUID planId,
            UUID gateId,
            String actor
    ) {
        try {
            Path workspace = integrationWorkspaces.create(new GitIntegrationWorkspacePort.CreateRequest(
                    claim.runId(), gateId, claim.repositoryRoot(), claim.baseCommit(),
                    claim.integrationWorkspace(), claim.integrationBranch(), claim.ownershipToken()
            ));
            transition(claim.runId(), gateId, "PREPARING", "APPLYING", "APPLYING");
            int ordinal = 0;
            for (WorkerWorkspace worker : claim.workers()) {
                applyWorker(claim, workspace, worker, ordinal++);
            }
            createCandidateCommit(claim, workspace, ordinal++);
            transition(claim.runId(), gateId, "APPLYING", "BUILDING", "BUILDING");
            IntegrationCommandRunner.Result build = runCommandStep(
                    claim.runId(), ordinal++, "BUILD", null, claim.policy().buildSummary(),
                    () -> commands.build(workspace, claim.policy())
            );
            jdbc.update("UPDATE integration_execution_run SET build_exit_code = ? WHERE id = ?",
                    build.exitCode(), claim.runId());
            if (build.exitCode() != 0) {
                throw new IntegrationStepException("BUILD_FAILED", "Configured build command failed.");
            }
            transition(claim.runId(), gateId, "BUILDING", "TESTING", "TESTING");
            IntegrationCommandRunner.Result test = runCommandStep(
                    claim.runId(), ordinal, "TEST", null, claim.policy().testSummary(),
                    () -> commands.test(workspace, claim.policy())
            );
            jdbc.update("UPDATE integration_execution_run SET test_exit_code = ? WHERE id = ?",
                    test.exitCode(), claim.runId());
            if (test.exitCode() != 0) {
                throw new IntegrationStepException("TEST_FAILED", "Configured test command failed.");
            }
            transactions.executeWithoutResult(status -> {
                jdbc.update("""
                        UPDATE integration_execution_run
                        SET status = 'SUCCEEDED', completed_at = now()
                        WHERE id = ? AND status = 'TESTING'
                        """, claim.runId());
                jdbc.update("""
                        UPDATE integration_gate_proposal SET apply_state = 'SUCCEEDED'
                        WHERE id = ? AND status = 'APPROVED' AND apply_state = 'TESTING'
                        """, gateId);
                appendEvent(gateId, "INTEGRATION_EXECUTION_SUCCEEDED", actor,
                        json.createObjectNode().put("runId", claim.runId().toString())
                                .put("workspacePath", workspace.toString())
                                .put("branchRef", claim.integrationBranch()));
            });
        } catch (Exception error) {
            fail(claim, actor, error);
            proposeAutomaticReplan(projectId, planId, gateId, claim.runId(), safeMessage(error));
        }
    }

    public IntegrationExecutionView finalizeCandidate(
            UUID projectId,
            UUID planId,
            UUID gateId,
            UUID runId,
            String actor,
            String clientRequestId,
            String expectedCandidateCommit
    ) {
        String normalizedActor = requireText(actor, "actor");
        String requestId = requireText(clientRequestId, "clientRequestId");
        String candidateCommit = requireCommit(expectedCandidateCommit, "candidateCommit");
        String requestHash = sha256(projectId + "|" + planId + "|" + gateId + "|" + runId
                + "|FAST_FORWARD_PRIMARY_AND_CLEANUP|" + candidateCommit);
        FinalizationClaim claim;
        try {
            claim = transactions.execute(status -> claimFinalization(
                    projectId, planId, gateId, runId, normalizedActor,
                    requestId, requestHash, candidateCommit
            ));
        } catch (DataIntegrityViolationException error) {
            throw new ProjectStateConflictException(
                    "Integration finalization request conflicts with an existing idempotency record."
            );
        }
        if (claim == null) throw new IllegalStateException("Integration finalization claim returned no result");
        if ("CLEANED".equals(claim.finalizationState())) {
            return get(projectId, planId, gateId, runId, true);
        }

        boolean applied = List.of("APPLIED", "CLEANUP_PENDING").contains(claim.finalizationState());
        String targetRef = claim.finalizedTargetRef();
        try {
            if (!applied) {
                GitIntegrationWorkspacePort.FinalizationResult result = integrationWorkspaces.fastForwardPrimary(
                        new GitIntegrationWorkspacePort.FinalizeRequest(
                                runId, claim.repositoryRoot(), claim.baseCommit(), claim.candidateCommit(),
                                claim.integrationWorkspace(), claim.integrationBranch(), claim.ownershipToken()
                        )
                );
                applied = true;
                targetRef = result.targetRef();
                markFinalizationApplied(runId, gateId, normalizedActor, targetRef, result.replayed());
            }
            markCleanupPending(runId);
            integrationWorkspaces.cleanup(new GitIntegrationWorkspacePort.CleanupRequest(
                    runId, claim.repositoryRoot(), claim.integrationWorkspace(),
                    claim.integrationBranch(), claim.ownershipToken()
            ));
            markFinalizationCleaned(runId, gateId, normalizedActor);
        } catch (Exception error) {
            markFinalizationFailure(runId, gateId, normalizedActor, applied, targetRef, safeMessage(error));
        }
        return get(projectId, planId, gateId, runId, false);
    }

    public IntegrationExecutionView get(
            UUID projectId,
            UUID planId,
            UUID gateId,
            UUID runId,
            boolean replayed
    ) {
        Map<String, Object> row;
        try {
            row = jdbc.queryForMap("""
                    SELECT id, project_id, plan_id, gate_id, attempt_number, status,
                           repository_root, base_commit, candidate_commit, integration_workspace_path,
                           integration_branch_ref, workspace_state, failure_code, failure_message,
                           build_exit_code, test_exit_code, replan_proposal_id,
                           finalization_state, finalized_target_ref, finalized_at,
                           finalization_failure_message, policy_preset,
                           build_command_summary, test_command_summary, created_by,
                           created_at, started_at, completed_at
                    FROM integration_execution_run
                    WHERE id = ? AND project_id = ? AND plan_id = ? AND gate_id = ?
                    """, runId, projectId, planId, gateId);
        } catch (EmptyResultDataAccessException error) {
            throw new ProjectStateConflictException("Integration execution Run was not found.");
        }
        List<IntegrationExecutionView.StepView> steps = jdbc.query("""
                SELECT id, ordinal, step_type, assignment_id, status, command_summary,
                       exit_code, stdout_summary, stderr_summary, started_at, completed_at
                FROM integration_execution_step WHERE run_id = ? ORDER BY ordinal
                """, (result, number) -> new IntegrationExecutionView.StepView(
                result.getObject("id", UUID.class), result.getInt("ordinal"), result.getString("step_type"),
                result.getObject("assignment_id", UUID.class), result.getString("status"),
                result.getString("command_summary"), nullableInteger(result.getObject("exit_code")),
                result.getString("stdout_summary"), result.getString("stderr_summary"),
                result.getTimestamp("started_at").toInstant(), instant(result.getTimestamp("completed_at"))
        ), runId);
        return new IntegrationExecutionView(
                (UUID) row.get("id"), (UUID) row.get("project_id"), (UUID) row.get("plan_id"),
                (UUID) row.get("gate_id"), ((Number) row.get("attempt_number")).intValue(),
                String.valueOf(row.get("status")), String.valueOf(row.get("repository_root")),
                String.valueOf(row.get("base_commit")), nullable(row.get("candidate_commit")),
                String.valueOf(row.get("integration_workspace_path")),
                String.valueOf(row.get("integration_branch_ref")), String.valueOf(row.get("workspace_state")),
                nullable(row.get("failure_code")), nullable(row.get("failure_message")),
                nullableInteger(row.get("build_exit_code")), nullableInteger(row.get("test_exit_code")),
                (UUID) row.get("replan_proposal_id"), String.valueOf(row.get("finalization_state")),
                nullable(row.get("finalized_target_ref")), instant(row.get("finalized_at")),
                nullable(row.get("finalization_failure_message")), nullable(row.get("policy_preset")),
                nullable(row.get("build_command_summary")), nullable(row.get("test_command_summary")),
                String.valueOf(row.get("created_by")),
                ((Timestamp) row.get("created_at")).toInstant(), instant(row.get("started_at")),
                instant(row.get("completed_at")), replayed, List.copyOf(steps)
        );
    }

    public List<IntegrationExecutionView> list(UUID projectId, UUID planId, UUID gateId) {
        return jdbc.query("""
                SELECT id FROM integration_execution_run
                WHERE project_id = ? AND plan_id = ? AND gate_id = ?
                ORDER BY attempt_number DESC
                """, (row, number) -> get(
                projectId, planId, gateId, row.getObject("id", UUID.class), false
        ), projectId, planId, gateId);
    }

    /** Marks command runs interrupted by a process restart as failed and leaves their Worktree for review. */
    public int recoverInterruptedRuns() {
        Instant cutoff = Instant.now().minus(properties.commandTimeout()).minusSeconds(30);
        List<InterruptedRun> runs = jdbc.query("""
                SELECT id, project_id, plan_id, gate_id FROM integration_execution_run
                WHERE status IN ('PREPARING', 'APPLYING', 'BUILDING', 'TESTING')
                  AND started_at <= ? ORDER BY started_at
                """, (row, number) -> new InterruptedRun(
                row.getObject("id", UUID.class), row.getObject("project_id", UUID.class),
                row.getObject("plan_id", UUID.class), row.getObject("gate_id", UUID.class)
        ), Timestamp.from(cutoff));
        int recovered = 0;
        for (InterruptedRun run : runs) {
            Boolean changed = transactions.execute(status -> {
                jdbc.update("""
                        UPDATE integration_execution_step
                        SET status = 'FAILED', stderr_summary = 'Control Plane restart interrupted the step',
                            completed_at = now()
                        WHERE run_id = ? AND status = 'RUNNING'
                        """, run.runId());
                int updated = jdbc.update("""
                        UPDATE integration_execution_run
                        SET status = 'FAILED', failure_code = 'PROCESS_RESTART',
                            failure_message = 'Control Plane restart interrupted Integration execution',
                            completed_at = now()
                        WHERE id = ? AND status IN ('PREPARING', 'APPLYING', 'BUILDING', 'TESTING')
                        """, run.runId());
                if (updated != 1) return false;
                jdbc.update("""
                        UPDATE integration_gate_proposal SET apply_state = 'FAILED'
                        WHERE id = ? AND status = 'APPROVED'
                          AND apply_state IN ('PREPARING', 'APPLYING', 'BUILDING', 'TESTING')
                        """, run.gateId());
                appendEvent(run.gateId(), "INTEGRATION_EXECUTION_RECOVERED_AS_FAILED",
                        "system:integration-recovery",
                        json.createObjectNode().put("runId", run.runId().toString()));
                return true;
            });
            if (!Boolean.TRUE.equals(changed)) continue;
            recovered += 1;
            proposeAutomaticReplan(
                    run.projectId(), run.planId(), run.gateId(), run.runId(),
                    "Control Plane restart interrupted Integration execution"
            );
        }
        return recovered;
    }

    private ExecutionClaim claim(
            UUID projectId,
            UUID planId,
            UUID gateId,
            String actor,
            String requestId,
            String requestHash
    ) {
        jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))",
                Object.class, projectId + "|integration-execution|" + requestId);
        List<Map<String, Object>> replay = jdbc.queryForList("""
                SELECT id, gate_id, request_hash FROM integration_execution_run
                WHERE project_id = ? AND created_by = ? AND client_request_id = ?
                """, projectId, actor, requestId);
        if (!replay.isEmpty()) {
            Map<String, Object> existing = replay.get(0);
            if (!gateId.equals(existing.get("gate_id")) || !requestHash.equals(existing.get("request_hash"))) {
                throw new ProjectStateConflictException(
                        "clientRequestId was reused for a different Integration execution."
                );
            }
            return replayClaim((UUID) existing.get("id"));
        }
        Map<String, Object> gate;
        try {
            gate = jdbc.queryForMap("""
                    SELECT gate.id, gate.schedule_id, gate.status, gate.apply_state,
                           gate.base_state_revision, gate.base_plan_version,
                           plan.current_version_id, version.version_number, state.state_revision
                    FROM integration_gate_proposal gate
                    JOIN project_plan plan ON plan.id = gate.plan_id
                    JOIN plan_version version ON version.id = plan.current_version_id
                    JOIN project_state_snapshot state ON state.project_id = gate.project_id
                    WHERE gate.id = ? AND gate.project_id = ? AND gate.plan_id = ?
                    FOR UPDATE OF gate
                    """, gateId, projectId, planId);
        } catch (EmptyResultDataAccessException error) {
            throw new ProjectStateConflictException("Approved Integration Gate was not found.");
        }
        if (!"APPROVED".equals(gate.get("status"))) {
            throw new ProjectStateConflictException("Integration execution requires an approved Gate.");
        }
        if (!List.of("NOT_ATTEMPTED", "FAILED").contains(String.valueOf(gate.get("apply_state")))) {
            throw new ProjectStateConflictException("Integration Gate is not ready for a new execution attempt.");
        }
        if (((Number) gate.get("base_state_revision")).longValue()
                    != ((Number) gate.get("state_revision")).longValue()
                || ((Number) gate.get("base_plan_version")).longValue()
                    != ((Number) gate.get("version_number")).longValue()) {
            throw new ProjectStateConflictException("Integration Gate baseline is stale.");
        }
        UUID scheduleId = (UUID) gate.get("schedule_id");
        List<WorkerWorkspace> workers = jdbc.query("""
                SELECT assignment.id, assignment.worker_slot, assignment.status,
                       lease.workspace_path, lease.repository_root, lease.base_commit,
                       lease.branch_ref, lease.physical_workspace_kind, lease.provisioning_state
                FROM parallel_schedule_assignment assignment
                JOIN workspace_lease lease ON lease.assignment_id = assignment.id
                WHERE assignment.schedule_id = ? AND assignment.project_id = ?
                ORDER BY assignment.worker_slot
                FOR UPDATE OF assignment, lease
                """, (row, number) -> new WorkerWorkspace(
                row.getObject("id", UUID.class), row.getInt("worker_slot"), row.getString("status"),
                nullablePath(row.getString("workspace_path")), nullablePath(row.getString("repository_root")),
                row.getString("base_commit"), row.getString("branch_ref"),
                row.getString("physical_workspace_kind"), row.getString("provisioning_state")
        ), scheduleId, projectId);
        if (workers.size() != 2) {
            throw new ProjectStateConflictException("Integration execution requires exactly two Workers.");
        }
        for (WorkerWorkspace worker : workers) {
            if (!"VERIFIED".equals(worker.assignmentStatus())
                    || !"PROVISIONED".equals(worker.provisioningState())
                    || !"GIT_WORKTREE".equals(worker.physicalWorkspaceKind())
                    || worker.workspacePath() == null || worker.repositoryRoot() == null
                    || worker.baseCommit() == null || worker.branchRef() == null) {
                throw new ProjectStateConflictException(
                        "Integration execution requires two verified GIT_WORKTREE Workers."
                );
            }
        }
        WorkerWorkspace first = workers.get(0);
        if (!workers.stream().allMatch(worker -> worker.repositoryRoot().equals(first.repositoryRoot())
                && worker.baseCommit().equals(first.baseCommit()))) {
            throw new ProjectStateConflictException("Worker Worktrees do not share one frozen repository baseline.");
        }
        IntegrationExecutionPolicy policy = policies.resolve(first.repositoryRoot());
        Integer previousAttempts = jdbc.queryForObject(
                "SELECT count(*) FROM integration_execution_run WHERE gate_id = ?", Integer.class, gateId
        );
        int attemptNumber = (previousAttempts == null ? 0 : previousAttempts) + 1;
        UUID runId = UUID.randomUUID();
        String ownershipToken = UUID.randomUUID().toString();
        Path integrationWorkspace = workspaceProperties.root()
                // Keep the Windows Worktree metadata path below Git for Windows' path limit;
                // full UUIDs remain authoritative in the database and ownership marker.
                .resolve("project-" + projectId.toString().substring(0, 8))
                .resolve("integration")
                .resolve("gate-" + gateId.toString().substring(0, 8))
                .resolve("run-" + runId.toString().substring(0, 8));
        String integrationBranch = "zhishu/integration/" + gateId.toString().substring(0, 8)
                + "/" + runId.toString().substring(0, 8);
        jdbc.update("""
                INSERT INTO integration_execution_run (
                    id, project_id, plan_id, gate_id, attempt_number, status,
                    client_request_id, request_hash, created_by, repository_root,
                    base_commit, integration_workspace_path, integration_branch_ref,
                    ownership_token, policy_preset, build_command_summary,
                    test_command_summary, started_at
                ) VALUES (?, ?, ?, ?, ?, 'PREPARING', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now())
                """, runId, projectId, planId, gateId, attemptNumber, requestId, requestHash, actor,
                first.repositoryRoot().toString(), first.baseCommit(), integrationWorkspace.toString(),
                integrationBranch, ownershipToken, policy.preset(),
                policy.buildSummary(), policy.testSummary());
        int gateUpdated = jdbc.update("""
                UPDATE integration_gate_proposal SET apply_state = 'PREPARING'
                WHERE id = ? AND status = 'APPROVED' AND apply_state IN ('NOT_ATTEMPTED', 'FAILED')
                """, gateId);
        if (gateUpdated != 1) {
            throw new ProjectStateConflictException("Integration Gate changed while claiming execution.");
        }
        appendEvent(gateId, "INTEGRATION_EXECUTION_PREPARING", actor,
                json.createObjectNode().put("runId", runId.toString())
                        .put("attemptNumber", attemptNumber)
                        .put("workspacePath", integrationWorkspace.toString())
                        .put("branchRef", integrationBranch));
        return new ExecutionClaim(
                runId, first.repositoryRoot(), first.baseCommit(), integrationWorkspace,
                integrationBranch, ownershipToken, policy, List.copyOf(workers), false
        );
    }

    private ExecutionClaim replayClaim(UUID runId) {
        Map<String, Object> row = jdbc.queryForMap("""
                SELECT repository_root, base_commit, integration_workspace_path,
                       integration_branch_ref, ownership_token
                FROM integration_execution_run WHERE id = ?
                """, runId);
        return new ExecutionClaim(
                runId, Path.of(String.valueOf(row.get("repository_root"))),
                String.valueOf(row.get("base_commit")),
                Path.of(String.valueOf(row.get("integration_workspace_path"))),
                String.valueOf(row.get("integration_branch_ref")),
                String.valueOf(row.get("ownership_token")), null, List.of(), true
        );
    }

    private FinalizationClaim claimFinalization(
            UUID projectId,
            UUID planId,
            UUID gateId,
            UUID runId,
            String actor,
            String clientRequestId,
            String requestHash,
            String expectedCandidateCommit
    ) {
        jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))",
                Object.class, projectId + "|integration-finalization|" + runId);
        Map<String, Object> row;
        try {
            row = jdbc.queryForMap("""
                    SELECT id, status, repository_root, base_commit, candidate_commit,
                           integration_workspace_path, integration_branch_ref, ownership_token,
                           workspace_state, finalization_state, finalization_request_hash,
                           finalized_target_ref
                    FROM integration_execution_run
                    WHERE id = ? AND project_id = ? AND plan_id = ? AND gate_id = ?
                    FOR UPDATE
                    """, runId, projectId, planId, gateId);
        } catch (EmptyResultDataAccessException error) {
            throw new ProjectStateConflictException("Integration execution Run was not found for finalization.");
        }
        if (!"SUCCEEDED".equals(row.get("status"))) {
            throw new ProjectStateConflictException("Only a successful Integration Run can be finalized.");
        }
        String candidateCommit = nullable(row.get("candidate_commit"));
        if (!expectedCandidateCommit.equals(candidateCommit)) {
            throw new ProjectStateConflictException("Integration candidate commit does not match the expected commit.");
        }
        String state = String.valueOf(row.get("finalization_state"));
        if ("CLEANED".equals(state)) {
            if (!requestHash.equals(row.get("finalization_request_hash"))) {
                throw new ProjectStateConflictException("Integration Run was finalized with different content.");
            }
            return finalizationClaim(row, state);
        }
        if (!List.of("NOT_REQUESTED", "APPLYING", "APPLY_FAILED", "APPLIED", "CLEANUP_PENDING")
                .contains(state)) {
            throw new ProjectStateConflictException("Integration Run finalization state is not resumable.");
        }
        String existingHash = nullable(row.get("finalization_request_hash"));
        if (existingHash != null && !requestHash.equals(existingHash)) {
            throw new ProjectStateConflictException("Integration Run finalization content changed across retries.");
        }
        if ("CLEANED".equals(row.get("workspace_state"))) {
            throw new ProjectStateConflictException("Integration Worktree was cleaned before finalization completed.");
        }
        String nextState = List.of("NOT_REQUESTED", "APPLY_FAILED").contains(state) ? "APPLYING" : state;
        jdbc.update("""
                UPDATE integration_execution_run
                SET finalization_state = ?, finalization_client_request_id = ?,
                    finalization_request_hash = ?, finalized_by = ?,
                    finalization_failure_message = NULL
                WHERE id = ?
                """, nextState, clientRequestId, requestHash, actor, runId);
        return finalizationClaim(row, nextState);
    }

    private FinalizationClaim finalizationClaim(Map<String, Object> row, String state) {
        return new FinalizationClaim(
                Path.of(String.valueOf(row.get("repository_root"))),
                String.valueOf(row.get("base_commit")), String.valueOf(row.get("candidate_commit")),
                Path.of(String.valueOf(row.get("integration_workspace_path"))),
                String.valueOf(row.get("integration_branch_ref")), String.valueOf(row.get("ownership_token")),
                state, nullable(row.get("finalized_target_ref"))
        );
    }

    private void markFinalizationApplied(
            UUID runId,
            UUID gateId,
            String actor,
            String targetRef,
            boolean replayed
    ) {
        transactions.executeWithoutResult(status -> {
            int updated = jdbc.update("""
                    UPDATE integration_execution_run
                    SET finalization_state = 'APPLIED', finalized_target_ref = ?,
                        finalized_at = COALESCE(finalized_at, now()), finalization_failure_message = NULL
                    WHERE id = ? AND finalization_state IN ('APPLYING', 'APPLY_FAILED')
                    """, targetRef, runId);
            if (updated != 1) throw new IllegalStateException("Integration finalization apply state changed concurrently");
            appendEvent(gateId, "INTEGRATION_CANDIDATE_APPLIED", actor,
                    json.createObjectNode().put("runId", runId.toString())
                            .put("targetRef", targetRef).put("replayed", replayed));
        });
    }

    private void markCleanupPending(UUID runId) {
        transactions.executeWithoutResult(status -> {
            int updated = jdbc.update("""
                    UPDATE integration_execution_run
                    SET finalization_state = 'CLEANUP_PENDING', workspace_state = 'CLEANUP_PENDING'
                    WHERE id = ? AND finalization_state IN ('APPLIED', 'CLEANUP_PENDING')
                    """, runId);
            if (updated != 1) throw new IllegalStateException("Integration cleanup claim changed concurrently");
        });
    }

    private void markFinalizationCleaned(UUID runId, UUID gateId, String actor) {
        transactions.executeWithoutResult(status -> {
            int updated = jdbc.update("""
                    UPDATE integration_execution_run
                    SET finalization_state = 'CLEANED', workspace_state = 'CLEANED',
                        finalization_failure_message = NULL
                    WHERE id = ? AND finalization_state = 'CLEANUP_PENDING'
                    """, runId);
            if (updated != 1) throw new IllegalStateException("Integration cleanup state changed concurrently");
            appendEvent(gateId, "INTEGRATION_WORKTREE_CLEANED", actor,
                    json.createObjectNode().put("runId", runId.toString()));
        });
    }

    private void markFinalizationFailure(
            UUID runId,
            UUID gateId,
            String actor,
            boolean applied,
            String targetRef,
            String message
    ) {
        transactions.executeWithoutResult(status -> {
            int updated;
            if (applied) {
                updated = jdbc.update("""
                        UPDATE integration_execution_run
                        SET finalization_state = 'CLEANUP_PENDING', workspace_state = 'CLEANUP_PENDING',
                            finalized_target_ref = COALESCE(finalized_target_ref, ?),
                            finalized_at = COALESCE(finalized_at, now()),
                            finalization_failure_message = ?
                        WHERE id = ? AND finalization_state IN ('APPLYING', 'APPLIED', 'CLEANUP_PENDING')
                        """, targetRef, message, runId);
            } else {
                updated = jdbc.update("""
                        UPDATE integration_execution_run
                        SET finalization_state = 'APPLY_FAILED', finalization_failure_message = ?
                        WHERE id = ? AND finalization_state IN ('APPLYING', 'APPLY_FAILED')
                        """, message, runId);
            }
            if (updated != 1) throw new IllegalStateException("Integration finalization failure state changed concurrently");
            appendEvent(gateId, "INTEGRATION_FINALIZATION_FAILED", actor,
                    json.createObjectNode().put("runId", runId.toString())
                            .put("phase", applied ? "CLEANUP" : "APPLY").put("message", message));
        });
    }

    private void applyWorker(
            ExecutionClaim claim,
            Path integrationWorkspace,
            WorkerWorkspace worker,
            int ordinal
    ) throws IOException {
        UUID stepId = startStep(
                claim.runId(), ordinal, "APPLY_WORKER", worker.assignmentId(),
                "git diff/apply worker-" + worker.workerSlot()
        );
        try {
            GitCommandRunner.Result diff = git.requireSuccess(worker.workspacePath(), List.of(
                    "diff", "--binary", "--full-index", claim.baseCommit(), "--"
            ));
            if (!diff.stdout().isEmpty()) {
                Path patch = integrationWorkspace.resolve(".zhishu-worker-" + worker.workerSlot() + ".patch");
                Files.writeString(patch, diff.stdout(), StandardCharsets.UTF_8,
                        StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
                try {
                    GitCommandRunner.Result applied = git.run(integrationWorkspace, List.of(
                            "apply", "--3way", "--index", patch.toString()
                    ));
                    if (applied.exitCode() != 0) {
                        completeStep(stepId, "FAILED", applied.exitCode(), applied.stdout(), applied.stderr());
                        throw new IntegrationStepException(
                                "APPLY_CONFLICT", "Worker " + worker.workerSlot() + " patch could not be applied."
                        );
                    }
                } finally {
                    Files.deleteIfExists(patch);
                }
            }
            int untrackedCount = copyUntracked(worker.workspacePath(), integrationWorkspace);
            completeStep(stepId, "SUCCEEDED", 0,
                    "Applied tracked changes and " + untrackedCount + " untracked file(s).", "");
        } catch (IntegrationStepException error) {
            completeStep(stepId, "FAILED", null, "", safeMessage(error));
            throw error;
        } catch (Exception error) {
            completeStep(stepId, "FAILED", null, "", safeMessage(error));
            throw error;
        }
    }

    private int copyUntracked(Path worker, Path integration) throws IOException {
        GitCommandRunner.Result listed = git.requireSuccess(
                worker, List.of("ls-files", "--others", "--exclude-standard", "-z")
        );
        int copied = 0;
        for (String value : listed.stdout().split("\\u0000", -1)) {
            if (value.isBlank()) continue;
            Path relative = Path.of(value).normalize();
            if (WORKSPACE_LEASE_MARKER.equals(relative)) continue;
            if (relative.isAbsolute() || relative.startsWith("..")) {
                throw new IOException("Worker supplied an unsafe untracked path.");
            }
            Path source = worker.resolve(relative).normalize();
            Path target = integration.resolve(relative).normalize();
            if (!source.startsWith(worker.normalize()) || !target.startsWith(integration.normalize())
                    || Files.isSymbolicLink(source) || !Files.isRegularFile(source, LinkOption.NOFOLLOW_LINKS)) {
                throw new IOException("Worker untracked file is outside the isolated Worktree.");
            }
            if (Files.exists(target, LinkOption.NOFOLLOW_LINKS)) {
                if (Files.isSymbolicLink(target)
                        || !java.util.Arrays.equals(Files.readAllBytes(source), Files.readAllBytes(target))) {
                    throw new IntegrationStepException(
                            "UNTRACKED_FILE_CONFLICT", "Worker untracked file conflicts with another result: " + relative
                    );
                }
                continue;
            }
            if (target.getParent() != null) Files.createDirectories(target.getParent());
            Files.copy(source, target, StandardCopyOption.COPY_ATTRIBUTES);
            copied += 1;
        }
        return copied;
    }

    private void createCandidateCommit(ExecutionClaim claim, Path workspace, int ordinal) throws IOException {
        UUID stepId = startStep(
                claim.runId(), ordinal, "CREATE_CANDIDATE", null, "git create isolated candidate commit"
        );
        try {
            git.requireSuccess(workspace, List.of(
                    "add", "-A", "--", ".", ":(exclude).zhishu-integration-run.json"
            ));
            GitCommandRunner.Result changed = git.run(workspace, List.of("diff", "--cached", "--quiet"));
            if (changed.exitCode() == 1) {
                Map<String, String> identity = Map.of(
                        "GIT_AUTHOR_NAME", "Zhishu Integration",
                        "GIT_AUTHOR_EMAIL", "integration@zhishu.invalid",
                        "GIT_COMMITTER_NAME", "Zhishu Integration",
                        "GIT_COMMITTER_EMAIL", "integration@zhishu.invalid"
                );
                git.requireSuccess(workspace, List.of(
                        "commit", "-m", "zhishu integration " + claim.runId()
                ), identity);
            } else if (changed.exitCode() != 0) {
                throw new IOException("Git could not determine whether the candidate index changed.");
            }
            String candidateCommit = git.requireSuccess(
                    workspace, List.of("rev-parse", "--verify", "HEAD^{commit}")
            ).stdout().trim();
            jdbc.update("UPDATE integration_execution_run SET candidate_commit = ? WHERE id = ?",
                    candidateCommit, claim.runId());
            completeStep(stepId, "SUCCEEDED", 0, "Candidate " + candidateCommit, "");
        } catch (Exception error) {
            completeStep(stepId, "FAILED", null, "", safeMessage(error));
            if (error instanceof IOException io) throw io;
            throw new IOException("Integration candidate commit failed.", error);
        }
    }

    private IntegrationCommandRunner.Result runCommandStep(
            UUID runId,
            int ordinal,
            String stepType,
            UUID assignmentId,
            String summary,
            ThrowingCommand command
    ) throws IOException {
        UUID stepId = startStep(runId, ordinal, stepType, assignmentId, summary);
        try {
            IntegrationCommandRunner.Result result = command.run();
            completeStep(stepId, result.exitCode() == 0 ? "SUCCEEDED" : "FAILED",
                    result.exitCode(), result.stdout(), result.stderr());
            return result;
        } catch (Exception error) {
            completeStep(stepId, "FAILED", null, "", safeMessage(error));
            throw error;
        }
    }

    private UUID startStep(
            UUID runId,
            int ordinal,
            String type,
            UUID assignmentId,
            String commandSummary
    ) {
        UUID stepId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO integration_execution_step (
                    id, run_id, ordinal, step_type, assignment_id, status, command_summary
                ) VALUES (?, ?, ?, ?, ?, 'RUNNING', ?)
                """, stepId, runId, ordinal, type, assignmentId, commandSummary);
        return stepId;
    }

    private void completeStep(
            UUID stepId,
            String status,
            Integer exitCode,
            String stdout,
            String stderr
    ) {
        jdbc.update("""
                UPDATE integration_execution_step
                SET status = ?, exit_code = ?, stdout_summary = ?, stderr_summary = ?, completed_at = now()
                WHERE id = ? AND status = 'RUNNING'
                """, status, exitCode, bounded(stdout), bounded(stderr), stepId);
    }

    private void transition(UUID runId, UUID gateId, String expected, String next, String gateState) {
        transactions.executeWithoutResult(status -> {
            int runUpdated = jdbc.update("""
                    UPDATE integration_execution_run SET status = ? WHERE id = ? AND status = ?
                    """, next, runId, expected);
            int gateUpdated = jdbc.update("""
                    UPDATE integration_gate_proposal SET apply_state = ?
                    WHERE id = ? AND status = 'APPROVED' AND apply_state = ?
                    """, gateState, gateId, expected);
            if (runUpdated != 1 || gateUpdated != 1) {
                throw new ProjectStateConflictException("Integration execution state changed concurrently.");
            }
        });
    }

    private void fail(ExecutionClaim claim, String actor, Exception error) {
        String code = error instanceof IntegrationStepException step ? step.code() : "INTEGRATION_EXECUTION_FAILED";
        transactions.executeWithoutResult(status -> {
            jdbc.update("""
                    UPDATE integration_execution_run
                    SET status = 'FAILED', failure_code = ?, failure_message = ?, completed_at = now()
                    WHERE id = ? AND status IN ('PREPARING', 'APPLYING', 'BUILDING', 'TESTING')
                    """, code, safeMessage(error), claim.runId());
            jdbc.update("""
                    UPDATE integration_gate_proposal SET apply_state = 'FAILED'
                    WHERE id = (SELECT gate_id FROM integration_execution_run WHERE id = ?)
                      AND status = 'APPROVED'
                      AND apply_state IN ('PREPARING', 'APPLYING', 'BUILDING', 'TESTING')
                    """, claim.runId());
            UUID gateId = jdbc.queryForObject(
                    "SELECT gate_id FROM integration_execution_run WHERE id = ?", UUID.class, claim.runId()
            );
            appendEvent(gateId, "INTEGRATION_EXECUTION_FAILED", actor,
                    json.createObjectNode().put("runId", claim.runId().toString())
                            .put("code", code).put("message", safeMessage(error)));
        });
    }

    private void proposeAutomaticReplan(
            UUID projectId,
            UUID planId,
            UUID gateId,
            UUID runId,
            String failureSummary
    ) {
        try {
            Map<String, Object> proposal = replans.createForIntegrationFailure(
                    projectId, planId, runId, "system:automatic-replan", failureSummary
            );
            UUID proposalId = (UUID) proposal.get("proposalId");
            appendEvent(gateId, "AUTOMATIC_REPLAN_PROPOSED", "system:automatic-replan",
                    json.createObjectNode().put("runId", runId.toString())
                            .put("proposalId", proposalId.toString()));
        } catch (RuntimeException replanError) {
            appendEvent(gateId, "AUTOMATIC_REPLAN_FAILED", "system:automatic-replan",
                    json.createObjectNode().put("runId", runId.toString())
                            .put("message", safeMessage(replanError)));
        }
    }

    private void appendEvent(UUID gateId, String eventType, String actor, ObjectNode payload) {
        jdbc.update("""
                INSERT INTO integration_gate_event (gate_id, event_type, actor, payload)
                VALUES (?, ?, ?, CAST(? AS jsonb))
                """, gateId, eventType, actor, write(payload));
    }

    private String bounded(String value) {
        String text = value == null ? "" : value;
        return text.length() <= properties.outputLimit() ? text : text.substring(0, properties.outputLimit());
    }

    private String safeMessage(Throwable error) {
        String message = error.getMessage();
        return message == null || message.isBlank() ? error.getClass().getSimpleName() : message;
    }

    private String nullable(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private Path nullablePath(String value) {
        return value == null || value.isBlank() ? null : Path.of(value);
    }

    private Integer nullableInteger(Object value) {
        return value == null ? null : ((Number) value).intValue();
    }

    private Instant instant(Object value) {
        return value == null ? null : ((Timestamp) value).toInstant();
    }

    private String requireText(String value, String field) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(field + " is required");
        return value.trim();
    }

    private String requireCommit(String value, String field) {
        String commit = requireText(value, field);
        if (!commit.matches("[0-9a-f]{40,64}")) {
            throw new IllegalArgumentException(field + " must be a full lowercase object id");
        }
        return commit;
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
        try {
            return json.writeValueAsString(value);
        } catch (JsonProcessingException error) {
            throw new IllegalStateException("Integration event serialization failed", error);
        }
    }

    @FunctionalInterface
    private interface ThrowingCommand {
        IntegrationCommandRunner.Result run() throws IOException;
    }

    private record ExecutionClaim(
            UUID runId,
            Path repositoryRoot,
            String baseCommit,
            Path integrationWorkspace,
            String integrationBranch,
            String ownershipToken,
            IntegrationExecutionPolicy policy,
            List<WorkerWorkspace> workers,
            boolean replayed
    ) {
    }

    private record InterruptedRun(UUID runId, UUID projectId, UUID planId, UUID gateId) {
    }

    private record FinalizationClaim(
            Path repositoryRoot,
            String baseCommit,
            String candidateCommit,
            Path integrationWorkspace,
            String integrationBranch,
            String ownershipToken,
            String finalizationState,
            String finalizedTargetRef
    ) {
    }

    private record WorkerWorkspace(
            UUID assignmentId,
            int workerSlot,
            String assignmentStatus,
            Path workspacePath,
            Path repositoryRoot,
            String baseCommit,
            String branchRef,
            String physicalWorkspaceKind,
            String provisioningState
    ) {
    }

    private static final class IntegrationStepException extends IOException {
        private final String code;

        private IntegrationStepException(String code, String message) {
            super(message);
            this.code = code;
        }

        private String code() {
            return code;
        }
    }
}
