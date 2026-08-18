package com.zhishu.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import com.zhishu.artifact.ArtifactType;
import com.zhishu.artifact.TaskArtifactService;
import com.zhishu.approval.ApprovalMode;
import com.zhishu.approval.ApprovalService;
import com.zhishu.event.RuntimeEvent;
import com.zhishu.event.RuntimeEventBatch;
import com.zhishu.event.RuntimeEventIngestionResult;
import com.zhishu.event.RuntimeEventIngestionService;
import com.zhishu.event.RuntimeEventType;
import com.zhishu.task.AttemptStatus;
import com.zhishu.task.ResolutionStatus;
import com.zhishu.task.TaskApplicationService;
import com.zhishu.runtime.RuntimeAccepted;
import com.zhishu.runtime.RuntimeClient;
import com.zhishu.runtime.RuntimeStartCommand;
import com.zhishu.runtime.RuntimeLeaseService;
import com.zhishu.state.ProjectStateConflictException;
import com.zhishu.workorder.WorkOrderService;
import com.zhishu.workspace.WorkspaceProvisionerService;
import com.zhishu.workspace.GitCommandRunner;
import com.zhishu.scheduler.ParallelScheduleView;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.mockito.ArgumentCaptor;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers(disabledWithoutDocker = true)
class GoldenCorePostgresIntegrationTest {

    private static final String RUNTIME_RUN_ID = "testcontainers-run-1";
    private static final Path WORKSPACE_ROOT = Path.of(
            System.getProperty("java.io.tmpdir"), "zhishu-workspace-integration-" + UUID.randomUUID()
    );
    private static final String SUMMARY = "真实 PostgreSQL 集成测试已通过。";

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("zhishu_integration")
            .withUsername("zhishu")
            .withPassword("zhishu");

    @DynamicPropertySource
    static void postgresProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("zhishu.runtime.token", () -> "integration-runtime-token");
        registry.add("zhishu.project-control.token", () -> "integration-project-control-token");
        registry.add("zhishu.approval.timeout-scheduling-enabled", () -> "false");
        registry.add("zhishu.runtime.lease.scheduling-enabled", () -> "false");
        registry.add("zhishu.work-order.dispatch.scheduling-enabled", () -> "false");
        registry.add("zhishu.project-activity.retention-events", () -> "5");
        registry.add("zhishu.workspace.provisioning.root", WORKSPACE_ROOT::toString);
        registry.add("zhishu.workspace.provisioning.scheduling-enabled", () -> "false");
        registry.add("zhishu.integration.execution.sandbox-mode", () -> "BEST_EFFORT");
    }

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private RuntimeEventIngestionService eventIngestion;

    @Autowired
    private TaskApplicationService tasks;

    @Autowired
    private TaskArtifactService artifacts;

    @Autowired
    private ApprovalService approvalService;

    @Autowired
    private RuntimeLeaseService runtimeLeases;

    @Autowired
    private WorkspaceProvisionerService workspaceProvisioner;

    @Autowired
    private IntegrationGateService integrationGates;

    @Autowired
    private IntegrationExecutionService integrationExecutions;

    @Autowired
    private GitCommandRunner git;

    @Autowired
    private WorkOrderService workOrders;

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper json;

    @MockitoBean
    private RuntimeClient runtimeClient;

    private UUID taskId;
    private UUID attemptId;
    private UUID projectId;
    private UUID profileId;

    @BeforeEach
    void seedStartingAttempt() {
        reset(runtimeClient);
        when(runtimeClient.start(any())).thenReturn(new RuntimeAccepted("follow-up-runtime-run", true));
        projectId = UUID.randomUUID();
        profileId = UUID.randomUUID();
        taskId = UUID.randomUUID();
        attemptId = UUID.randomUUID();

        jdbc.update("""
                INSERT INTO project (id, runtime_project_ref, name, display_root_path)
                VALUES (?, ?, ?, ?)
                """, projectId, "integration-project-" + projectId, "Integration Project", "/workspace");
        jdbc.update("INSERT INTO project_approval_policy (project_id) VALUES (?)", projectId);
        jdbc.update("""
                INSERT INTO agent_profile (
                    id, project_id, name, executor, capabilities, permission_policy, timeout_seconds
                ) VALUES (?, ?, ?, ?, CAST(? AS jsonb), CAST(? AS jsonb), ?)
                """, profileId, projectId, "Integration Profile", "claude",
                "[\"READ_FILE\",\"WRITE_FILE\",\"TEST\"]", "{\"requireApprovalFor\":[]}", 600);
        jdbc.update("""
                INSERT INTO agent_task (id, project_id, profile_id, title, objective, status)
                VALUES (?, ?, ?, ?, ?, ?)
                """, taskId, projectId, profileId, "Golden Core PostgreSQL E2E",
                "Verify the event projection path", AttemptStatus.STARTING.name());
        jdbc.update("""
                INSERT INTO task_attempt (
                    id, task_id, attempt_number, runtime_run_id, status, profile_snapshot
                ) VALUES (?, ?, ?, ?, ?, CAST(? AS jsonb))
                """, attemptId, taskId, 1, RUNTIME_RUN_ID, AttemptStatus.STARTING.name(),
                "{\"executor\":\"claude\",\"connectionRef\":null,\"modelAlias\":null,"
                        + "\"capabilities\":[\"READ_FILE\",\"WRITE_FILE\",\"TEST\"],"
                        + "\"requireApprovalFor\":[],\"timeoutSeconds\":600,\"promptVersion\":\"task-v1\"}");
        jdbc.update("""
                UPDATE agent_task SET current_attempt_id = ? WHERE id = ?
                """, attemptId, taskId);
    }

    @Test
    void resolvesExistingProjectRegistrationWithoutWriting() throws Exception {
        String projectRef = "integration-project-" + projectId;

        mockMvc.perform(get("/api/v1/projects/resolve").queryParam("projectRef", projectRef))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.projectId").value(projectId.toString()))
                .andExpect(jsonPath("$.profileId").value(profileId.toString()))
                .andExpect(jsonPath("$.projectRef").value(projectRef))
                .andExpect(jsonPath("$.profileName").value("Integration Profile"));

        mockMvc.perform(get("/api/v1/projects/resolve").queryParam("projectRef", "missing-project"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("PROJECT_REGISTRATION_NOT_FOUND"));
    }

    @Test
    void ensuredProjectImmediatelyResolvesThroughWorkspaceIdentity() throws Exception {
        UUID candidateProjectId = UUID.randomUUID();
        String projectRef = "D:\\workspace\\bootstrap-" + candidateProjectId;
        String ensureRequest = json.writeValueAsString(Map.of(
                "candidateProjectId", candidateProjectId,
                "projectRef", projectRef,
                "displayName", "Bootstrap Project"
        ));

        mockMvc.perform(post("/api/v1/projects/ensure")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(ensureRequest))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.projectId").value(candidateProjectId.toString()))
                .andExpect(jsonPath("$.projectRef").value(projectRef));

        mockMvc.perform(get("/internal/project-control/v1/workspaces/resolve")
                        .header("Authorization", "Bearer integration-project-control-token")
                        .param("machineId", "bootstrap-machine")
                        .param("localProjectId", "bootstrap-local-project")
                        .param("normalizedWorkspacePath", projectRef))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.resolution").value("PROPOSAL_REQUIRED"))
                .andExpect(jsonPath("$.project.projectId").value(candidateProjectId.toString()))
                .andExpect(jsonPath("$.executionRegistration.projectId").value(candidateProjectId.toString()));

        assertThat(jdbc.queryForObject(
                """
                SELECT count(*)
                FROM workspace_binding
                WHERE project_id = ? AND machine_id = 'legacy-unscoped'
                  AND normalized_workspace_path = ? AND status = 'ACTIVE'
                """,
                Integer.class,
                candidateProjectId,
                projectRef
        )).isEqualTo(1);
    }

    @Test
    void migratesPersistsProjectsAndKeepsRuntimeReplayIdempotent() throws Exception {
        UUID artifactId = UUID.randomUUID();
        UUID approvalId = UUID.randomUUID();
        Instant startedAt = Instant.parse("2026-08-12T08:00:00Z");
        RuntimeEventBatch batch = new RuntimeEventBatch("1.0", List.of(
                event("run-started", 1, startedAt, RuntimeEventType.RUN_STARTED, Map.of()),
                event("artifact-published", 2, startedAt.plusSeconds(1),
                        RuntimeEventType.ARTIFACT_PUBLISHED, artifactPayload(artifactId)),
                event("run-completed", 3, startedAt.plusSeconds(2),
                        RuntimeEventType.RUN_COMPLETED, Map.of("result", "completed"))
        ));

        RuntimeEventIngestionResult first = eventIngestion.ingest(batch);
        RuntimeEventIngestionResult replay = eventIngestion.ingest(batch);

        assertThat(first).isEqualTo(new RuntimeEventIngestionResult(3, 0));
        assertThat(replay).isEqualTo(new RuntimeEventIngestionResult(0, 3));
        assertThat(tasks.get(taskId).taskId()).isEqualTo(taskId);
        assertThat(tasks.get(taskId).attemptId()).isEqualTo(attemptId);
        assertThat(tasks.get(taskId).status()).isEqualTo(AttemptStatus.SUCCEEDED);
        assertThat(tasks.get(taskId).resolutionStatus()).isEqualTo(ResolutionStatus.WAITING_ACCEPTANCE);
        assertThat(tasks.get(taskId).completedAt()).isEqualTo(startedAt.plusSeconds(2));

        assertThat(artifacts.findByTaskId(taskId)).singleElement().satisfies(artifact -> {
            assertThat(artifact.id()).isEqualTo(artifactId);
            assertThat(artifact.taskId()).isEqualTo(taskId);
            assertThat(artifact.attemptId()).isEqualTo(attemptId);
            assertThat(artifact.artifactType()).isEqualTo(ArtifactType.SUMMARY);
            assertThat(artifact.contentPlain()).isEqualTo(SUMMARY);
            assertThat(artifact.metadata()).containsEntry("attemptNumber", 1);
        });

        assertThat(count("SELECT count(*) FROM flyway_schema_history WHERE success")).isEqualTo(27);
        assertThat(count(
                "SELECT count(*) FROM task_event WHERE projected_at IS NOT NULL AND attempt_id = ?", attemptId
        )).isEqualTo(3);
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM task_artifact WHERE task_id = ?",
                Integer.class,
                taskId
        )).isEqualTo(1);

        mockMvc.perform(get("/api/v1/tasks/{taskId}/artifacts", taskId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value(artifactId.toString()))
                .andExpect(jsonPath("$[0].taskId").value(taskId.toString()))
                .andExpect(jsonPath("$[0].attemptId").value(attemptId.toString()))
                .andExpect(jsonPath("$[0].artifactType").value("SUMMARY"))
                .andExpect(jsonPath("$[0].contentPlain").value(SUMMARY))
                .andExpect(jsonPath("$[0].metadata.attemptNumber").value(1));

        mockMvc.perform(post("/api/v1/tasks/{taskId}/acceptance", taskId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "attemptId": "%s",
                                  "clientRequestId": "resolved-request-1",
                                  "actor": "integration-user",
                                  "decision": "RESOLVED",
                                  "reason": "验证结果满足验收要求"
                                }
                                """.formatted(attemptId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.decision").value("RESOLVED"));
        assertThat(tasks.get(taskId).resolutionStatus()).isEqualTo(ResolutionStatus.RESOLVED);
        assertThat(count("SELECT count(*) FROM task_acceptance_audit WHERE task_id = ?", taskId)).isEqualTo(1);

        jdbc.update("""
                INSERT INTO approval_request (
                    id, task_id, attempt_id, runtime_approval_id, tool_name,
                    tool_input, risk_level, status
                ) VALUES (?, ?, ?, ?, ?, CAST(? AS jsonb), ?, ?)
                """, approvalId, taskId, attemptId, "approval-1", "Write",
                "{\"file_path\":\"README.md\"}", "HIGH", "DENIED");
        assertThat(count("SELECT count(*) FROM approval_request WHERE task_id = ?", taskId)).isEqualTo(1);

        UUID evidenceReferenceId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO evidence_reference (
                    id, project_id, artifact_id, source_type, source_id, purpose, created_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """, evidenceReferenceId, projectId, artifactId, "INTEGRATION_TEST", taskId,
                "Protect projected execution evidence", "user:integration");

        mockMvc.perform(delete("/api/v1/tasks/{taskId}", taskId))
                .andExpect(status().isNoContent());
        assertThat(count("SELECT count(*) FROM agent_task WHERE id = ? AND archived_at IS NOT NULL", taskId)).isOne();
        assertThat(count("SELECT count(*) FROM task_attempt WHERE task_id = ?", taskId)).isOne();
        assertThat(count("SELECT count(*) FROM task_event WHERE task_id = ?", taskId)).isEqualTo(3);
        assertThat(count("SELECT count(*) FROM approval_request WHERE task_id = ?", taskId)).isOne();
        assertThat(count("SELECT count(*) FROM task_artifact WHERE task_id = ?", taskId)).isOne();
        assertThat(count("SELECT count(*) FROM evidence_reference WHERE id = ?", evidenceReferenceId)).isOne();
        mockMvc.perform(get("/api/v1/tasks/{taskId}", taskId)).andExpect(status().isNotFound());
    }

    @Test
    void replaysDurableProjectActivityAndReportsBoundedMetrics() throws Exception {
        String activityPath = "/internal/project-control/v1/projects/{projectId}/activity";
        mockMvc.perform(get(activityPath, projectId)).andExpect(status().isUnauthorized());

        String headResponse = mockMvc.perform(get(activityPath, projectId)
                        .header("Authorization", "Bearer integration-project-control-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("READY"))
                .andExpect(jsonPath("$.requestedAfterCursor").doesNotExist())
                .andExpect(jsonPath("$.events.length()").value(0))
                .andReturn().getResponse().getContentAsString();
        long headCursor = json.readTree(headResponse).path("latestCursor").asLong();

        jdbc.update("""
                UPDATE task_attempt
                SET status = 'FAILED', runtime_health_status = 'LOST',
                    started_at = now() - INTERVAL '2 seconds', completed_at = now(),
                    error_code = 'ACTIVITY_TEST', error_message = 'Expected metrics failure'
                WHERE id = ?
                """, attemptId);
        jdbc.update("""
                UPDATE agent_task
                SET status = 'FAILED', resolution_status = 'NEEDS_FOLLOW_UP', updated_at = now()
                WHERE id = ?
                """, taskId);

        mockMvc.perform(get(activityPath, projectId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .queryParam("after", Long.toString(headCursor))
                        .queryParam("limit", "100"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("READY"))
                .andExpect(jsonPath("$.events.length()").value(2))
                .andExpect(jsonPath("$.events[0].projectId").value(projectId.toString()))
                .andExpect(jsonPath("$.events[0].taskId").value(taskId.toString()));

        JsonNode context = generateContext("BRAIN");
        UUID threadId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO brain_thread (id, project_id, title, created_by)
                VALUES (?, ?, 'Metrics thread', 'user:integration')
                """, threadId, projectId);
        jdbc.update("""
                INSERT INTO brain_run (
                    id, thread_id, context_package_id, role_version, prompt_version,
                    output_schema_version, provider, model, permissions,
                    composite_context_version, status, input_tokens, output_tokens, completed_at
                ) VALUES (?, ?, ?, 'project-brain:v1', 'project-brain-prompt:v1', '1.0',
                          'integration', 'metrics-model', '{}'::jsonb, '{}'::jsonb,
                          'SUCCEEDED', 7, 8, now())
                """, runId, threadId, UUID.fromString(context.path("packageId").asText()));

        mockMvc.perform(get("/internal/project-control/v1/projects/{projectId}/metrics", projectId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .queryParam("windowHours", "168"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.attempts.total").value(1))
                .andExpect(jsonPath("$.attempts.failed").value(1))
                .andExpect(jsonPath("$.attempts.lostHealth").value(1))
                .andExpect(jsonPath("$.attempts.failureRate").value(1.0))
                .andExpect(jsonPath("$.attempts.p95DurationMs").isNumber())
                .andExpect(jsonPath("$.tokens.brainRuns").value(1))
                .andExpect(jsonPath("$.tokens.totalTokens").value(15))
                .andExpect(jsonPath("$.activity.latestCursor").isNumber());

        for (int index = 0; index < 6; index++) {
            jdbc.update("""
                    INSERT INTO project_activity_event (
                        project_id, change_type, resource_type, resource_id
                    ) VALUES (?, 'TEST_CHANGE', 'TEST_RESOURCE', ?)
                    """, projectId, "test-resource-" + index);
        }
        mockMvc.perform(get(activityPath, projectId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .queryParam("after", Long.toString(headCursor)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("RESYNC_REQUIRED"))
                .andExpect(jsonPath("$.retentionFloorCursor").isNumber())
                .andExpect(jsonPath("$.events.length()").value(0));
    }

    @Test
    void runtimeLeaseUsesUnknownGraceThenLostRetryAndIsolatesLateOldRunEvents() throws Exception {
        Instant observedAt = Instant.now();
        eventIngestion.ingest(new RuntimeEventBatch("1.0", List.of(
                event("lease-run-started", 1, observedAt, RuntimeEventType.RUN_STARTED, Map.of())
        )));
        assertThat(jdbc.queryForObject(
                "SELECT runtime_health_status FROM task_attempt WHERE id = ?", String.class, attemptId
        )).isEqualTo("HEALTHY");

        jdbc.update("UPDATE task_attempt SET lease_expires_at = ? WHERE id = ?",
                Timestamp.from(observedAt.minusSeconds(10)), attemptId);
        RuntimeLeaseService.RuntimeLeaseSweepResult unknown = runtimeLeases.sweep();
        assertThat(unknown.markedUnknown()).isEqualTo(1);
        assertThat(jdbc.queryForObject(
                "SELECT status FROM task_attempt WHERE id = ?", String.class, attemptId
        )).isEqualTo("RUNNING");
        assertThat(jdbc.queryForObject(
                "SELECT runtime_health_status FROM task_attempt WHERE id = ?", String.class, attemptId
        )).isEqualTo("UNKNOWN");

        eventIngestion.ingest(new RuntimeEventBatch("1.0", List.of(
                event("lease-heartbeat-recovered", 2, Instant.now(),
                        RuntimeEventType.RUNTIME_HEARTBEAT, Map.of("runtimeInstanceId", "runtime-a"))
        )));
        assertThat(jdbc.queryForObject(
                "SELECT runtime_health_status FROM task_attempt WHERE id = ?", String.class, attemptId
        )).isEqualTo("HEALTHY");
        assertThat(jdbc.queryForObject(
                "SELECT status FROM task_attempt WHERE id = ?", String.class, attemptId
        )).isEqualTo("RUNNING");

        jdbc.update("UPDATE task_attempt SET lease_expires_at = ? WHERE id = ?",
                Timestamp.from(Instant.now().minusSeconds(10)), attemptId);
        runtimeLeases.sweep();

        jdbc.update("UPDATE task_attempt SET unknown_since = ? WHERE id = ?",
                Timestamp.from(Instant.now().minusSeconds(120)), attemptId);
        RuntimeLeaseService.RuntimeLeaseSweepResult lost = runtimeLeases.sweep();
        assertThat(lost.markedLost()).isEqualTo(1);
        assertThat(jdbc.queryForObject(
                "SELECT status FROM task_attempt WHERE id = ?", String.class, attemptId
        )).isEqualTo("LOST");
        assertThat(jdbc.queryForObject(
                "SELECT status FROM agent_task WHERE id = ?", String.class, taskId
        )).isEqualTo("LOST");

        mockMvc.perform(post("/api/v1/tasks/{taskId}/retry", taskId))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.attemptNumber").value(2))
                .andExpect(jsonPath("$.attemptStatus").value("STARTING"));
        UUID retryAttemptId = jdbc.queryForObject(
                "SELECT current_attempt_id FROM agent_task WHERE id = ?", UUID.class, taskId
        );
        assertThat(retryAttemptId).isNotEqualTo(attemptId);

        RuntimeEventIngestionResult late = eventIngestion.ingest(new RuntimeEventBatch("1.0", List.of(
                event("late-old-run-completed", 3, Instant.now(), RuntimeEventType.RUN_COMPLETED, Map.of())
        )));
        assertThat(late.accepted()).isEqualTo(1);
        assertThat(jdbc.queryForObject(
                "SELECT status FROM task_attempt WHERE id = ?", String.class, attemptId
        )).isEqualTo("LOST");
        assertThat(jdbc.queryForObject(
                "SELECT status FROM agent_task WHERE id = ?", String.class, taskId
        )).isEqualTo("STARTING");
    }

    @Test
    void projectIdentityMigrationAddsStableIdentityAndWorkspaceBindingSchema() {
        UUID workspaceId = UUID.randomUUID();
        String localProjectId = "local-project-" + projectId;
        String workspacePath = "D:\\workspace\\" + projectId;

        jdbc.update("""
                INSERT INTO workspace_binding (
                    id, project_id, machine_id, local_project_id,
                    workspace_path, normalized_workspace_path, is_primary, status
                ) VALUES (?, ?, ?, ?, ?, ?, TRUE, 'ACTIVE')
                """, workspaceId, projectId, "integration-machine", localProjectId,
                workspacePath, workspacePath);

        assertThat(jdbc.queryForObject(
                "SELECT status FROM project WHERE id = ?", String.class, projectId
        )).isEqualTo("ACTIVE");
        assertThat(jdbc.queryForObject(
                "SELECT identity_version FROM project WHERE id = ?", Long.class, projectId
        )).isEqualTo(1L);
        assertThat(jdbc.queryForObject(
                """
                SELECT project_id
                FROM workspace_binding
                WHERE machine_id = ? AND local_project_id = ?
                """,
                UUID.class,
                "integration-machine",
                localProjectId
        )).isEqualTo(projectId);
        assertThat(jdbc.queryForObject(
                "SELECT normalized_workspace_path FROM workspace_binding WHERE id = ?",
                String.class,
                workspaceId
        )).isEqualTo(workspacePath);
    }

    @Test
    void autoApprovesSafeReadAndPersistsApprovalAuditInPostgres() {
        jdbc.update("""
                UPDATE task_attempt
                SET approval_policy_snapshot = CAST(? AS jsonb)
                WHERE id = ?
                """, """
                {"mode":"AUTO_SAFE","projectRoot":"integration-project","allowedDirectories":["."],
                 "trustedCommands":[],"approvalTimeoutSeconds":45}
                """, attemptId);
        Instant startedAt = Instant.parse("2026-08-14T09:00:00Z");
        eventIngestion.ingest(new RuntimeEventBatch("1.0", List.of(
                event("auto-run-started", 1, startedAt, RuntimeEventType.RUN_STARTED, Map.of()),
                event("auto-approval-required", 2, startedAt.plusSeconds(1), RuntimeEventType.APPROVAL_REQUIRED,
                        Map.of("runtimeApprovalId", "safe-read-1", "toolName", "Read",
                                "toolInput", Map.of("file_path", "src/Main.java")))
        )));

        assertThat(jdbc.queryForObject(
                "SELECT status FROM approval_request WHERE attempt_id = ?", String.class, attemptId
        )).isEqualTo("AUTO_APPROVED");
        assertThat(count("SELECT count(*) FROM approval_audit WHERE attempt_id = ?", attemptId)).isEqualTo(1);
        assertThat(jdbc.queryForObject(
                "SELECT rule FROM approval_audit WHERE attempt_id = ?", String.class, attemptId
        )).isEqualTo("safe-read-search");
        verify(runtimeClient, times(1)).decideApproval(any(), any(), any());
    }

    @Test
    void updatesProjectApprovalPolicyWithExactCommands() throws Exception {
        mockMvc.perform(put("/api/v1/projects/{projectId}/approval-policy", projectId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"mode":"AUTO_TRUSTED","allowedDirectories":[".","src"],
                                 "trustedCommands":[["acme","verify"]],"approvalTimeoutSeconds":30}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mode").value("AUTO_TRUSTED"))
                .andExpect(jsonPath("$.trustedCommands[0][1]").value("verify"));
        assertThat(jdbc.queryForObject(
                "SELECT trusted_commands -> 0 ->> 1 FROM project_approval_policy WHERE project_id = ?",
                String.class, projectId
        )).isEqualTo("verify");
    }

    @Test
    void returnsAndCreatesDefaultPolicyWhenProjectPolicyRowIsMissing() throws Exception {
        jdbc.update("DELETE FROM project_approval_policy WHERE project_id = ?", projectId);

        mockMvc.perform(get("/api/v1/projects/{projectId}/approval-policy", projectId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mode").value("MANUAL"))
                .andExpect(jsonPath("$.allowedDirectories[0]").value("."))
                .andExpect(jsonPath("$.approvalTimeoutSeconds").value(45));

        mockMvc.perform(put("/api/v1/projects/{projectId}/approval-policy", projectId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"mode":"AUTO_SAFE","allowedDirectories":["."],
                                 "trustedCommands":[],"approvalTimeoutSeconds":25}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mode").value("AUTO_SAFE"))
                .andExpect(jsonPath("$.approvalTimeoutSeconds").value(25));
    }

    @Test
    void approvalTimeoutDeniesByDefaultAndWritesAudit() {
        Instant startedAt = Instant.parse("2026-08-14T10:00:00Z");
        eventIngestion.ingest(new RuntimeEventBatch("1.0", List.of(
                event("timeout-run-started", 1, startedAt, RuntimeEventType.RUN_STARTED, Map.of()),
                event("timeout-approval-required", 2, startedAt.plusSeconds(1), RuntimeEventType.APPROVAL_REQUIRED,
                        Map.of("runtimeApprovalId", "timeout-1", "toolName", "Write",
                                "toolInput", Map.of("file_path", "src/Main.java")))
        )));
        jdbc.update("UPDATE approval_request SET expires_at = now() - interval '1 second' WHERE attempt_id = ?", attemptId);

        approvalService.denyExpired();

        assertThat(jdbc.queryForObject(
                "SELECT status FROM approval_request WHERE attempt_id = ?", String.class, attemptId
        )).isEqualTo("EXPIRED");
        assertThat(jdbc.queryForObject(
                "SELECT decision_source FROM approval_request WHERE attempt_id = ?", String.class, attemptId
        )).isEqualTo("TIMEOUT");
        assertThat(count("SELECT count(*) FROM approval_audit WHERE attempt_id = ?", attemptId)).isEqualTo(1);
        verify(runtimeClient, times(1)).decideApproval(any(), any(), any());
    }

    @Test
    void rejectsDeletingAnActiveTask() throws Exception {
        mockMvc.perform(delete("/api/v1/tasks/{taskId}", taskId))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_TASK_STATE"));

        assertThat(count("SELECT count(*) FROM agent_task WHERE id = ?", taskId)).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM task_attempt WHERE task_id = ?", taskId)).isEqualTo(1);
    }

    @Test
    void pagesSearchesAndArchivesProjectTaskHistory() throws Exception {
        UUID olderTaskId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO agent_task (
                    id, project_id, profile_id, title, objective, status, resolution_status,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, 'RUNNING', 'IN_PROGRESS', now() - interval '1 day', now() - interval '1 day')
                """, olderTaskId, projectId, profileId, "Older searchable task", "Trace pagination history");

        String firstPage = mockMvc.perform(get(
                        "/internal/project-control/v1/projects/{projectId}/tasks", projectId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .queryParam("archive", "ACTIVE")
                        .queryParam("limit", "1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].taskId").value(taskId.toString()))
                .andExpect(jsonPath("$.hasMore").value(true))
                .andReturn().getResponse().getContentAsString();
        String cursor = json.readTree(firstPage).path("nextCursor").asText();

        mockMvc.perform(get("/internal/project-control/v1/projects/{projectId}/tasks", projectId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .queryParam("archive", "ACTIVE")
                        .queryParam("limit", "1")
                        .queryParam("cursor", cursor))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].taskId").value(olderTaskId.toString()))
                .andExpect(jsonPath("$.hasMore").value(false));

        mockMvc.perform(get("/internal/project-control/v1/projects/{projectId}/tasks", projectId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .queryParam("status", "RUNNING")
                        .queryParam("search", "pagination"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].taskId").value(olderTaskId.toString()));

        jdbc.update("UPDATE task_attempt SET status = 'SUCCEEDED', completed_at = now() WHERE id = ?", attemptId);
        jdbc.update("""
                UPDATE agent_task
                SET status = 'SUCCEEDED', resolution_status = 'WAITING_ACCEPTANCE', updated_at = now()
                WHERE id = ?
                """, taskId);

        mockMvc.perform(post("/internal/project-control/v1/tasks/{taskId}/archive", taskId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"Long-term history retained\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.archivedBy").value("user:integration"))
                .andExpect(jsonPath("$.archiveReason").value("Long-term history retained"));

        mockMvc.perform(get("/internal/project-control/v1/projects/{projectId}/tasks", projectId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .queryParam("archive", "ARCHIVED")
                        .queryParam("search", "Golden Core"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].taskId").value(taskId.toString()))
                .andExpect(jsonPath("$.items[0].archivedAt").isNotEmpty());
        mockMvc.perform(get(
                        "/internal/project-control/v1/projects/{projectId}/tasks/{taskId}", projectId, taskId)
                        .header("Authorization", "Bearer integration-project-control-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.taskId").value(taskId.toString()))
                .andExpect(jsonPath("$.archivedAt").isNotEmpty());
        mockMvc.perform(get(
                        "/internal/project-control/v1/projects/{projectId}/tasks/{taskId}/attempts", projectId, taskId)
                        .header("Authorization", "Bearer integration-project-control-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].attemptId").value(attemptId.toString()));
        mockMvc.perform(get("/internal/project-control/v1/tasks/{taskId}", taskId)
                        .header("Authorization", "Bearer integration-project-control-token"))
                .andExpect(status().isNotFound());
    }

    @Test
    void acceptsAndCreatesIdempotentFollowUpAttemptWithoutLosingHistory() throws Exception {
        Instant startedAt = Instant.parse("2026-08-14T02:00:00Z");
        UUID artifactId = UUID.randomUUID();
        eventIngestion.ingest(new RuntimeEventBatch("1.0", List.of(
                event("follow-up-run-started", 1, startedAt, RuntimeEventType.RUN_STARTED, Map.of()),
                event("follow-up-summary", 2, startedAt.plusSeconds(1),
                        RuntimeEventType.ARTIFACT_PUBLISHED, artifactPayload(artifactId)),
                event("follow-up-run-completed", 3, startedAt.plusSeconds(2),
                        RuntimeEventType.RUN_COMPLETED, Map.of("result", "completed"))
        )));

        String acceptanceRequest = """
                {
                  "attemptId": "%s",
                  "clientRequestId": "acceptance-request-1",
                  "actor": "integration-user",
                  "decision": "NEEDS_FOLLOW_UP",
                  "reason": "手机号登录仍在验证码校验后失败"
                }
                """.formatted(attemptId);
        mockMvc.perform(post("/api/v1/tasks/{taskId}/acceptance", taskId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(acceptanceRequest))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.decision").value("NEEDS_FOLLOW_UP"));
        mockMvc.perform(post("/api/v1/tasks/{taskId}/acceptance", taskId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(acceptanceRequest))
                .andExpect(status().isOk());
        assertThat(count("SELECT count(*) FROM task_acceptance_audit WHERE task_id = ?", taskId)).isEqualTo(1);

        String followUpRequest = """
                {
                  "parentAttemptId": "%s",
                  "clientRequestId": "follow-up-request-1",
                  "actor": "integration-user",
                  "feedback": "手机号登录仍在验证码校验后失败",
                  "requestedAcceptance": "手机号登录成功并通过回归测试",
                  "executor": "codex",
                  "modelAlias": "gpt-5-codex",
                  "approvalMode": "AUTO_SAFE",
                  "additionalContext": {"logPath": "logs/auth.log"}
                }
                """.formatted(attemptId);
        jdbc.update("UPDATE project_approval_policy SET mode = 'AUTO_TRUSTED' WHERE project_id = ?", projectId);
        String first = mockMvc.perform(post("/api/v1/tasks/{taskId}/follow-ups", taskId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(followUpRequest))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.parentAttemptId").value(attemptId.toString()))
                .andExpect(jsonPath("$.attemptNumber").value(2))
                .andExpect(jsonPath("$.attemptStatus").value("STARTING"))
                .andReturn().getResponse().getContentAsString();
        String replay = mockMvc.perform(post("/api/v1/tasks/{taskId}/follow-ups", taskId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(followUpRequest))
                .andExpect(status().isAccepted())
                .andReturn().getResponse().getContentAsString();
        assertThat(replay).isEqualTo(first);
        mockMvc.perform(post("/api/v1/tasks/{taskId}/follow-ups", taskId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(followUpRequest.replace("follow-up-request-1", "follow-up-request-2")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_TASK_STATE"));

        assertThat(count("SELECT count(*) FROM task_follow_up WHERE task_id = ?", taskId)).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM task_attempt WHERE task_id = ?", taskId)).isEqualTo(2);
        assertThat(count("SELECT count(*) FROM task_event WHERE task_id = ?", taskId)).isEqualTo(3);
        assertThat(count("SELECT count(*) FROM task_artifact WHERE task_id = ?", taskId)).isEqualTo(1);
        assertThat(tasks.get(taskId).resolutionStatus()).isEqualTo(ResolutionStatus.IN_PROGRESS);

        mockMvc.perform(get("/api/v1/tasks/{taskId}/follow-ups", taskId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].feedback").value("手机号登录仍在验证码校验后失败"))
                .andExpect(jsonPath("$[0].requestedAcceptance").value("手机号登录成功并通过回归测试"));
        mockMvc.perform(get("/api/v1/tasks/{taskId}/attempts", taskId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].approvalMode").value("AUTO_SAFE"))
                .andExpect(jsonPath("$[0].requestedApprovalMode").value("AUTO_SAFE"));
        mockMvc.perform(get("/api/v1/tasks/{taskId}", taskId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.attemptStatus").value("STARTING"))
                .andExpect(jsonPath("$.resolutionStatus").value("IN_PROGRESS"));

        ArgumentCaptor<RuntimeStartCommand> command = ArgumentCaptor.forClass(RuntimeStartCommand.class);
        verify(runtimeClient, times(1)).start(command.capture());
        assertThat(command.getValue().context()).containsKey("taskFollowUpContext");
        assertThat(command.getValue().context().get("taskFollowUpContext")).asInstanceOf(
                org.assertj.core.api.InstanceOfAssertFactories.MAP
        ).containsEntry("contextType", "TASK_FOLLOW_UP_V1")
                .containsEntry("originalObjective", "Verify the event projection path")
                .containsEntry("userFeedback", "手机号登录仍在验证码校验后失败");
        @SuppressWarnings("unchecked")
        Map<String, Object> followUpContext = (Map<String, Object>) command.getValue().context()
                .get("taskFollowUpContext");
        assertThat(followUpContext).containsKeys("previousAttempt", "attemptHistory", "historyTruncated");
        assertThat(followUpContext.get("historyTruncated")).isEqualTo(false);
        assertThat((List<?>) followUpContext.get("attemptHistory"))
                .singleElement()
                .asInstanceOf(org.assertj.core.api.InstanceOfAssertFactories.MAP)
                .containsEntry("attemptId", attemptId.toString())
                .containsEntry("attemptNumber", 1)
                .containsEntry("status", "SUCCEEDED");
        @SuppressWarnings("unchecked")
        Map<String, Object> previousAttempt = (Map<String, Object>) followUpContext.get("previousAttempt");
        assertThat(previousAttempt)
                .containsEntry("attemptId", attemptId.toString())
                .extractingByKey("evidence")
                .asInstanceOf(org.assertj.core.api.InstanceOfAssertFactories.LIST)
                .anySatisfy(evidence -> assertThat(evidence)
                        .asInstanceOf(org.assertj.core.api.InstanceOfAssertFactories.MAP)
                        .containsEntry("type", "SUMMARY")
                        .containsEntry("content", SUMMARY));
        assertThat(command.getValue().executor()).isEqualTo("codex");
        assertThat(command.getValue().modelAlias()).isEqualTo("gpt-5-codex");
        assertThat(command.getValue().permissionPolicy().mode()).isEqualTo(com.zhishu.approval.ApprovalMode.AUTO_SAFE);
    }

    @Test
    void projectControlCredentialProtectsReadOnlyWorkspaceResolution() throws Exception {
        UUID workspaceId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO workspace_binding (
                    id, project_id, machine_id, local_project_id,
                    workspace_path, normalized_workspace_path, is_primary, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, workspaceId, projectId, "integration-machine", "local-project-1",
                "D:\\workspace\\demo", "D:\\workspace\\demo", true, "ACTIVE");

        mockMvc.perform(get("/internal/project-control/v1/workspaces/resolve")
                        .param("machineId", "integration-machine")
                        .param("localProjectId", "local-project-1")
                        .param("normalizedWorkspacePath", "D:\\workspace\\demo"))
                .andExpect(status().isUnauthorized());

        mockMvc.perform(get("/internal/project-control/v1/workspaces/resolve")
                        .header("Authorization", "Bearer integration-runtime-token")
                        .param("machineId", "integration-machine")
                        .param("localProjectId", "local-project-1")
                        .param("normalizedWorkspacePath", "D:\\workspace\\demo"))
                .andExpect(status().isUnauthorized());

        mockMvc.perform(get("/internal/project-control/v1/workspaces/resolve")
                        .header("Authorization", "Bearer integration-project-control-token")
                        .param("machineId", "integration-machine")
                        .param("localProjectId", "local-project-1")
                        .param("normalizedWorkspacePath", "D:\\workspace\\demo"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.schemaVersion").value("1.0"))
                .andExpect(jsonPath("$.resolution").value("MATCHED_BY_LOCAL_PROJECT_ID"))
                .andExpect(jsonPath("$.project.projectId").value(projectId.toString()))
                .andExpect(jsonPath("$.binding.workspaceId").value(workspaceId.toString()))
                .andExpect(jsonPath("$.executionRegistration.profileId").value(profileId.toString()));

        mockMvc.perform(get("/internal/project-control/v1/tasks")
                        .header("Authorization", "Bearer integration-project-control-token")
                        .param("projectId", projectId.toString())
                        .param("limit", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].taskId").value(taskId.toString()));

        mockMvc.perform(get("/internal/project-control/v1/tasks/{taskId}/attempts", taskId)
                        .header("Authorization", "Bearer integration-project-control-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].attemptId").value(attemptId.toString()));

        mockMvc.perform(get("/internal/project-control/v1/projects/{projectId}/approval-policy", projectId)
                        .header("Authorization", "Bearer integration-project-control-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.projectId").value(projectId.toString()));

        String movedPath = "D:\\workspace\\demo-moved";
        String proposalKey = String.join("|",
                "MOVE_WORKSPACE", projectId.toString(), workspaceId.toString(),
                "integration-machine", "local-project-1", movedPath, "1"
        );
        UUID proposalId = UUID.nameUUIDFromBytes(proposalKey.getBytes(StandardCharsets.UTF_8));
        String confirmRequest = """
                {
                  "proposalId": "%s",
                  "action": "MOVE_WORKSPACE",
                  "machineId": "integration-machine",
                  "localProjectId": "local-project-1",
                  "workspacePath": "D:\\\\workspace\\\\demo-moved",
                  "baseIdentityVersion": 1,
                  "clientRequestId": "move-request-1"
                }
                """.formatted(proposalId);

        mockMvc.perform(post("/internal/project-control/v1/projects/{projectId}/workspace-bindings/{workspaceId}/confirm",
                        projectId, workspaceId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(confirmRequest))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.proposalId").value(proposalId.toString()))
                .andExpect(jsonPath("$.action").value("MOVE_WORKSPACE"))
                .andExpect(jsonPath("$.actor").value("user:integration"))
                .andExpect(jsonPath("$.resultingIdentityVersion").value(2))
                .andExpect(jsonPath("$.binding.normalizedWorkspacePath").value(movedPath));

        mockMvc.perform(post("/internal/project-control/v1/projects/{projectId}/workspace-bindings/{workspaceId}/confirm",
                        projectId, workspaceId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(confirmRequest))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.proposalId").value(proposalId.toString()));

        assertThat(count("SELECT count(*) FROM workspace_binding_change WHERE proposal_id = ?", proposalId))
                .isEqualTo(1);
        assertThat(jdbc.queryForObject(
                "SELECT identity_version FROM project WHERE id = ?", Long.class, projectId
        )).isEqualTo(2L);
        assertThat(jdbc.queryForObject(
                "SELECT status FROM workspace_binding WHERE id = ?", String.class, workspaceId
        )).isEqualTo("MOVED");
    }

    @Test
    void publishesImmutablePlanVersionsAndPreservesCompletedNodesAcrossReplan() throws Exception {
        JsonNode firstContext = generateContext("PLANNER");
        UUID firstContextId = UUID.fromString(firstContext.path("packageId").asText());
        String firstProposal = """
                {
                  "schemaVersion":"1.0",
                  "name":"可信计划",
                  "objective":"交付 Plan Center",
                  "creationReason":"初始 Planner Proposal",
                  "baseStateRevision":0,
                  "basePlanVersion":null,
                  "contextPackageId":"%s",
                  "provider":"zhishu-grounded",
                  "model":"grounded-planner-v1",
                  "permissions":{"taskCreate":false,"runtimeDispatch":false,"planPublish":false},
                  "nodes":[
                    {"nodeKey":"scope","title":"确认范围","objective":"确认范围","scope":[],"acceptanceCriteria":["范围已确认"],"priority":30,"requiredCapabilities":["READ_FILE"],"requiresHumanApproval":false,"dependsOn":[]},
                    {"nodeKey":"implement","title":"实施","objective":"完成实现","scope":[],"acceptanceCriteria":["实现完成"],"priority":20,"requiredCapabilities":["WRITE_FILE"],"requiresHumanApproval":true,"dependsOn":["scope"]},
                    {"nodeKey":"verify","title":"验证","objective":"运行验证","scope":[],"acceptanceCriteria":["测试通过"],"priority":10,"requiredCapabilities":["TEST","NETWORK"],"requiresHumanApproval":false,"dependsOn":["implement"]}
                  ]
                }
                """.formatted(firstContextId);
        UUID proposalId = createPlanProposal(firstProposal);
        assertThat(count("SELECT count(*) FROM plan_version v JOIN project_plan p ON p.id = v.plan_id WHERE p.project_id = ?", projectId))
                .isZero();
        String firstPlanResponse = mockMvc.perform(post(
                        "/internal/project-control/v1/projects/{projectId}/plans/proposals/{proposalId}/publish",
                        projectId, proposalId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"approvedNodeKeys\":[\"scope\",\"implement\",\"verify\"]}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.versionNumber").value(1))
                .andExpect(jsonPath("$.nodes[?(@.nodeKey == 'scope')].executionState").value("READY"))
                .andReturn().getResponse().getContentAsString();
        UUID planId = UUID.fromString(json.readTree(firstPlanResponse).path("planId").asText());
        assertThat(count("SELECT count(*) FROM agent_task WHERE project_id = ?", projectId)).isOne();
        assertThat(jdbc.queryForObject("""
                SELECT executable FROM plan_node_definition
                WHERE plan_version_id = (SELECT current_version_id FROM project_plan WHERE id = ?)
                  AND node_key = 'verify'
                """, Boolean.class, planId)).isFalse();
        assertThatThrownBy(() -> jdbc.update(
                "UPDATE plan_version SET objective = 'mutated' WHERE plan_id = ?", planId
        )).hasMessageContaining("immutable");

        jdbc.update("UPDATE plan_execution_state SET state = 'COMPLETED' WHERE plan_id = ? AND node_key = 'scope'", planId);
        assertThat(count("SELECT count(*) FROM plan_version WHERE plan_id = ?", planId)).isOne();
        JsonNode patchContext = generateContext("PLANNER");
        assertThat(patchContext.path("version").path("planVersion").asLong()).isEqualTo(1);
        UUID patchContextId = UUID.fromString(patchContext.path("packageId").asText());
        String patchProposal = """
                {
                  "schemaVersion":"1.0",
                  "name":"可信计划",
                  "objective":"交付 Plan Center V2",
                  "creationReason":"Replan",
                  "planId":"%s",
                  "baseStateRevision":0,
                  "basePlanVersion":1,
                  "contextPackageId":"%s",
                  "provider":"zhishu-grounded",
                  "model":"grounded-planner-v1",
                  "permissions":{"taskCreate":false,"runtimeDispatch":false,"planPublish":false},
                  "nodes":[
                    {"nodeKey":"scope","title":"确认范围","objective":"确认范围","scope":[],"acceptanceCriteria":["范围已确认"],"priority":30,"requiredCapabilities":["READ_FILE"],"requiresHumanApproval":false,"dependsOn":[],"relationType":"INHERITED","previousNodeKey":"scope"},
                    {"nodeKey":"implement-v2","title":"实施 V2","objective":"完成修订实现","scope":[],"acceptanceCriteria":["修订实现完成"],"priority":20,"requiredCapabilities":["WRITE_FILE"],"requiresHumanApproval":true,"dependsOn":["scope"],"relationType":"SUPERSEDED","previousNodeKey":"implement"},
                    {"nodeKey":"verify-v2","title":"验证 V2","objective":"运行验证","scope":[],"acceptanceCriteria":["测试通过"],"priority":10,"requiredCapabilities":["TEST"],"requiresHumanApproval":false,"dependsOn":["implement-v2"],"relationType":"SUPERSEDED","previousNodeKey":"verify"}
                  ]
                }
                """.formatted(planId, patchContextId);
        UUID patchProposalId = createPlanProposal(patchProposal);
        mockMvc.perform(post(
                        "/internal/project-control/v1/projects/{projectId}/plans/proposals/{proposalId}/publish",
                        projectId, patchProposalId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"approvedNodeKeys\":[]}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.versionNumber").value(2))
                .andExpect(jsonPath("$.nodes[?(@.nodeKey == 'scope')].executionState").value("COMPLETED"))
                .andExpect(jsonPath("$.nodes[?(@.nodeKey == 'implement-v2')].executionState").value("READY"));
        assertThat(jdbc.queryForObject(
                "SELECT state FROM plan_execution_state WHERE plan_id = ? AND node_key = 'implement'",
                String.class, planId
        )).isEqualTo("SUPERSEDED");
        assertThat(count("SELECT count(*) FROM plan_node_version_relation WHERE plan_version_id = (SELECT current_version_id FROM project_plan WHERE id = ?) AND relation_type = 'INHERITED'", planId))
                .isEqualTo(1);
        assertThat(count("SELECT count(*) FROM plan_version WHERE plan_id = ?", planId)).isEqualTo(2);

        JsonNode staleContext = generateContext("PLANNER");
        String staleProposal = patchProposal
                .replace(patchContextId.toString(), staleContext.path("packageId").asText())
                .replace("\"basePlanVersion\":1", "\"basePlanVersion\":2");
        UUID staleProposalId = createPlanProposal(staleProposal);
        jdbc.update("UPDATE project_state_snapshot SET state_revision = 1 WHERE project_id = ?", projectId);
        mockMvc.perform(post(
                        "/internal/project-control/v1/projects/{projectId}/plans/proposals/{proposalId}/publish",
                        projectId, staleProposalId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"approvedNodeKeys\":[]}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("PROJECT_STATE_CONFLICT"));
        assertThat(jdbc.queryForObject("SELECT status FROM plan_proposal WHERE id = ?", String.class, staleProposalId))
                .isEqualTo("STALE");
    }

    @Test
    void supportsDependencySafePartialPlanApprovalAndExplicitRejection() throws Exception {
        JsonNode context = generateContext("PLANNER");
        String proposalBody = """
                {
                  "schemaVersion":"1.0","name":"Partial","objective":"Partial approval",
                  "creationReason":"Test","baseStateRevision":0,"basePlanVersion":null,
                  "contextPackageId":"%s","provider":"zhishu-grounded","model":"grounded-planner-v1",
                  "permissions":{"taskCreate":false,"runtimeDispatch":false,"planPublish":false},
                  "nodes":[
                    {"nodeKey":"scope","title":"Scope","objective":"Scope","scope":[],"acceptanceCriteria":["Scoped"],"priority":2,"requiredCapabilities":["READ_FILE"],"requiresHumanApproval":false,"dependsOn":[]},
                    {"nodeKey":"implement","title":"Implement","objective":"Implement","scope":[],"acceptanceCriteria":["Done"],"priority":1,"requiredCapabilities":["WRITE_FILE"],"requiresHumanApproval":true,"dependsOn":["scope"]}
                  ]
                }
                """.formatted(context.path("packageId").asText());
        UUID proposalId = createPlanProposal(proposalBody);
        mockMvc.perform(post(
                        "/internal/project-control/v1/projects/{projectId}/plans/proposals/{proposalId}/publish",
                        projectId, proposalId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"approvedNodeKeys\":[\"implement\"]}"))
                .andExpect(status().isBadRequest());
        String partialResponse = mockMvc.perform(post(
                        "/internal/project-control/v1/projects/{projectId}/plans/proposals/{proposalId}/publish",
                        projectId, proposalId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"approvedNodeKeys\":[\"scope\"]}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.nodes.length()").value(1))
                .andReturn().getResponse().getContentAsString();
        UUID planId = UUID.fromString(json.readTree(partialResponse).path("planId").asText());
        assertThat(jdbc.queryForObject("SELECT status FROM plan_proposal WHERE id = ?", String.class, proposalId))
                .isEqualTo("PARTIALLY_APPROVED");

        JsonNode patchContext = generateContext("PLANNER");
        String rejectionBody = """
                {
                  "schemaVersion":"1.0","name":"Partial","objective":"Rejected patch",
                  "creationReason":"Test","planId":"%s","baseStateRevision":0,"basePlanVersion":1,
                  "contextPackageId":"%s","provider":"zhishu-grounded","model":"grounded-planner-v1",
                  "permissions":{"taskCreate":false,"runtimeDispatch":false,"planPublish":false},
                  "nodes":[
                    {"nodeKey":"scope","title":"Scope","objective":"Scope","scope":[],"acceptanceCriteria":["Scoped"],"priority":2,"requiredCapabilities":["READ_FILE"],"requiresHumanApproval":false,"dependsOn":[],"relationType":"INHERITED","previousNodeKey":"scope"}
                  ]
                }
                """.formatted(planId, patchContext.path("packageId").asText());
        UUID rejectedId = createPlanProposal(rejectionBody);
        mockMvc.perform(post(
                        "/internal/project-control/v1/projects/{projectId}/plans/proposals/{proposalId}/reject",
                        projectId, rejectedId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"范围不正确\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("REJECTED"));
        assertThat(count("SELECT count(*) FROM plan_version WHERE plan_id = ?", planId)).isOne();
    }

    @Test
    void closesReplayableWorkOrderEvidenceVerificationStateAndBrainLoop() throws Exception {
        JsonNode plannerContext = generateContext("PLANNER");
        UUID proposalId = createPlanProposal("""
                {
                  "schemaVersion":"1.0","name":"Execution loop","objective":"Close one verified loop",
                  "creationReason":"G7 integration","baseStateRevision":0,"basePlanVersion":null,
                  "contextPackageId":"%s","provider":"zhishu-grounded","model":"grounded-planner-v1",
                  "permissions":{"taskCreate":false,"runtimeDispatch":false,"planPublish":false},
                  "nodes":[
                    {"nodeKey":"execute","title":"Execute safely","objective":"Implement and verify",
                     "scope":[],"acceptanceCriteria":["Runtime evidence exists"],"priority":1,
                     "requiredCapabilities":["READ_FILE","WRITE_FILE","TEST"],
                     "requiresHumanApproval":false,"dependsOn":[]}
                  ]
                }
                """.formatted(plannerContext.path("packageId").asText()));
        String planResponse = mockMvc.perform(post(
                        "/internal/project-control/v1/projects/{projectId}/plans/proposals/{proposalId}/publish",
                        projectId, proposalId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"approvedNodeKeys\":[]}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        UUID planId = UUID.fromString(json.readTree(planResponse).path("planId").asText());
        int baselineTaskCount = count("SELECT count(*) FROM agent_task WHERE project_id = ?", projectId);

        String firstClaimBody = """
                {"clientRequestId":"claim-agent-only","planId":"%s","nodeKey":"execute",
                 "profileId":"%s","approvalMode":"MANUAL"}
                """.formatted(planId, profileId);
        String firstResponse = mockMvc.perform(post(
                        "/internal/project-control/v1/projects/{projectId}/work-orders/claims", projectId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON).content(firstClaimBody))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.replayed").value(false))
                .andReturn().getResponse().getContentAsString();
        JsonNode first = json.readTree(firstResponse);
        UUID firstWorkOrderId = UUID.fromString(first.path("workOrderId").asText());
        UUID firstTaskId = UUID.fromString(first.path("taskId").asText());
        UUID firstAttemptId = UUID.fromString(first.path("initialAttemptId").asText());
        assertThat(count("SELECT count(*) FROM agent_task WHERE project_id = ?", projectId))
                .isEqualTo(baselineTaskCount + 1);
        mockMvc.perform(post("/internal/project-control/v1/projects/{projectId}/work-orders/claims", projectId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON).content(firstClaimBody))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.replayed").value(true))
                .andExpect(jsonPath("$.taskId").value(firstTaskId.toString()));
        assertThat(count("SELECT count(*) FROM agent_task WHERE project_id = ?", projectId))
                .isEqualTo(baselineTaskCount + 1);
        ArgumentCaptor<RuntimeStartCommand> firstRuntime = ArgumentCaptor.forClass(RuntimeStartCommand.class);
        verify(runtimeClient, times(1)).start(firstRuntime.capture());
        assertThat(firstRuntime.getValue().context()).containsKey("workOrderContext");
        assertThat(firstRuntime.getValue().context().get("workOrderContext"))
                .asInstanceOf(org.assertj.core.api.InstanceOfAssertFactories.MAP)
                .containsEntry("workOrderId", firstWorkOrderId);

        eventIngestion.ingest(new RuntimeEventBatch("1.0", List.of(
                workOrderEvent(firstTaskId, firstAttemptId, "agent-start", 1,
                        RuntimeEventType.RUN_STARTED, Map.of()),
                workOrderEvent(firstTaskId, firstAttemptId, "agent-summary", 2,
                        RuntimeEventType.ARTIFACT_PUBLISHED, Map.of(
                                "artifactId", UUID.randomUUID().toString(), "artifactType", "SUMMARY",
                                "producer", "NODE_RUNTIME", "contentPlain", "All tests passed",
                                "hash", "agent-claim-hash", "metadata", Map.of())),
                workOrderEvent(firstTaskId, firstAttemptId, "agent-complete", 3,
                        RuntimeEventType.RUN_COMPLETED, Map.of())
        )));
        assertThat(jdbc.queryForObject(
                "SELECT state FROM plan_execution_state WHERE plan_id = ? AND node_key = 'execute'",
                String.class, planId)).isEqualTo("VERIFYING");
        UUID firstReportId = jdbc.queryForObject(
                "SELECT id FROM execution_report WHERE work_order_id = ?", UUID.class, firstWorkOrderId);
        mockMvc.perform(post(
                        "/internal/project-control/v1/projects/{projectId}/work-orders/{workOrderId}/verifications",
                        projectId, firstWorkOrderId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reportId\":\"" + firstReportId
                                + "\",\"decision\":\"PASSED\",\"reason\":\"looks good\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("PROJECT_STATE_CONFLICT"));
        assertThat(count("SELECT count(*) FROM project_state_entry WHERE source_type = 'EXECUTION_REPORT'"))
                .isZero();
        mockMvc.perform(post(
                        "/internal/project-control/v1/projects/{projectId}/work-orders/{workOrderId}/verifications",
                        projectId, firstWorkOrderId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reportId\":\"" + firstReportId
                                + "\",\"decision\":\"FAILED\",\"reason\":\"No system evidence\"}"))
                .andExpect(status().isCreated());

        String secondClaim = mockMvc.perform(post(
                        "/internal/project-control/v1/projects/{projectId}/work-orders/claims", projectId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"clientRequestId":"claim-with-evidence","planId":"%s","nodeKey":"execute",
                                 "profileId":"%s","approvalMode":"MANUAL"}
                                """.formatted(planId, profileId)))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        JsonNode second = json.readTree(secondClaim);
        UUID secondWorkOrderId = UUID.fromString(second.path("workOrderId").asText());
        UUID secondTaskId = UUID.fromString(second.path("taskId").asText());
        UUID secondAttemptId = UUID.fromString(second.path("initialAttemptId").asText());
        UUID testArtifactId = UUID.randomUUID();
        eventIngestion.ingest(new RuntimeEventBatch("1.0", List.of(
                workOrderEvent(secondTaskId, secondAttemptId, "system-start", 1,
                        RuntimeEventType.RUN_STARTED, Map.of()),
                workOrderEvent(secondTaskId, secondAttemptId, "test-evidence", 2,
                        RuntimeEventType.ARTIFACT_PUBLISHED, Map.of(
                                "artifactId", testArtifactId.toString(), "artifactType", "TEST_REPORT",
                                "producer", "NODE_RUNTIME", "contentPlain", "13 tests passed",
                                "hash", "system-test-hash",
                                "metadata", Map.of("command", "mvn test", "isError", false))),
                workOrderEvent(secondTaskId, secondAttemptId, "system-complete", 3,
                        RuntimeEventType.RUN_COMPLETED, Map.of())
        )));
        UUID secondReportId = jdbc.queryForObject(
                "SELECT id FROM execution_report WHERE work_order_id = ?", UUID.class, secondWorkOrderId);
        String verificationResponse = mockMvc.perform(post(
                        "/internal/project-control/v1/projects/{projectId}/work-orders/{workOrderId}/verifications",
                        projectId, secondWorkOrderId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reportId\":\"" + secondReportId
                                + "\",\"decision\":\"PASSED\",\"reason\":\"Evidence reviewed\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.workOrder.status").value("VERIFIED"))
                .andExpect(jsonPath("$.brainHandoff.context.version.stateRevision").value(1))
                .andReturn().getResponse().getContentAsString();
        JsonNode verification = json.readTree(verificationResponse);
        assertThat(jdbc.queryForObject(
                "SELECT state FROM plan_execution_state WHERE plan_id = ? AND node_key = 'execute'",
                String.class, planId)).isEqualTo("COMPLETED");
        assertThat(count("SELECT count(*) FROM work_order WHERE plan_id = ? AND node_key = 'execute'", planId))
                .isEqualTo(2);
        assertThat(jdbc.queryForObject("""
                SELECT authority_level FROM project_state_entry
                WHERE source_type = 'EXECUTION_REPORT' AND source_id = ?
                """, String.class, secondReportId.toString())).isEqualTo("SYSTEM_VERIFIED");
        assertThat(count("""
                SELECT count(*) FROM project_state_entry_evidence se
                JOIN evidence_reference er ON er.id = se.evidence_reference_id
                WHERE er.artifact_id = ?
                """, testArtifactId)).isOne();

        JsonNode handoff = verification.path("brainHandoff");
        com.fasterxml.jackson.databind.node.ObjectNode brainRequest = json.createObjectNode();
        brainRequest.put("verificationId", verification.path("verificationId").asText());
        brainRequest.put("threadId", handoff.path("threadId").asText());
        brainRequest.put("contextPackageId", handoff.path("context").path("packageId").asText());
        brainRequest.put("provider", "zhishu-grounded");
        brainRequest.put("model", "grounded-context-v1");
        brainRequest.set("permissions", json.createObjectNode().put("stateWrite", false));
        brainRequest.set("compositeContextVersion", handoff.path("context").path("version"));
        brainRequest.put("inputTokens", 10);
        brainRequest.put("outputTokens", 10);
        brainRequest.put("userMessage", handoff.path("question").asText());
        brainRequest.put("brainMessage", "Verified. The Plan has no remaining ready node.");
        brainRequest.set("citations", json.createArrayNode());
        String brainBody = brainRequest.toString();
        for (int replay = 0; replay < 2; replay++) {
            mockMvc.perform(post(
                            "/internal/project-control/v1/projects/{projectId}/work-orders/{workOrderId}/brain-handoff",
                            projectId, secondWorkOrderId)
                            .header("Authorization", "Bearer integration-project-control-token")
                            .header("X-Zhishu-Actor", "user:integration")
                            .contentType(MediaType.APPLICATION_JSON).content(brainBody))
                    .andExpect(status().isCreated());
        }
        assertThat(count("SELECT count(*) FROM brain_run WHERE trigger_type = 'EXECUTION_VERIFICATION'"
                + " AND trigger_id = ?", UUID.fromString(verification.path("verificationId").asText()))).isOne();
    }

    @Test
    void recoversPostCommitWorkOrderDispatchWithTheSameRuntimeIdempotencyKey() throws Exception {
        UUID planId = publishSingleNodePlan("dispatch-recovery", "recover", List.of("READ_FILE"));
        List<RuntimeStartCommand> starts = new ArrayList<>();
        when(runtimeClient.start(any())).thenAnswer(invocation -> {
            RuntimeStartCommand command = invocation.getArgument(0);
            starts.add(command);
            if (starts.size() == 1) throw new AssertionError("simulated process interruption");
            return new RuntimeAccepted("recovered-runtime-run", true);
        });
        WorkOrderService.ClaimCommand claim = new WorkOrderService.ClaimCommand(
                "dispatch-recovery-request", planId, "recover", profileId, ApprovalMode.MANUAL
        );

        assertThatThrownBy(() -> workOrders.claimAndDispatch(projectId, "user:integration", claim))
                .isInstanceOf(AssertionError.class)
                .hasMessageContaining("simulated process interruption");

        UUID workOrderId = jdbc.queryForObject("""
                SELECT id FROM work_order WHERE project_id = ? AND client_request_id = ?
                """, UUID.class, projectId, "dispatch-recovery-request");
        UUID recoveredTaskId = jdbc.queryForObject("""
                SELECT task_id FROM work_order_execution_binding WHERE work_order_id = ?
                """, UUID.class, workOrderId);
        UUID recoveredAttemptId = jdbc.queryForObject("""
                SELECT current_attempt_id FROM agent_task WHERE id = ?
                """, UUID.class, recoveredTaskId);
        assertThat(jdbc.queryForObject(
                "SELECT status FROM task_attempt WHERE id = ?", String.class, recoveredAttemptId
        )).isEqualTo("PENDING");
        assertThat(jdbc.queryForObject(
                "SELECT status FROM work_order_execution WHERE work_order_id = ?", String.class, workOrderId
        )).isEqualTo("DISPATCHING");

        Map<String, Object> replay = workOrders.claimAndDispatch(projectId, "user:integration", claim);

        assertThat(replay).containsEntry("replayed", true)
                .containsEntry("workOrderId", workOrderId)
                .containsEntry("taskId", recoveredTaskId)
                .containsEntry("initialAttemptId", recoveredAttemptId);
        assertThat(starts).hasSize(2);
        assertThat(starts.get(0).idempotencyKey()).isEqualTo(recoveredAttemptId + ":start");
        assertThat(starts.get(1).idempotencyKey()).isEqualTo(starts.get(0).idempotencyKey());
        assertThat(count("SELECT count(*) FROM task_attempt WHERE task_id = ?", recoveredTaskId)).isOne();
        assertThat(jdbc.queryForObject("""
                SELECT dispatch_attempts FROM work_order_execution WHERE work_order_id = ?
                """, Integer.class, workOrderId)).isEqualTo(2);
    }

    @Test
    void rejectsSelectedProfileCapabilityMismatchAndRollsBackTheClaim() throws Exception {
        UUID capableProfileId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO agent_profile (
                    id, project_id, name, executor, capabilities, permission_policy, timeout_seconds
                ) VALUES (?, ?, ?, 'claude', '["GIT"]'::jsonb, '{"requireApprovalFor":[]}'::jsonb, 600)
                """, capableProfileId, projectId, "Git-capable Profile");
        UUID planId = publishSingleNodePlan("profile-mismatch", "git-node", List.of("GIT"));
        int taskCount = count("SELECT count(*) FROM agent_task WHERE project_id = ?", projectId);

        assertThatThrownBy(() -> workOrders.claimAndDispatch(
                projectId,
                "user:integration",
                new WorkOrderService.ClaimCommand(
                        "profile-mismatch-request", planId, "git-node", profileId, ApprovalMode.MANUAL
                )
        )).isInstanceOf(ProjectStateConflictException.class)
                .hasMessageContaining("Selected Profile does not provide required capabilities: GIT");

        assertThat(count("SELECT count(*) FROM work_order WHERE client_request_id = ?",
                "profile-mismatch-request")).isZero();
        assertThat(count("SELECT count(*) FROM agent_task WHERE project_id = ?", projectId)).isEqualTo(taskCount);
        assertThat(jdbc.queryForObject("""
                SELECT state FROM plan_execution_state WHERE plan_id = ? AND node_key = 'git-node'
                """, String.class, planId)).isEqualTo("READY");
    }

    @Test
    void preservesWorkOrderContextWhenRetryingTheCurrentFailedExecution() throws Exception {
        UUID planId = publishSingleNodePlan("retry-context", "retry-node", List.of("READ_FILE"));
        Map<String, Object> claimed = workOrders.claimAndDispatch(
                projectId,
                "user:integration",
                new WorkOrderService.ClaimCommand(
                        "retry-context-request", planId, "retry-node", profileId, ApprovalMode.MANUAL
                )
        );
        UUID workOrderId = UUID.fromString(claimed.get("workOrderId").toString());
        UUID workOrderTaskId = UUID.fromString(claimed.get("taskId").toString());
        UUID originalAttemptId = UUID.fromString(claimed.get("initialAttemptId").toString());
        failWorkOrderExecution(workOrderId, workOrderTaskId, originalAttemptId, planId, "retry-node");
        reset(runtimeClient);
        when(runtimeClient.start(any())).thenReturn(new RuntimeAccepted("work-order-retry-run", true));

        mockMvc.perform(post("/api/v1/tasks/{taskId}/retry", workOrderTaskId))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.attemptNumber").value(2))
                .andExpect(jsonPath("$.attemptStatus").value("STARTING"));

        ArgumentCaptor<RuntimeStartCommand> retry = ArgumentCaptor.forClass(RuntimeStartCommand.class);
        verify(runtimeClient, times(1)).start(retry.capture());
        assertThat(retry.getValue().context()).containsEntry(
                "retryOfAttemptId", originalAttemptId.toString()
        ).containsKey("workOrderContext");
        assertThat(retry.getValue().context().get("workOrderContext"))
                .asInstanceOf(org.assertj.core.api.InstanceOfAssertFactories.MAP)
                .containsEntry("workOrderId", workOrderId)
                .containsEntry("planId", planId)
                .containsEntry("nodeKey", "retry-node");
        assertThat(jdbc.queryForObject("""
                SELECT status FROM work_order_execution WHERE work_order_id = ?
                """, String.class, workOrderId)).isEqualTo("DISPATCHED");
        assertThat(jdbc.queryForObject("""
                SELECT state FROM plan_execution_state WHERE plan_id = ? AND node_key = 'retry-node'
                """, String.class, planId)).isEqualTo("DISPATCHING");
    }

    @Test
    void rejectsRetryAfterHumanRejectionWithoutChangingPlanState() throws Exception {
        UUID planId = publishSingleNodePlan("rejected-retry", "rejected-node", List.of("READ_FILE"));
        Map<String, Object> claimed = workOrders.claimAndDispatch(
                projectId,
                "user:integration",
                new WorkOrderService.ClaimCommand(
                        "rejected-retry-request", planId, "rejected-node", profileId, ApprovalMode.MANUAL
                )
        );
        UUID workOrderId = UUID.fromString(claimed.get("workOrderId").toString());
        UUID workOrderTaskId = UUID.fromString(claimed.get("taskId").toString());
        UUID originalAttemptId = UUID.fromString(claimed.get("initialAttemptId").toString());
        failWorkOrderExecution(workOrderId, workOrderTaskId, originalAttemptId, planId, "rejected-node");
        jdbc.update("""
                UPDATE work_order_execution SET status = 'REJECTED', status_reason = 'Human rejected'
                WHERE work_order_id = ?
                """, workOrderId);

        mockMvc.perform(post("/api/v1/tasks/{taskId}/retry", workOrderTaskId))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("PROJECT_STATE_CONFLICT"));

        assertThat(count("SELECT count(*) FROM task_attempt WHERE task_id = ?", workOrderTaskId)).isOne();
        assertThat(jdbc.queryForObject(
                "SELECT status FROM agent_task WHERE id = ?", String.class, workOrderTaskId
        )).isEqualTo("FAILED");
        assertThat(jdbc.queryForObject("""
                SELECT state FROM plan_execution_state WHERE plan_id = ? AND node_key = 'rejected-node'
                """, String.class, planId)).isEqualTo("FAILED");
    }

    @Test
    void rejectsRetryOfAnOlderWorkOrderWhenANewerOneExists() throws Exception {
        UUID planId = publishSingleNodePlan("historical-retry", "history-node", List.of("READ_FILE"));
        Map<String, Object> first = workOrders.claimAndDispatch(
                projectId,
                "user:integration",
                new WorkOrderService.ClaimCommand(
                        "historical-retry-first", planId, "history-node", profileId, ApprovalMode.MANUAL
                )
        );
        UUID firstWorkOrderId = UUID.fromString(first.get("workOrderId").toString());
        UUID firstTaskId = UUID.fromString(first.get("taskId").toString());
        UUID firstAttemptId = UUID.fromString(first.get("initialAttemptId").toString());
        failWorkOrderExecution(firstWorkOrderId, firstTaskId, firstAttemptId, planId, "history-node");

        Map<String, Object> second = workOrders.claimAndDispatch(
                projectId,
                "user:integration",
                new WorkOrderService.ClaimCommand(
                        "historical-retry-second", planId, "history-node", profileId, ApprovalMode.MANUAL
                )
        );
        failWorkOrderExecution(
                UUID.fromString(second.get("workOrderId").toString()),
                UUID.fromString(second.get("taskId").toString()),
                UUID.fromString(second.get("initialAttemptId").toString()),
                planId,
                "history-node"
        );

        mockMvc.perform(post("/api/v1/tasks/{taskId}/retry", firstTaskId))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("PROJECT_STATE_CONFLICT"));
        assertThat(count("SELECT count(*) FROM task_attempt WHERE task_id = ?", firstTaskId)).isOne();
        assertThat(jdbc.queryForObject("""
                SELECT state FROM plan_execution_state WHERE plan_id = ? AND node_key = 'history-node'
                """, String.class, planId)).isEqualTo("FAILED");
    }

    @Test
    void recordsNoToolBrainRunWithoutChangingAuthoritativeState() throws Exception {
        String contextResponse = mockMvc.perform(post(
                        "/internal/project-control/v1/projects/{projectId}/contexts", projectId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"packageType\":\"BRAIN\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.version.stateRevision").value(0))
                .andReturn().getResponse().getContentAsString();
        JsonNode context = json.readTree(contextResponse);
        UUID packageId = UUID.fromString(context.path("packageId").asText());
        String threadResponse = mockMvc.perform(post(
                        "/internal/project-control/v1/projects/{projectId}/brain/threads", projectId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"当前项目状态\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        UUID threadId = UUID.fromString(json.readTree(threadResponse).path("threadId").asText());
        String runBody = """
                {
                  "contextPackageId": "%s",
                  "provider": "zhishu-grounded",
                  "model": "grounded-context-v1",
                  "permissions": {
                    "shell": false,
                    "filesystemRead": false,
                    "filesystemWrite": false,
                    "runtimeDispatch": false,
                    "stateWrite": false,
                    "planPublish": false
                  },
                  "compositeContextVersion": %s,
                  "inputTokens": 32,
                  "outputTokens": 16,
                  "userMessage": "当前做到哪？",
                  "brainMessage": "当前状态来自 State Revision 0。",
                  "citations": [],
                  "generatedProposal": {
                    "schemaVersion": "1.0",
                    "proposalType": "DiscoveryProposalV1",
                    "status": "DRAFT"
                  }
                }
                """.formatted(packageId, context.path("version"));
        mockMvc.perform(post(
                        "/internal/project-control/v1/projects/{projectId}/brain/threads/{threadId}/runs",
                        projectId, threadId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(runBody))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.roleVersion").value("project-brain:v1"))
                .andExpect(jsonPath("$.contextPackageId").value(packageId.toString()))
                .andExpect(jsonPath("$.generatedProposal.status").value("DRAFT"));
        mockMvc.perform(get(
                        "/internal/project-control/v1/projects/{projectId}/brain/threads/{threadId}/messages",
                        projectId, threadId)
                        .header("Authorization", "Bearer integration-project-control-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[1].role").value("BRAIN"))
                .andExpect(jsonPath("$[1].contextPackageId").value(packageId.toString()));
        assertThat(jdbc.queryForObject(
                "SELECT state_revision FROM project_state_snapshot WHERE project_id = ?", Long.class, projectId
        )).isZero();
        assertThat(jdbc.queryForObject(
                "SELECT permissions ->> 'shell' FROM brain_run WHERE thread_id = ?", String.class, threadId
        )).isEqualTo("false");
    }

    @Test
    void appliesInitialProjectStateIdempotentlyAndKeepsRuntimeWatermarkSeparate() throws Exception {
        UUID artifactId = UUID.randomUUID();
        UUID evidenceId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO task_artifact (
                    id, task_id, attempt_id, artifact_type, producer, content_plain, metadata
                ) VALUES (?, ?, ?, 'SUMMARY', 'NODE_RUNTIME', 'State evidence', '{}'::jsonb)
                """, artifactId, taskId, attemptId);
        jdbc.update("""
                INSERT INTO evidence_reference (
                    id, project_id, artifact_id, source_type, source_id, purpose, created_by
                ) VALUES (?, ?, ?, 'STATE_PROPOSAL', ?, 'Decision evidence', 'user:integration')
                """, evidenceId, projectId, artifactId, UUID.randomUUID());

        mockMvc.perform(get("/internal/project-control/v1/projects/{projectId}/state", projectId)
                        .header("Authorization", "Bearer integration-project-control-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.stateRevision").value(0))
                .andExpect(jsonPath("$.entries.length()").value(0));

        String proposalBody = """
                {
                  "goal": "交付可信项目状态",
                  "stage": "阶段 3",
                  "summary": "Project State V1 正在建设",
                  "blocker": "等待 G3 验收",
                  "decisions": [{
                    "title": "以 PostgreSQL 为权威状态源",
                    "content": "Project State 不从聊天历史推断",
                    "rationale": "保持可追溯",
                    "evidenceReferenceIds": ["%s"]
                  }],
                  "constraints": [{
                    "title": "保持执行事实唯一",
                    "content": "不创建第二套 Task/Attempt",
                    "evidenceReferenceIds": []
                  }],
                  "risks": []
                }
                """.formatted(evidenceId);
        String proposalResponse = mockMvc.perform(post(
                        "/internal/project-control/v1/projects/{projectId}/state/initial-proposals", projectId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(proposalBody))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("PENDING_APPROVAL"))
                .andReturn().getResponse().getContentAsString();
        UUID proposalId = UUID.fromString(json.readTree(proposalResponse).path("proposalId").asText());
        String confirmation = "{\"clientRequestId\":\"initial-state-request-1\"}";

        for (int replay = 0; replay < 2; replay++) {
            mockMvc.perform(post(
                            "/internal/project-control/v1/projects/{projectId}/state/proposals/{proposalId}/confirm",
                            projectId, proposalId)
                            .header("Authorization", "Bearer integration-project-control-token")
                            .header("X-Zhishu-Actor", "user:integration")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(confirmation))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.beforeRevision").value(0))
                    .andExpect(jsonPath("$.afterRevision").value(1));
        }

        assertThat(count("SELECT count(*) FROM project_change_log WHERE project_id = ?", projectId)).isOne();
        assertThat(count("SELECT count(*) FROM project_state_entry WHERE project_id = ?", projectId)).isEqualTo(4);
        assertThat(count("SELECT count(*) FROM project_state_entry_evidence WHERE evidence_reference_id = ?", evidenceId))
                .isOne();
        mockMvc.perform(get("/internal/project-control/v1/projects/{projectId}/state", projectId)
                        .header("Authorization", "Bearer integration-project-control-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.stateRevision").value(1))
                .andExpect(jsonPath("$.goal.authorityLevel").value("USER_CONFIRMED"))
                .andExpect(jsonPath("$.entries[?(@.entryType == 'DECISION')].createdBy").value("user:integration"));

        jdbc.update("""
                INSERT INTO task_event (
                    event_id, task_id, attempt_id, runtime_run_id, sequence_no,
                    event_type, payload, occurred_at, projected_at
                ) VALUES (?, ?, ?, ?, 1, 'TOOL_STARTED', '{}'::jsonb, now(), now())
                """, "state-watermark-" + taskId, taskId, attemptId, RUNTIME_RUN_ID);
        mockMvc.perform(get("/internal/project-control/v1/projects/{projectId}/state", projectId)
                        .header("Authorization", "Bearer integration-project-control-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.stateRevision").value(1));

        String contextResponse = mockMvc.perform(post(
                        "/internal/project-control/v1/projects/{projectId}/contexts", projectId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"packageType\":\"BRAIN\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.version.stateRevision").value(1))
                .andExpect(jsonPath("$.version.executionWatermark").isNumber())
                .andExpect(jsonPath("$.derivedSystemFacts[0].authorityLevel").value("SYSTEM_VERIFIED"))
                .andReturn().getResponse().getContentAsString();
        JsonNode context = json.readTree(contextResponse);
        UUID packageId = UUID.fromString(context.path("packageId").asText());
        mockMvc.perform(get("/internal/project-control/v1/projects/{projectId}/contexts/{packageId}",
                        projectId, packageId)
                        .header("Authorization", "Bearer integration-project-control-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.packageId").value(packageId.toString()))
                .andExpect(jsonPath("$.version.stateRevision").value(1));
    }

    @Test
    void stateStewardDerivesVerifiedReportAndAppliesOnlyNewCandidates() throws Exception {
        UUID planId = publishSingleNodePlan("State Steward", "discover", List.of("READ_FILE"));
        String claimResponse = mockMvc.perform(post(
                        "/internal/project-control/v1/projects/{projectId}/work-orders/claims", projectId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"clientRequestId":"steward-claim","planId":"%s","nodeKey":"discover",
                                 "profileId":"%s","approvalMode":"MANUAL"}
                                """.formatted(planId, profileId)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        JsonNode claim = json.readTree(claimResponse);
        UUID workOrderId = UUID.fromString(claim.path("workOrderId").asText());
        UUID reportTaskId = UUID.fromString(claim.path("taskId").asText());
        UUID reportAttemptId = UUID.fromString(claim.path("initialAttemptId").asText());
        UUID reportId = UUID.randomUUID();
        UUID summaryArtifactId = UUID.randomUUID();
        UUID testArtifactId = UUID.randomUUID();
        String candidateMetadata = """
                {
                  "stateCandidates":[
                    {"entryType":"DISCOVERY","title":"Cache","content":"Redis is used",
                     "rationale":"Observed in the verified execution summary"},
                    {"entryType":"DECISION","title":"Database","content":"PostgreSQL",
                     "rationale":"Matches the established project decision"},
                    {"entryType":"FACT","title":"Forbidden","content":"Must not be inferred"}
                  ]
                }
                """;
        jdbc.update("""
                INSERT INTO task_artifact (
                    id, task_id, attempt_id, artifact_type, producer, content_plain, metadata
                ) VALUES (?, ?, ?, 'SUMMARY', 'NODE_RUNTIME', 'Redis is used', CAST(? AS jsonb))
                """, summaryArtifactId, reportTaskId, reportAttemptId, candidateMetadata);
        jdbc.update("""
                INSERT INTO task_artifact (
                    id, task_id, attempt_id, artifact_type, producer, content_plain, metadata
                ) VALUES (?, ?, ?, 'TEST_REPORT', 'NODE_RUNTIME', 'All tests passed', '{}'::jsonb)
                """, testArtifactId, reportTaskId, reportAttemptId);
        String agentClaims = """
                [{
                  "artifactId":"%s","artifactType":"SUMMARY","producer":"NODE_RUNTIME",
                  "content":"Redis is used","metadata":%s
                }]
                """.formatted(summaryArtifactId, candidateMetadata);
        String systemEvidence = """
                [{
                  "artifactId":"%s","artifactType":"TEST_REPORT","producer":"NODE_RUNTIME",
                  "content":"All tests passed","metadata":{"command":"mvn test"}
                }]
                """.formatted(testArtifactId);
        jdbc.update("""
                INSERT INTO execution_report (
                    id, work_order_id, task_id, attempt_id, attempt_status, agent_claims, system_evidence
                ) VALUES (?, ?, ?, ?, 'SUCCEEDED', CAST(? AS jsonb), CAST(? AS jsonb))
                """, reportId, workOrderId, reportTaskId, reportAttemptId, agentClaims, systemEvidence);

        UUID existingDecisionId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO project_state_entry (
                    id, project_id, entry_type, title, content, authority_level,
                    source_type, source_id, created_by, status, created_revision
                ) VALUES (?, ?, 'DECISION', 'Database', 'PostgreSQL', 'USER_CONFIRMED',
                          'INTEGRATION_TEST', ?, 'user:integration', 'ACTIVE', 1)
                """, existingDecisionId, projectId, existingDecisionId.toString());
        jdbc.update("""
                INSERT INTO project_state_snapshot (project_id, state_revision)
                VALUES (?, 1)
                ON CONFLICT (project_id) DO UPDATE SET state_revision = 1, updated_at = now()
                """, projectId);

        mockMvc.perform(post(
                        "/internal/project-control/v1/projects/{projectId}/state/steward/reports/{reportId}/proposal",
                        projectId, reportId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("PROJECT_STATE_CONFLICT"));
        assertThat(count("""
                SELECT count(*) FROM evidence_reference
                WHERE source_type = 'EXECUTION_REPORT' AND source_id = ?
                """, reportId)).isZero();

        jdbc.update("""
                INSERT INTO execution_verification (
                    id, report_id, decision, reason, verified_by, system_evidence_count
                ) VALUES (?, ?, 'PASSED', 'Evidence reviewed', 'user:integration', 1)
                """, UUID.randomUUID(), reportId);

        String firstResponse = mockMvc.perform(post(
                        "/internal/project-control/v1/projects/{projectId}/state/steward/reports/{reportId}/proposal",
                        projectId, reportId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.proposalType").value("STATE_CHANGE"))
                .andExpect(jsonPath("$.status").value("PENDING_APPROVAL"))
                .andExpect(jsonPath("$.payload.permissions.stateWrite").value(false))
                .andExpect(jsonPath("$.payload.permissions.factWrite").value(false))
                .andExpect(jsonPath("$.payload.summary.extracted").value(2))
                .andExpect(jsonPath("$.payload.summary.newCandidates").value(1))
                .andExpect(jsonPath("$.payload.summary.staleCandidates").value(1))
                .andExpect(jsonPath("$.payload.summary.mergedCandidates").value(0))
                .andReturn().getResponse().getContentAsString();
        UUID proposalId = UUID.fromString(json.readTree(firstResponse).path("proposalId").asText());
        assertThat(count("""
                SELECT count(*) FROM evidence_reference
                WHERE project_id = ? AND artifact_id = ? AND source_type = 'EXECUTION_REPORT'
                  AND source_id = ? AND purpose = 'STATE_STEWARD_CANDIDATE'
                """, projectId, summaryArtifactId, reportId)).isOne();

        mockMvc.perform(post(
                        "/internal/project-control/v1/projects/{projectId}/state/steward/reports/{reportId}/proposal",
                        projectId, reportId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.proposalId").value(proposalId.toString()));
        mockMvc.perform(post(
                        "/internal/project-control/v1/projects/{projectId}/state/proposals/{proposalId}/confirm",
                        projectId, proposalId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"clientRequestId\":\"confirm-steward-1\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.changeType").value("STATE_CHANGE_APPLIED"))
                .andExpect(jsonPath("$.beforeRevision").value(1))
                .andExpect(jsonPath("$.afterRevision").value(2))
                .andExpect(jsonPath("$.payload.appliedCount").value(1))
                .andExpect(jsonPath("$.payload.skippedCount").value(1));
        mockMvc.perform(post(
                        "/internal/project-control/v1/projects/{projectId}/state/steward/reports/{reportId}/proposal",
                        projectId, reportId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.proposalId").value(proposalId.toString()))
                .andExpect(jsonPath("$.status").value("APPLIED"));
        mockMvc.perform(get(
                        "/internal/project-control/v1/projects/{projectId}/state/proposals", projectId)
                        .queryParam("proposalType", "STATE_CHANGE")
                        .header("Authorization", "Bearer integration-project-control-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].proposalId").value(proposalId.toString()))
                .andExpect(jsonPath("$[0].status").value("APPLIED"))
                .andExpect(jsonPath("$[0].decidedBy").value("user:integration"))
                .andExpect(jsonPath("$[0].appliedRevision").value(2))
                .andExpect(jsonPath("$[0].payload.candidates[0].disposition").value("NEW"))
                .andExpect(jsonPath("$[0].payload.candidates[1].disposition").value("STALE"));
        assertThat(count("""
                SELECT count(*) FROM project_state_proposal
                WHERE project_id = ? AND source_type = 'EXECUTION_REPORT' AND source_id = ?
                """, projectId, reportId.toString())).isOne();
        assertThat(count("""
                SELECT count(*) FROM project_state_entry
                WHERE project_id = ? AND source_type = 'STATE_PROPOSAL' AND source_id = ?
                """, projectId, proposalId.toString())).isOne();
        assertThat(count("""
                SELECT count(*) FROM project_state_entry_evidence see
                JOIN project_state_entry se ON se.id = see.entry_id
                JOIN evidence_reference er ON er.id = see.evidence_reference_id
                WHERE se.project_id = ? AND se.source_id = ? AND er.artifact_id = ?
                """, projectId, proposalId.toString(), summaryArtifactId)).isOne();
        assertThat(jdbc.queryForObject(
                "SELECT state_revision FROM project_state_snapshot WHERE project_id = ?",
                Long.class, projectId
        )).isEqualTo(2L);
    }

    @Test
    void parallelScheduleReservesTwoIsolatedWorkersWithoutDispatchingWorkOrders() throws Exception {
        JsonNode context = generateContext("PLANNER");
        UUID proposalId = createPlanProposal("""
                {
                  "schemaVersion":"1.0","name":"Parallel safety","objective":"Validate isolated scheduling",
                  "creationReason":"Stage 10.1A integration","baseStateRevision":0,"basePlanVersion":null,
                  "contextPackageId":"%s","provider":"zhishu-grounded","model":"grounded-planner-v1",
                  "permissions":{"taskCreate":false,"runtimeDispatch":false,"planPublish":false},
                  "nodes":[
                    {"nodeKey":"alpha","title":"Alpha","objective":"Change alpha",
                     "scope":["src/alpha"],"acceptanceCriteria":["Alpha passes"],"priority":4,
                     "requiredCapabilities":["READ_FILE"],"requiresHumanApproval":false,"dependsOn":[]},
                    {"nodeKey":"beta","title":"Beta","objective":"Change beta",
                     "scope":["src/beta"],"acceptanceCriteria":["Beta passes"],"priority":3,
                     "requiredCapabilities":["READ_FILE"],"requiresHumanApproval":false,"dependsOn":[]},
                    {"nodeKey":"shared-a","title":"Shared A","objective":"Change shared A",
                     "scope":["src/shared"],"acceptanceCriteria":["Shared A passes"],"priority":2,
                     "requiredCapabilities":["READ_FILE"],"requiresHumanApproval":false,"dependsOn":[]},
                    {"nodeKey":"shared-b","title":"Shared B","objective":"Change shared B",
                     "scope":["src/shared/feature"],"acceptanceCriteria":["Shared B passes"],"priority":1,
                     "requiredCapabilities":["READ_FILE"],"requiresHumanApproval":false,"dependsOn":[]}
                  ]
                }
                """.formatted(context.path("packageId").asText()));
        String planResponse = mockMvc.perform(post(
                        "/internal/project-control/v1/projects/{projectId}/plans/proposals/{proposalId}/publish",
                        projectId, proposalId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"approvedNodeKeys\":[]}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        UUID planId = UUID.fromString(json.readTree(planResponse).path("planId").asText());
        mockMvc.perform(get(
                        "/internal/project-control/v1/projects/{projectId}/plans/{planId}/capability-matrix",
                        projectId, planId)
                        .header("Authorization", "Bearer integration-project-control-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.schemaVersion").value("1.0"))
                .andExpect(jsonPath("$.basePlanVersion").value(1))
                .andExpect(jsonPath("$.baseStateRevision").value(0))
                .andExpect(jsonPath("$.summary.nodeCount").value(4))
                .andExpect(jsonPath("$.summary.schedulableNodeCount").value(4))
                .andExpect(jsonPath("$.nodes[0].nodeKey").value("alpha"))
                .andExpect(jsonPath("$.nodes[0].schedulable").value(true))
                .andExpect(jsonPath("$.nodes[0].eligibleProfileCount").value(1))
                .andExpect(jsonPath("$.nodes[0].profileMatches[0].eligible").value(true));
        mockMvc.perform(get(
                        "/internal/project-control/v1/projects/{projectId}/plans/{planId}"
                                + "/parallel-schedule-candidates",
                        projectId, planId)
                        .header("Authorization", "Bearer integration-project-control-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.schemaVersion").value("1.0"))
                .andExpect(jsonPath("$.summary.nodeCount").value(4))
                .andExpect(jsonPath("$.summary.totalPairCount").value(6))
                .andExpect(jsonPath("$.summary.evaluatedPairCount").value(6))
                .andExpect(jsonPath("$.summary.eligiblePairCount").value(5))
                .andExpect(jsonPath("$.summary.blockedPairCount").value(1))
                .andExpect(jsonPath("$.summary.truncated").value(false))
                .andExpect(jsonPath("$.candidates[0].pairKey").value("alpha::beta"))
                .andExpect(jsonPath("$.candidates[0].dependencyAssessment").value("CLEAR"))
                .andExpect(jsonPath("$.candidates[0].scopeAssessment").value("DISJOINT"))
                .andExpect(jsonPath("$.candidates[0].eligible").value(true))
                .andExpect(jsonPath("$.candidates[0].leftNode.matchedProfile.profileName")
                        .value("Integration Profile"))
                .andExpect(jsonPath("$.candidates[5].pairKey").value("shared-a::shared-b"))
                .andExpect(jsonPath("$.candidates[5].scopeAssessment").value("OVERLAP"))
                .andExpect(jsonPath("$.candidates[5].scopeConflicts[0].leftScope").value("src/shared"))
                .andExpect(jsonPath("$.candidates[5].scopeConflicts[0].rightScope")
                        .value("src/shared/feature"))
                .andExpect(jsonPath("$.candidates[5].blockers[0]").value("SCOPE_OVERLAP"));
        String recommendationResponse = mockMvc.perform(get(
                        "/internal/project-control/v1/projects/{projectId}/plans/{planId}"
                                + "/parallel-schedule-recommendation",
                        projectId, planId)
                        .header("Authorization", "Bearer integration-project-control-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.recommendation.status").value("RECOMMENDED"))
                .andExpect(jsonPath("$.recommendation.pairKey").value("alpha::beta"))
                .andExpect(jsonPath("$.recommendation.rank").value(1))
                .andExpect(jsonPath("$.recommendation.score").value(1013700))
                .andExpect(jsonPath("$.recommendationFingerprint").isString())
                .andExpect(jsonPath("$.recommendationFingerprint").value(org.hamcrest.Matchers.hasLength(64)))
                .andExpect(jsonPath("$.determinism.stable").value(true))
                .andExpect(jsonPath("$.determinism.orderingRule")
                        .value("ELIGIBLE_DESC_SCORE_DESC_PAIR_KEY_ASC"))
                .andExpect(jsonPath("$.baseline.status").value("CURRENT_SNAPSHOT"))
                .andExpect(jsonPath("$.summary.rankedCandidateCount").value(6))
                .andExpect(jsonPath("$.rankedCandidates[0].pairKey").value("alpha::beta"))
                .andExpect(jsonPath("$.rankedCandidates[0].scoreBreakdown.planPriority").value(700))
                .andExpect(jsonPath("$.rankedCandidates[1].pairKey").value("alpha::shared-a"))
                .andExpect(jsonPath("$.rankedCandidates[5].eligible").value(false))
                .andReturn().getResponse().getContentAsString();
        String recommendationFingerprint = json.readTree(recommendationResponse)
                .path("recommendationFingerprint").asText();
        mockMvc.perform(get(
                        "/internal/project-control/v1/projects/{projectId}/plans/{planId}"
                                + "/parallel-schedule-recommendation",
                        projectId, planId)
                        .header("Authorization", "Bearer integration-project-control-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.recommendationFingerprint").value(recommendationFingerprint));
        String createBody = """
                {"clientRequestId":"parallel-create-1","baseStateRevision":0,
                 "basePlanVersion":1,"nodeKeys":["beta","alpha"]}
                """;

        String scheduleResponse = mockMvc.perform(post(
                        "/internal/project-control/v1/projects/{projectId}/plans/{planId}/parallel-schedules",
                        projectId, planId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("PENDING_APPROVAL"))
                .andExpect(jsonPath("$.maxWorkers").value(2))
                .andExpect(jsonPath("$.conflictAssessment.dependency").value("CLEAR"))
                .andExpect(jsonPath("$.conflictAssessment.scope").value("DISJOINT"))
                .andExpect(jsonPath("$.conflictAssessment.automaticMerge").value(false))
                .andExpect(jsonPath("$.assignments[0].nodeKey").value("alpha"))
                .andExpect(jsonPath("$.assignments[1].nodeKey").value("beta"))
                .andExpect(jsonPath("$.assignments[0].workspaceLease.workspaceMode")
                        .value("ISOLATED_WORKTREE"))
                .andReturn().getResponse().getContentAsString();
        JsonNode schedule = json.readTree(scheduleResponse);
        UUID scheduleId = UUID.fromString(schedule.path("scheduleId").asText());
        UUID unrelatedPlanId = UUID.randomUUID();
        assertThat(schedule.path("assignments").get(0).path("workspaceLease").path("workspaceRef").asText())
                .isNotEqualTo(schedule.path("assignments").get(1).path("workspaceLease").path("workspaceRef").asText());

        mockMvc.perform(get(
                        "/internal/project-control/v1/projects/{projectId}/plans/{planId}/capability-matrix",
                        projectId, planId)
                        .header("Authorization", "Bearer integration-project-control-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.summary.schedulableNodeCount").value(2))
                .andExpect(jsonPath("$.nodes[0].activeSchedule").value(true))
                .andExpect(jsonPath("$.nodes[0].schedulable").value(false))
                .andExpect(jsonPath("$.nodes[0].blockers[0]").value("ACTIVE_SCHEDULE_EXISTS"))
                .andExpect(jsonPath("$.nodes[1].activeSchedule").value(true));
        mockMvc.perform(get(
                        "/internal/project-control/v1/projects/{projectId}/plans/{planId}"
                                + "/parallel-schedule-candidates",
                        projectId, planId)
                        .header("Authorization", "Bearer integration-project-control-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.summary.eligiblePairCount").value(0))
                .andExpect(jsonPath("$.summary.blockedPairCount").value(6))
                .andExpect(jsonPath("$.candidates[0].activeScheduleConflict").value(true))
                .andExpect(jsonPath("$.candidates[0].eligible").value(false))
                .andExpect(jsonPath("$.candidates[0].blockers[0]").value("LEFT_NODE_BLOCKED"))
                .andExpect(jsonPath("$.candidates[0].blockers[1]").value("RIGHT_NODE_BLOCKED"));
        String blockedRecommendationResponse = mockMvc.perform(get(
                        "/internal/project-control/v1/projects/{projectId}/plans/{planId}"
                                + "/parallel-schedule-recommendation",
                        projectId, planId)
                        .header("Authorization", "Bearer integration-project-control-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.recommendation.status").value("NO_ELIGIBLE_CANDIDATE"))
                .andExpect(jsonPath("$.recommendation.pairKey").doesNotExist())
                .andExpect(jsonPath("$.summary.eligiblePairCount").value(0))
                .andExpect(jsonPath("$.rankedCandidates[0].pairKey").value("shared-a::shared-b"))
                .andExpect(jsonPath("$.rankedCandidates[0].eligible").value(false))
                .andReturn().getResponse().getContentAsString();
        assertThat(json.readTree(blockedRecommendationResponse).path("recommendationFingerprint").asText())
                .isNotEqualTo(recommendationFingerprint);

        mockMvc.perform(post(
                        "/internal/project-control/v1/projects/{projectId}/plans/{planId}/parallel-schedules",
                        projectId, planId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.scheduleId").value(scheduleId.toString()));

        mockMvc.perform(post(
                        "/internal/project-control/v1/projects/{projectId}/plans/{planId}/parallel-schedules",
                        projectId, planId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"clientRequestId":"parallel-conflict-1","baseStateRevision":0,
                                 "basePlanVersion":1,"nodeKeys":["shared-a","shared-b"]}
                                """))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("PROJECT_STATE_CONFLICT"));

        String decisionBody = "{\"clientRequestId\":\"parallel-confirm-1\"}";
        mockMvc.perform(post(
                        "/internal/project-control/v1/projects/{projectId}/plans/{planId}"
                                + "/parallel-schedules/{scheduleId}/confirm",
                        projectId, unrelatedPlanId, scheduleId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"clientRequestId\":\"parallel-wrong-plan-1\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("PROJECT_STATE_CONFLICT"));
        mockMvc.perform(post(
                        "/internal/project-control/v1/projects/{projectId}/plans/{planId}"
                                + "/parallel-schedules/{scheduleId}/reject",
                        projectId, unrelatedPlanId, scheduleId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"clientRequestId\":\"parallel-wrong-plan-reject-1\",\"reason\":\"Wrong Plan path\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("PROJECT_STATE_CONFLICT"));
        for (int replay = 0; replay < 2; replay++) {
            mockMvc.perform(post(
                            "/internal/project-control/v1/projects/{projectId}/plans/{planId}"
                                    + "/parallel-schedules/{scheduleId}/confirm",
                            projectId, planId, scheduleId)
                            .header("Authorization", "Bearer integration-project-control-token")
                            .header("X-Zhishu-Actor", "user:integration")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(decisionBody))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.status").value("APPROVED"))
                    .andExpect(jsonPath("$.assignments[0].status").value("READY_FOR_PROVISIONING"))
                    .andExpect(jsonPath("$.assignments[1].status").value("READY_FOR_PROVISIONING"))
                    .andExpect(jsonPath("$.assignments[0].workspaceLease.status").value("RESERVED"))
                    .andExpect(jsonPath("$.events.length()").value(2));
        }
        mockMvc.perform(post(
                        "/internal/project-control/v1/projects/{projectId}/plans/{planId}"
                                + "/parallel-schedules/{scheduleId}/confirm",
                        projectId, unrelatedPlanId, scheduleId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(decisionBody))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("PROJECT_STATE_CONFLICT"));

        UUID leaseId = UUID.fromString(schedule.path("assignments").get(0)
                .path("workspaceLease").path("leaseId").asText());
        UUID assignmentId = UUID.fromString(schedule.path("assignments").get(0)
                .path("assignmentId").asText());
        ParallelScheduleView provisioned = workspaceProvisioner.provision(
                projectId, scheduleId, leaseId, "user:integration", "workspace-provision-1"
        );
        String workspacePath = provisioned.assignments().get(0).workspaceLease().workspacePath();
        assertThat(provisioned.assignments().get(0).status()).isEqualTo("PROVISIONED");
        assertThat(provisioned.assignments().get(0).workspaceLease().physicalWorkspaceKind())
                .isEqualTo("DIRECTORY_ONLY");
        assertThat(provisioned.assignments().get(0).workspaceLease().provisioningState())
                .isEqualTo("PROVISIONED");
        assertThat(Files.exists(Path.of(workspacePath))).isTrue();
        assertThat(workspaceProvisioner.provision(
                projectId, scheduleId, leaseId, "user:integration", "workspace-provision-1"
        ).assignments().get(0).workspaceLease().workspacePath()).isEqualTo(workspacePath);

        jdbc.update("""
                UPDATE workspace_lease
                SET status = 'RESERVED', provisioning_state = 'PROVISIONING',
                    provisioning_started_at = now() - interval '10 minutes',
                    provisioned_at = NULL, lease_expires_at = now() + interval '10 minutes'
                WHERE id = ?
                """, leaseId);
        jdbc.update("UPDATE parallel_schedule_assignment SET status = 'READY_FOR_PROVISIONING' WHERE id = ?",
                assignmentId);
        assertThat(workspaceProvisioner.sweep().recovered()).isEqualTo(1);
        assertThat(workspaceProvisioner.sweep().recovered()).isZero();

        jdbc.update("UPDATE workspace_lease SET lease_expires_at = now() - interval '1 minute' WHERE id = ?",
                leaseId);
        assertThat(workspaceProvisioner.sweep().expired()).isEqualTo(1);
        assertThat(Files.exists(Path.of(workspacePath))).isFalse();
        assertThat(workspaceProvisioner.sweep().expired()).isZero();

        UUID leaseId2 = UUID.fromString(schedule.path("assignments").get(1)
                .path("workspaceLease").path("leaseId").asText());
        UUID assignmentId2 = UUID.fromString(schedule.path("assignments").get(1)
                .path("assignmentId").asText());
        ParallelScheduleView provisioned2 = workspaceProvisioner.provision(
                projectId, scheduleId, leaseId2, "user:integration", "workspace-provision-2"
        );
        String workspacePath2 = provisioned2.assignments().get(1).workspaceLease().workspacePath();
        Path markerPath2 = Path.of(workspacePath2).resolve(".zhishu-workspace-lease.json");
        String validMarker2 = Files.readString(markerPath2, StandardCharsets.UTF_8);
        Files.writeString(markerPath2, "{}", StandardCharsets.UTF_8);
        jdbc.update("UPDATE workspace_lease SET lease_expires_at = now() - interval '1 minute' WHERE id = ?",
                leaseId2);
        assertThat(workspaceProvisioner.sweep().cleanupPending()).isEqualTo(1);
        Files.writeString(markerPath2, validMarker2, StandardCharsets.UTF_8);
        assertThat(workspaceProvisioner.sweep().expired()).isEqualTo(1);
        assertThat(Files.exists(Path.of(workspacePath2))).isFalse();
        assertThat(jdbc.queryForObject(
                "SELECT status FROM parallel_schedule_assignment WHERE id = ?", String.class, assignmentId2
        )).isEqualTo("CANCELLED");

        mockMvc.perform(get(
                        "/internal/project-control/v1/projects/{projectId}/plans/{planId}/parallel-schedules",
                        projectId, planId)
                        .header("Authorization", "Bearer integration-project-control-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].scheduleId").value(scheduleId.toString()))
                .andExpect(jsonPath("$[0].status").value("APPROVED"));
        assertThat(count("SELECT count(*) FROM parallel_schedule_assignment WHERE schedule_id = ?", scheduleId))
                .isEqualTo(2);
        assertThat(count("SELECT count(*) FROM workspace_lease WHERE schedule_id = ?", scheduleId)).isEqualTo(2);
        assertThat(count("SELECT count(*) FROM work_order WHERE plan_id = ?", planId)).isZero();
        assertThat(jdbc.queryForList(
                "SELECT state FROM plan_execution_state WHERE plan_id = ? AND node_key IN ('alpha', 'beta')",
                String.class, planId
        )).containsOnly("READY");
    }

    @Test
    void parallelScheduleDispatchRequiresBothDirectoryLeasesToBeProvisioned() throws Exception {
        IntegrationScheduleFixture fixture = createApprovedSchedule(
                "dispatch-unprovisioned", "[\"READ_FILE\"]"
        );
        int baselineTaskCount = count("SELECT count(*) FROM agent_task WHERE project_id = ?", projectId);

        mockMvc.perform(post(
                        "/internal/project-control/v1/projects/{projectId}/plans/{planId}"
                                + "/parallel-schedules/{scheduleId}/dispatch",
                        projectId, fixture.planId(), fixture.scheduleId())
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"clientRequestId\":\"dispatch-unprovisioned-1\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("PROJECT_STATE_CONFLICT"));

        assertThat(count("SELECT count(*) FROM parallel_schedule_dispatch WHERE schedule_id = ?",
                fixture.scheduleId())).isZero();
        assertThat(count("SELECT count(*) FROM work_order WHERE schedule_id = ?", fixture.scheduleId())).isZero();
        assertThat(count("SELECT count(*) FROM agent_task WHERE project_id = ?", projectId))
                .isEqualTo(baselineTaskCount);
        assertThat(jdbc.queryForList(
                "SELECT status FROM parallel_schedule_assignment WHERE schedule_id = ? ORDER BY worker_slot",
                String.class, fixture.scheduleId()
        )).containsOnly("READY_FOR_PROVISIONING");
        verify(runtimeClient, times(0)).start(any());
    }

    @Test
    void parallelScheduleDispatchCreatesTwoWorkspaceBoundWorkOrdersAndReplays() throws Exception {
        IntegrationScheduleFixture fixture = createProvisionedSchedule("dispatch-success");
        List<Map<String, Object>> assignments = jdbc.query("""
                SELECT a.id AS assignment_id, a.node_key, a.worker_slot, a.profile_id,
                       l.id AS lease_id, l.workspace_path
                FROM parallel_schedule_assignment a
                JOIN workspace_lease l ON l.assignment_id = a.id
                WHERE a.schedule_id = ?
                ORDER BY a.worker_slot
                """, (row, number) -> Map.of(
                "assignmentId", row.getObject("assignment_id", UUID.class),
                "nodeKey", row.getString("node_key"),
                "workerSlot", row.getInt("worker_slot"),
                "profileId", row.getObject("profile_id", UUID.class),
                "leaseId", row.getObject("lease_id", UUID.class),
                "workspacePath", row.getString("workspace_path")
        ), fixture.scheduleId());
        int baselineTaskCount = count("SELECT count(*) FROM agent_task WHERE project_id = ?", projectId);
        when(runtimeClient.start(any())).thenAnswer(invocation -> {
            RuntimeStartCommand command = invocation.getArgument(0);
            return new RuntimeAccepted("parallel-" + command.attemptId(), true);
        });
        String dispatchPath = "/internal/project-control/v1/projects/" + projectId
                + "/plans/" + fixture.planId() + "/parallel-schedules/" + fixture.scheduleId() + "/dispatch";
        String requestBody = "{\"clientRequestId\":\"dispatch-success-1\"}";

        String firstResponse = mockMvc.perform(post(dispatchPath)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(requestBody))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.scheduleId").value(fixture.scheduleId().toString()))
                .andExpect(jsonPath("$.planId").value(fixture.planId().toString()))
                .andExpect(jsonPath("$.replayed").value(false))
                .andExpect(jsonPath("$.workOrders.length()").value(2))
                .andReturn().getResponse().getContentAsString();
        JsonNode first = json.readTree(firstResponse);
        String dispatchId = first.path("dispatchId").asText();

        for (int index = 0; index < assignments.size(); index += 1) {
            Map<String, Object> assignment = assignments.get(index);
            JsonNode workOrder = first.path("workOrders").get(index);
            String workspacePath = assignment.get("workspacePath").toString();
            assertThat(workOrder.path("nodeKey").asText()).isEqualTo(assignment.get("nodeKey"));
            assertThat(workOrder.path("profileId").asText()).isEqualTo(assignment.get("profileId").toString());
            assertThat(workOrder.path("scheduleDispatchId").asText()).isEqualTo(dispatchId);
            assertThat(workOrder.path("scheduleAssignmentId").asText())
                    .isEqualTo(assignment.get("assignmentId").toString());
            assertThat(workOrder.path("workspaceLeaseId").asText())
                    .isEqualTo(assignment.get("leaseId").toString());
            assertThat(workOrder.path("executionWorkspacePath").asText()).isEqualTo(workspacePath);
            assertThat(workOrder.path("status").asText()).isEqualTo("DISPATCHED");
            assertThat(Files.exists(Path.of(workspacePath))).isTrue();
            assertThat(Files.exists(Path.of(workspacePath).resolve(".git"))).isFalse();
        }

        ArgumentCaptor<RuntimeStartCommand> runtimeCommands = ArgumentCaptor.forClass(RuntimeStartCommand.class);
        verify(runtimeClient, times(2)).start(runtimeCommands.capture());
        for (int index = 0; index < runtimeCommands.getAllValues().size(); index += 1) {
            RuntimeStartCommand command = runtimeCommands.getAllValues().get(index);
            Map<String, Object> assignment = assignments.get(index);
            String workspacePath = assignment.get("workspacePath").toString();
            assertThat(command.projectRef()).isEqualTo(workspacePath);
            assertThat(command.permissionPolicy().projectRoot()).isEqualTo(workspacePath);
            assertThat(command.context().get("workOrderContext"))
                    .asInstanceOf(org.assertj.core.api.InstanceOfAssertFactories.MAP)
                    .containsEntry("scheduleId", fixture.scheduleId())
                    .containsEntry("scheduleAssignmentId", assignment.get("assignmentId"))
                    .containsEntry("workspaceLeaseId", assignment.get("leaseId"))
                    .containsEntry("workerSlot", assignment.get("workerSlot"))
                    .containsEntry("executionWorkspacePath", workspacePath);
        }

        String replayResponse = mockMvc.perform(post(dispatchPath)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(requestBody))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.dispatchId").value(dispatchId))
                .andExpect(jsonPath("$.replayed").value(true))
                .andExpect(jsonPath("$.workOrders.length()").value(2))
                .andReturn().getResponse().getContentAsString();
        JsonNode replay = json.readTree(replayResponse);
        for (int index = 0; index < 2; index += 1) {
            assertThat(replay.path("workOrders").get(index).path("workOrderId").asText())
                    .isEqualTo(first.path("workOrders").get(index).path("workOrderId").asText());
        }

        verify(runtimeClient, times(2)).start(any());
        assertThat(count("SELECT count(*) FROM parallel_schedule_dispatch WHERE schedule_id = ?",
                fixture.scheduleId())).isOne();
        assertThat(count("SELECT count(*) FROM work_order WHERE schedule_id = ?", fixture.scheduleId()))
                .isEqualTo(2);
        assertThat(count("SELECT count(*) FROM agent_task WHERE project_id = ?", projectId))
                .isEqualTo(baselineTaskCount + 2);
        assertThat(count("""
                SELECT count(*) FROM parallel_schedule_event
                WHERE schedule_id = ? AND event_type = 'DISPATCHED'
                """, fixture.scheduleId())).isOne();
        assertThat(jdbc.queryForList(
                "SELECT status FROM parallel_schedule_assignment WHERE schedule_id = ? ORDER BY worker_slot",
                String.class, fixture.scheduleId()
        )).containsOnly("RUNNING");
    }

    @Test
    void parallelScheduleDispatchRollsBackBothWorkersWhenSecondCapabilityCheckFails() throws Exception {
        IntegrationScheduleFixture fixture = createProvisionedSchedule(
                "dispatch-rollback", "[\"TEST\"]"
        );
        int baselineTaskCount = count("SELECT count(*) FROM agent_task WHERE project_id = ?", projectId);
        jdbc.update("""
                UPDATE agent_profile SET capabilities = CAST('["READ_FILE"]' AS jsonb)
                WHERE id = ?
                """, profileId);

        mockMvc.perform(post(
                        "/internal/project-control/v1/projects/{projectId}/plans/{planId}"
                                + "/parallel-schedules/{scheduleId}/dispatch",
                        projectId, fixture.planId(), fixture.scheduleId())
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"clientRequestId\":\"dispatch-rollback-1\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("PROJECT_STATE_CONFLICT"));

        assertThat(count("SELECT count(*) FROM parallel_schedule_dispatch WHERE schedule_id = ?",
                fixture.scheduleId())).isZero();
        assertThat(count("SELECT count(*) FROM work_order WHERE schedule_id = ?", fixture.scheduleId())).isZero();
        assertThat(count("SELECT count(*) FROM agent_task WHERE project_id = ?", projectId))
                .isEqualTo(baselineTaskCount);
        assertThat(jdbc.queryForList(
                "SELECT status FROM parallel_schedule_assignment WHERE schedule_id = ? ORDER BY worker_slot",
                String.class, fixture.scheduleId()
        )).containsOnly("PROVISIONED");
        assertThat(jdbc.queryForList("""
                SELECT state FROM plan_execution_state
                WHERE plan_id = ? AND node_key IN ('alpha', 'beta') ORDER BY node_key
                """, String.class, fixture.planId())).containsOnly("READY");
        verify(runtimeClient, times(0)).start(any());
    }

    @Test
    void schedulerCandidatePairsExplainDependencyDirectionWithoutReservingWorkers() throws Exception {
        JsonNode context = generateContext("PLANNER");
        UUID proposalId = createPlanProposal("""
                {
                  "schemaVersion":"1.0","name":"Candidate dependency","objective":"Explain dependency pairs",
                  "creationReason":"Stage 10.4B integration","baseStateRevision":0,"basePlanVersion":null,
                  "contextPackageId":"%s","provider":"zhishu-grounded","model":"grounded-planner-v1",
                  "permissions":{"taskCreate":false,"runtimeDispatch":false,"planPublish":false},
                  "nodes":[
                    {"nodeKey":"alpha","title":"Alpha","objective":"Change alpha",
                     "scope":["src/alpha"],"acceptanceCriteria":["Alpha passes"],"priority":3,
                     "requiredCapabilities":["READ_FILE"],"requiresHumanApproval":false,"dependsOn":[]},
                    {"nodeKey":"beta","title":"Beta","objective":"Change beta",
                     "scope":["src/beta"],"acceptanceCriteria":["Beta passes"],"priority":2,
                     "requiredCapabilities":["READ_FILE"],"requiresHumanApproval":false,"dependsOn":[]},
                    {"nodeKey":"gamma","title":"Gamma","objective":"Change gamma",
                     "scope":["src/gamma"],"acceptanceCriteria":["Gamma passes"],"priority":1,
                     "requiredCapabilities":["READ_FILE"],"requiresHumanApproval":false,
                     "dependsOn":["alpha"]}
                  ]
                }
                """.formatted(context.path("packageId").asText()));
        String planResponse = mockMvc.perform(post(
                        "/internal/project-control/v1/projects/{projectId}/plans/proposals/{proposalId}/publish",
                        projectId, proposalId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"approvedNodeKeys\":[]}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        UUID planId = UUID.fromString(json.readTree(planResponse).path("planId").asText());

        mockMvc.perform(get(
                        "/internal/project-control/v1/projects/{projectId}/plans/{planId}"
                                + "/parallel-schedule-candidates",
                        projectId, planId)
                        .header("Authorization", "Bearer integration-project-control-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.summary.totalPairCount").value(3))
                .andExpect(jsonPath("$.summary.eligiblePairCount").value(1))
                .andExpect(jsonPath("$.summary.blockedPairCount").value(2))
                .andExpect(jsonPath("$.candidates[0].pairKey").value("alpha::beta"))
                .andExpect(jsonPath("$.candidates[0].eligible").value(true))
                .andExpect(jsonPath("$.candidates[1].pairKey").value("alpha::gamma"))
                .andExpect(jsonPath("$.candidates[1].dependencyAssessment").value("CONFLICT"))
                .andExpect(jsonPath("$.candidates[1].dependencyDirection").value("RIGHT_DEPENDS_ON_LEFT"))
                .andExpect(jsonPath("$.candidates[1].rightNode.executionState").value("NOT_READY"))
                .andExpect(jsonPath("$.candidates[1].blockers[0]").value("RIGHT_NODE_BLOCKED"))
                .andExpect(jsonPath("$.candidates[1].blockers[1]").value("DEPENDENCY_CONFLICT"));
        assertThat(count("SELECT count(*) FROM parallel_schedule_proposal WHERE plan_id = ?", planId)).isZero();
        assertThat(count("SELECT count(*) FROM work_order WHERE plan_id = ?", planId)).isZero();
    }

    @Test
    void integrationGateApprovesEvidenceOnlyWithoutApplyingWork() throws Exception {
        IntegrationScheduleFixture fixture = createProvisionedSchedule("gate-approval");
        UUID evidenceReferenceId = createEvidenceReference();
        String basePath = "/internal/project-control/v1/projects/" + projectId
                + "/plans/" + fixture.planId() + "/integration-gates";

        String missingGate = mockMvc.perform(post(basePath)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"clientRequestId\":\"gate-missing-1\",\"scheduleId\":\""
                                + fixture.scheduleId() + "\",\"baseStateRevision\":0,\"basePlanVersion\":1," 
                                + "\"evidenceReferenceIds\":[]}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("PENDING_APPROVAL"))
                .andExpect(jsonPath("$.evidenceStatus").value("MISSING"))
                .andExpect(jsonPath("$.applyState").value("NOT_ATTEMPTED"))
                .andReturn().getResponse().getContentAsString();
        UUID missingGateId = UUID.fromString(json.readTree(missingGate).path("gateId").asText());
        mockMvc.perform(post(basePath + "/" + missingGateId + "/reject")
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"clientRequestId\":\"gate-reject-1\",\"reason\":\"Evidence is required\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("REJECTED"));

        String createBody = "{\"clientRequestId\":\"gate-create-1\",\"scheduleId\":\""
                + fixture.scheduleId() + "\",\"baseStateRevision\":0,\"basePlanVersion\":1,"
                + "\"evidenceReferenceIds\":[\"" + evidenceReferenceId + "\"]}";
        String gateResponse = mockMvc.perform(post(basePath)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.evidenceStatus").value("PRESENT"))
                .andExpect(jsonPath("$.evidenceCount").value(1))
                .andExpect(jsonPath("$.proposal.gateMode").value("EVIDENCE_ONLY"))
                .andExpect(jsonPath("$.proposal.physicalWorkspaceKind").value("DIRECTORY_ONLY"))
                .andExpect(jsonPath("$.conflictAssessment.automaticApply").value(false))
                .andExpect(jsonPath("$.evidence[0].evidenceReferenceId").value(evidenceReferenceId.toString()))
                .andExpect(jsonPath("$.evidence[0].artifactHash").value("gate-fixture-hash"))
                .andExpect(jsonPath("$.evidence[0].purpose").value("INTEGRATION_GATE_REVIEW"))
                .andReturn().getResponse().getContentAsString();
        JsonNode createdGate = json.readTree(gateResponse);
        UUID gateId = UUID.fromString(createdGate.path("gateId").asText());
        UUID artifactId = UUID.fromString(createdGate.path("evidence").get(0).path("artifactId").asText());

        jdbc.update("UPDATE evidence_reference SET purpose = 'CHANGED_AFTER_GATE' WHERE id = ?", evidenceReferenceId);
        jdbc.update("UPDATE task_artifact SET hash = 'changed-after-gate' WHERE id = ?", artifactId);
        mockMvc.perform(get(basePath + "/" + gateId)
                        .header("Authorization", "Bearer integration-project-control-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.evidence[0].artifactHash").value("gate-fixture-hash"))
                .andExpect(jsonPath("$.evidence[0].purpose").value("INTEGRATION_GATE_REVIEW"));

        UUID lateEvidenceReferenceId = createEvidenceReference();
        assertThatThrownBy(() -> jdbc.update("""
                INSERT INTO integration_gate_evidence (
                    gate_id, evidence_reference_id, ordinal, project_id, artifact_id,
                    artifact_hash, source_type, source_id, purpose, reference_created_at
                )
                SELECT ?, evidence_ref.id, 1, evidence_ref.project_id, evidence_ref.artifact_id,
                       artifact.hash, evidence_ref.source_type, evidence_ref.source_id,
                       evidence_ref.purpose, evidence_ref.created_at
                FROM evidence_reference evidence_ref
                JOIN task_artifact artifact ON artifact.id = evidence_ref.artifact_id
                WHERE evidence_ref.id = ?
                """, gateId, lateEvidenceReferenceId)).isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update("""
                UPDATE integration_gate_proposal SET proposal_payload = CAST('{}' AS jsonb) WHERE id = ?
                """, gateId)).isInstanceOf(DataAccessException.class);
        String replayResponse = mockMvc.perform(post(basePath)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        assertThat(json.readTree(replayResponse).path("gateId").asText()).isEqualTo(gateId.toString());

        String decisionBody = "{\"clientRequestId\":\"gate-confirm-1\"}";
        mockMvc.perform(post(basePath + "/" + gateId + "/confirm")
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(decisionBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("APPROVED"))
                .andExpect(jsonPath("$.applyState").value("NOT_ATTEMPTED"))
                .andExpect(jsonPath("$.events.length()" ).value(2));
        String decisionReplay = mockMvc.perform(post(basePath + "/" + gateId + "/confirm")
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(decisionBody))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(json.readTree(decisionReplay).path("gateId").asText()).isEqualTo(gateId.toString());
        assertThat(count("SELECT count(*) FROM work_order WHERE plan_id = ?", fixture.planId())).isZero();
        assertThat(count("SELECT count(*) FROM integration_gate_event WHERE gate_id = ?", gateId)).isEqualTo(2);
    }

    @Test
    void integrationGateBecomesStaleWhenBaseStateChanges() throws Exception {
        IntegrationScheduleFixture fixture = createProvisionedSchedule("gate-stale");
        UUID evidenceReferenceId = createEvidenceReference();
        String basePath = "/internal/project-control/v1/projects/" + projectId
                + "/plans/" + fixture.planId() + "/integration-gates";
        String response = mockMvc.perform(post(basePath)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"clientRequestId\":\"gate-stale-1\",\"scheduleId\":\""
                                + fixture.scheduleId() + "\",\"baseStateRevision\":0,\"basePlanVersion\":1,"
                                + "\"evidenceReferenceIds\":[\"" + evidenceReferenceId + "\"]}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        UUID gateId = UUID.fromString(json.readTree(response).path("gateId").asText());
        jdbc.update("UPDATE project_state_snapshot SET state_revision = 1 WHERE project_id = ?", projectId);

        mockMvc.perform(post(basePath + "/" + gateId + "/confirm")
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"clientRequestId\":\"gate-stale-confirm-1\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("PROJECT_STATE_CONFLICT"));
        mockMvc.perform(get(basePath + "/" + gateId)
                        .header("Authorization", "Bearer integration-project-control-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("STALE"))
                .andExpect(jsonPath("$.events.length()").value(2))
                .andExpect(jsonPath("$.events[1].payload.reason").value("BASE_VERSION_CHANGED"));
    }

    @Test
    void integrationGateConcurrentDecisionReplayReturnsTheSameApprovedGate() throws Exception {
        IntegrationScheduleFixture fixture = createProvisionedSchedule("gate-concurrent-decision");
        UUID evidenceReferenceId = createEvidenceReference();
        IntegrationGateView gate = integrationGates.create(
                projectId, fixture.planId(), fixture.scheduleId(), "user:integration",
                "gate-concurrent-create-1", 0, 1, List.of(evidenceReferenceId)
        );
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        Callable<IntegrationGateView> decision = () -> {
            ready.countDown();
            assertThat(start.await(10, TimeUnit.SECONDS)).isTrue();
            return integrationGates.confirm(
                    projectId, fixture.planId(), gate.gateId(), "user:integration",
                    "gate-concurrent-confirm-1"
            );
        };
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<IntegrationGateView> first = executor.submit(decision);
            Future<IntegrationGateView> second = executor.submit(decision);
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            assertThat(first.get(10, TimeUnit.SECONDS).gateId()).isEqualTo(gate.gateId());
            assertThat(second.get(10, TimeUnit.SECONDS).gateId()).isEqualTo(gate.gateId());
        } finally {
            executor.shutdownNow();
        }
        assertThat(integrationGates.get(projectId, fixture.planId(), gate.gateId()).status())
                .isEqualTo("APPROVED");
        assertThat(count("SELECT count(*) FROM integration_gate_event WHERE gate_id = ?", gate.gateId()))
                .isEqualTo(2);
    }

    @Test
    void completesIsolatedGitWorktreeCandidateBuildTestAndFinalization() throws Exception {
        Path repository = WORKSPACE_ROOT.resolve("git-finalization-" + UUID.randomUUID());
        Files.createDirectories(repository);
        Files.writeString(repository.resolve("package.json"),
                "{\"scripts\":{\"build\":\"node verify.cjs\",\"test\":\"node verify.cjs\"}}\n");
        Files.writeString(repository.resolve("verify.cjs"), """
                const fs = require('fs');
                for (const name of ['alpha.txt', 'beta.txt']) {
                  if (!fs.readFileSync(name, 'utf8').includes('integrated')) process.exit(1);
                }
                """);
        Files.writeString(repository.resolve("alpha.txt"), "alpha base\n");
        Files.writeString(repository.resolve("beta.txt"), "beta base\n");
        git.requireSuccess(repository, List.of("init"));
        git.requireSuccess(repository, List.of("add", "."));
        git.requireSuccess(repository, List.of("commit", "-m", "baseline"), Map.of(
                "GIT_AUTHOR_NAME", "Zhishu Test",
                "GIT_AUTHOR_EMAIL", "zhishu-test@example.invalid",
                "GIT_COMMITTER_NAME", "Zhishu Test",
                "GIT_COMMITTER_EMAIL", "zhishu-test@example.invalid"
        ));
        String baseCommit = git.requireSuccess(repository, List.of("rev-parse", "--verify", "HEAD^{commit}"))
                .stdout().trim();
        jdbc.update("UPDATE project SET runtime_project_ref = ?, display_root_path = ? WHERE id = ?",
                repository.toString(), repository.toString(), projectId);

        IntegrationScheduleFixture fixture = createApprovedSchedule(
                "git-finalization", "[\"READ_FILE\"]", "GIT_WORKTREE"
        );
        List<Map<String, Object>> workers = jdbc.queryForList("""
                SELECT assignment.id AS assignment_id, lease.id AS lease_id, lease.workspace_path
                FROM parallel_schedule_assignment assignment
                JOIN workspace_lease lease ON lease.assignment_id = assignment.id
                WHERE assignment.schedule_id = ? ORDER BY assignment.worker_slot
                """, fixture.scheduleId());
        assertThat(workers).hasSize(2);
        for (int index = 0; index < workers.size(); index += 1) {
            UUID leaseId = (UUID) workers.get(index).get("lease_id");
            workspaceProvisioner.provision(
                    projectId, fixture.scheduleId(), leaseId, "user:integration",
                    "git-finalization-provision-" + (index + 1)
            );
        }
        workers = jdbc.queryForList("""
                SELECT assignment.id AS assignment_id, lease.workspace_path
                FROM parallel_schedule_assignment assignment
                JOIN workspace_lease lease ON lease.assignment_id = assignment.id
                WHERE assignment.schedule_id = ? ORDER BY assignment.worker_slot
                """, fixture.scheduleId());
        Files.writeString(Path.of(String.valueOf(workers.get(0).get("workspace_path"))).resolve("alpha.txt"),
                "alpha integrated\n");
        Files.writeString(Path.of(String.valueOf(workers.get(1).get("workspace_path"))).resolve("beta.txt"),
                "beta integrated\n");
        for (Map<String, Object> worker : workers) {
            jdbc.update("UPDATE parallel_schedule_assignment SET status = 'VERIFIED' WHERE id = ?",
                    worker.get("assignment_id"));
        }

        IntegrationGateView gate = integrationGates.create(
                projectId, fixture.planId(), fixture.scheduleId(), "user:integration",
                "git-finalization-gate", 0, 1, List.of(createEvidenceReference())
        );
        gate = integrationGates.confirm(
                projectId, fixture.planId(), gate.gateId(), "user:integration", "git-finalization-gate-confirm"
        );
        assertThat(gate.status()).isEqualTo("APPROVED");

        IntegrationExecutionView started = integrationExecutions.execute(
                projectId, fixture.planId(), gate.gateId(), "user:integration", "git-finalization-execute"
        );
        IntegrationExecutionView completed = awaitIntegrationRun(fixture.planId(), gate.gateId(), started.runId());
        assertThat(completed.status()).as("failure=%s message=%s steps=%s",
                completed.failureCode(), completed.failureMessage(), completed.steps()).isEqualTo("SUCCEEDED");
        assertThat(completed.policyPreset()).isEqualTo("NPM");
        assertThat(completed.candidateCommit()).matches("[0-9a-f]{40}");
        assertThat(completed.steps()).extracting(IntegrationExecutionView.StepView::status)
                .containsOnly("SUCCEEDED");
        assertThat(git.requireSuccess(repository, List.of("rev-parse", "--verify", "HEAD^{commit}"))
                .stdout().trim()).isEqualTo(baseCommit);

        IntegrationExecutionView finalized = integrationExecutions.finalizeCandidate(
                projectId, fixture.planId(), gate.gateId(), started.runId(),
                "user:integration", "git-finalization-finalize", completed.candidateCommit()
        );
        assertThat(finalized.finalizationState()).isEqualTo("CLEANED");
        assertThat(finalized.workspaceState()).isEqualTo("CLEANED");
        IntegrationExecutionView replay = integrationExecutions.finalizeCandidate(
                projectId, fixture.planId(), gate.gateId(), started.runId(),
                "user:integration", "git-finalization-finalize", completed.candidateCommit()
        );
        assertThat(replay.replayed()).isTrue();
        assertThat(Files.readString(repository.resolve("alpha.txt"))).isEqualTo("alpha integrated\n");
        assertThat(Files.readString(repository.resolve("beta.txt"))).isEqualTo("beta integrated\n");
        assertThat(git.requireSuccess(repository, List.of(
                "status", "--porcelain=v1", "--untracked-files=all"
        )).stdout()).isBlank();

        jdbc.update("UPDATE workspace_lease SET lease_expires_at = now() - interval '1 minute' WHERE schedule_id = ?",
                fixture.scheduleId());
        assertThat(workspaceProvisioner.sweep().expired()).isEqualTo(2);
        assertThat(workers).allSatisfy(worker ->
                assertThat(Files.exists(Path.of(String.valueOf(worker.get("workspace_path"))))).isFalse());
    }

    @Test
    void integrationGateBecomesStaleWhenProvisionedAssignmentsChange() throws Exception {
        IntegrationScheduleFixture fixture = createProvisionedSchedule("gate-assignment-stale");
        UUID evidenceReferenceId = createEvidenceReference();
        String basePath = "/internal/project-control/v1/projects/" + projectId
                + "/plans/" + fixture.planId() + "/integration-gates";
        String response = mockMvc.perform(post(basePath)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"clientRequestId\":\"gate-assignment-stale-1\",\"scheduleId\":\""
                                + fixture.scheduleId() + "\",\"baseStateRevision\":0,\"basePlanVersion\":1,"
                                + "\"evidenceReferenceIds\":[\"" + evidenceReferenceId + "\"]}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        UUID gateId = UUID.fromString(json.readTree(response).path("gateId").asText());
        jdbc.update("""
                UPDATE parallel_schedule_assignment SET status = 'CANCELLED'
                WHERE schedule_id = ? AND worker_slot = 1
                """, fixture.scheduleId());

        mockMvc.perform(post(basePath + "/" + gateId + "/confirm")
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"clientRequestId\":\"gate-assignment-stale-confirm-1\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("PROJECT_STATE_CONFLICT"));
        mockMvc.perform(get(basePath + "/" + gateId)
                        .header("Authorization", "Bearer integration-project-control-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("STALE"))
                .andExpect(jsonPath("$.events[1].payload.reason")
                        .value("ASSIGNMENT_PROVISIONING_CHANGED"));
    }

    @Test
    void integrationRunDatabaseEnforcesEvidenceFinalizationAndPolicyStateMachines() throws Exception {
        IntegrationScheduleFixture fixture = createProvisionedSchedule("integration-run-constraints");
        UUID evidenceReferenceId = createEvidenceReference();
        IntegrationGateView gate = integrationGates.create(
                projectId, fixture.planId(), fixture.scheduleId(), "user:integration",
                "gate-run-constraints", 0, 1, List.of(evidenceReferenceId)
        );
        gate = integrationGates.confirm(
                projectId, fixture.planId(), gate.gateId(), "user:integration",
                "gate-run-constraints-confirm"
        );
        UUID gateId = gate.gateId();
        UUID runId = UUID.randomUUID();
        String baseCommit = "a".repeat(40);
        String candidateCommit = "b".repeat(40);
        jdbc.update("""
                INSERT INTO integration_execution_run (
                    id, project_id, plan_id, gate_id, attempt_number, status,
                    client_request_id, request_hash, created_by, repository_root,
                    base_commit, candidate_commit, integration_workspace_path,
                    integration_branch_ref, ownership_token, policy_preset,
                    build_command_summary, test_command_summary, started_at, completed_at
                ) VALUES (?, ?, ?, ?, 1, 'SUCCEEDED', ?, ?, ?, ?, ?, ?, ?, ?, ?,
                          'NPM', 'npm run build', 'npm test', now(), now())
                """, runId, projectId, fixture.planId(), gateId,
                "integration-run-constraints", "request-hash", "user:integration",
                WORKSPACE_ROOT.resolve("repository").toString(), baseCommit, candidateCommit,
                WORKSPACE_ROOT.resolve("integration-run").toString(),
                "zhishu/integration/12345678/12345678", "integration-run-token");

        assertThatThrownBy(() -> jdbc.update("""
                INSERT INTO integration_execution_step (
                    id, run_id, ordinal, step_type, status, command_summary
                ) VALUES (?, ?, 0, 'BUILD', 'SUCCEEDED', 'npm run build')
                """, UUID.randomUUID(), runId)).isInstanceOf(DataAccessException.class);

        jdbc.update("""
                UPDATE integration_execution_run
                SET finalization_state = 'APPLYING', finalization_client_request_id = ?,
                    finalization_request_hash = ?, finalized_by = ?
                WHERE id = ?
                """, "finalize-1", "finalize-hash", "user:integration", runId);
        assertThatThrownBy(() -> jdbc.update("""
                UPDATE integration_execution_run
                SET finalization_state = 'CLEANED', workspace_state = 'CLEANED',
                    finalized_target_ref = 'main', finalized_at = now()
                WHERE id = ?
                """, runId)).isInstanceOf(DataAccessException.class);

        jdbc.update("""
                UPDATE integration_execution_run
                SET finalization_state = 'APPLIED', finalized_target_ref = 'main', finalized_at = now()
                WHERE id = ?
                """, runId);
        jdbc.update("""
                UPDATE integration_execution_run
                SET finalization_state = 'CLEANUP_PENDING', workspace_state = 'CLEANUP_PENDING'
                WHERE id = ?
                """, runId);
        jdbc.update("""
                UPDATE integration_execution_run
                SET finalization_state = 'CLEANED', workspace_state = 'CLEANED'
                WHERE id = ?
                """, runId);
        assertThatThrownBy(() -> jdbc.update("""
                UPDATE integration_execution_run SET finalization_client_request_id = 'changed' WHERE id = ?
                """, runId)).isInstanceOf(DataAccessException.class);

        assertThatThrownBy(() -> jdbc.update("""
                INSERT INTO integration_execution_run (
                    id, project_id, plan_id, gate_id, attempt_number, status,
                    client_request_id, request_hash, created_by, repository_root,
                    base_commit, integration_workspace_path, integration_branch_ref,
                    ownership_token, policy_preset
                ) VALUES (?, ?, ?, ?, 2, 'FAILED', ?, ?, ?, ?, ?, ?, ?, ?, 'NPM')
                """, UUID.randomUUID(), projectId, fixture.planId(), gateId,
                "integration-run-invalid-policy", "invalid-policy-hash", "user:integration",
                WORKSPACE_ROOT.resolve("repository").toString(), baseCommit,
                WORKSPACE_ROOT.resolve("integration-run-invalid").toString(),
                "zhishu/integration/12345678/87654321", "integration-run-token-2"
        )).isInstanceOf(DataAccessException.class);
    }

    private IntegrationScheduleFixture createProvisionedSchedule(String suffix) throws Exception {
        return createProvisionedSchedule(suffix, "[\"READ_FILE\"]");
    }

    private IntegrationScheduleFixture createProvisionedSchedule(
            String suffix,
            String betaRequiredCapabilities
    ) throws Exception {
        IntegrationScheduleFixture fixture = createApprovedSchedule(suffix, betaRequiredCapabilities);
        List<UUID> leaseIds = jdbc.query("""
                SELECT id FROM workspace_lease WHERE schedule_id = ? ORDER BY id
                """, (row, number) -> row.getObject("id", UUID.class), fixture.scheduleId());
        for (int index = 0; index < leaseIds.size(); index += 1) {
            workspaceProvisioner.provision(
                    projectId, fixture.scheduleId(), leaseIds.get(index), "user:integration",
                    "provision-" + suffix + "-" + (index + 1)
            );
        }
        return fixture;
    }

    private IntegrationScheduleFixture createApprovedSchedule(
            String suffix,
            String betaRequiredCapabilities
    ) throws Exception {
        return createApprovedSchedule(suffix, betaRequiredCapabilities, "DIRECTORY_ONLY");
    }

    private IntegrationScheduleFixture createApprovedSchedule(
            String suffix,
            String betaRequiredCapabilities,
            String physicalWorkspaceKind
    ) throws Exception {
        JsonNode context = generateContext("PLANNER");
        UUID proposalId = createPlanProposal("""
                {
                  "schemaVersion":"1.0","name":"Integration Gate %s","objective":"Validate evidence gate",
                  "creationReason":"Stage 10.2A","baseStateRevision":0,"basePlanVersion":null,
                  "contextPackageId":"%s","provider":"zhishu-grounded","model":"grounded-planner-v1",
                  "permissions":{"taskCreate":false,"runtimeDispatch":false,"planPublish":false},
                  "nodes":[
                    {"nodeKey":"alpha","title":"Alpha","objective":"Change alpha","scope":["src/alpha"],
                     "acceptanceCriteria":["Alpha passes"],"priority":4,"requiredCapabilities":["READ_FILE"],
                     "requiresHumanApproval":false,"dependsOn":[]},
                    {"nodeKey":"beta","title":"Beta","objective":"Change beta","scope":["src/beta"],
                     "acceptanceCriteria":["Beta passes"],"priority":3,"requiredCapabilities":%s,
                     "requiresHumanApproval":false,"dependsOn":[]}
                  ]
                }
                """.formatted(suffix, context.path("packageId").asText(), betaRequiredCapabilities));
        String planResponse = mockMvc.perform(post(
                        "/internal/project-control/v1/projects/{projectId}/plans/proposals/{proposalId}/publish",
                        projectId, proposalId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"approvedNodeKeys\":[]}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        UUID planId = UUID.fromString(json.readTree(planResponse).path("planId").asText());
        String scheduleResponse = mockMvc.perform(post(
                        "/internal/project-control/v1/projects/{projectId}/plans/{planId}/parallel-schedules",
                        projectId, planId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"clientRequestId\":\"schedule-" + suffix + "\",\"baseStateRevision\":0,"
                                + "\"basePlanVersion\":1,\"nodeKeys\":[\"alpha\",\"beta\"],"
                                + "\"physicalWorkspaceKind\":\"" + physicalWorkspaceKind + "\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        JsonNode schedule = json.readTree(scheduleResponse);
        UUID scheduleId = UUID.fromString(schedule.path("scheduleId").asText());
        mockMvc.perform(post("/internal/project-control/v1/projects/{projectId}/plans/{planId}"
                        + "/parallel-schedules/{scheduleId}/confirm", projectId, planId, scheduleId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"clientRequestId\":\"confirm-" + suffix + "\"}"))
                .andExpect(status().isOk());
        return new IntegrationScheduleFixture(planId, scheduleId);
    }

    private IntegrationExecutionView awaitIntegrationRun(UUID planId, UUID gateId, UUID runId)
            throws InterruptedException {
        IntegrationExecutionView current = integrationExecutions.get(projectId, planId, gateId, runId, false);
        for (int attempt = 0; attempt < 300; attempt += 1) {
            if (List.of("SUCCEEDED", "FAILED").contains(current.status())) return current;
            Thread.sleep(100);
            current = integrationExecutions.get(projectId, planId, gateId, runId, false);
        }
        throw new AssertionError("Integration Run did not reach a terminal state within 30 seconds: "
                + current.status());
    }

    private UUID createEvidenceReference() {
        UUID artifactId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO task_artifact (
                    id, task_id, attempt_id, artifact_type, producer, content_plain, mime_type, size_bytes, hash, metadata
                ) VALUES (?, ?, ?, 'SUMMARY', 'integration-gate-test', 'Evidence fixture', 'text/plain', 15, 'gate-fixture-hash', CAST('{}' AS jsonb))
                """, artifactId, taskId, attemptId);
        UUID referenceId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO evidence_reference (id, project_id, artifact_id, source_type, source_id, purpose, created_by)
                VALUES (?, ?, ?, 'INTEGRATION_GATE_FIXTURE', ?, 'INTEGRATION_GATE_REVIEW', 'user:integration')
                """, referenceId, projectId, artifactId, UUID.randomUUID());
        return referenceId;
    }

    private record IntegrationScheduleFixture(UUID planId, UUID scheduleId) {
    }

    private JsonNode generateContext(String packageType) throws Exception {
        String response = mockMvc.perform(post(
                        "/internal/project-control/v1/projects/{projectId}/contexts", projectId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"packageType\":\"" + packageType + "\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return json.readTree(response);
    }

    private UUID publishSingleNodePlan(String name, String nodeKey, List<String> requiredCapabilities)
            throws Exception {
        JsonNode context = generateContext("PLANNER");
        UUID proposalId = createPlanProposal("""
                {
                  "schemaVersion":"1.0","name":"%s","objective":"Phase 7 hardening",
                  "creationReason":"Phase 7 hardening test","baseStateRevision":0,"basePlanVersion":null,
                  "contextPackageId":"%s","provider":"zhishu-grounded","model":"grounded-planner-v1",
                  "permissions":{"taskCreate":false,"runtimeDispatch":false,"planPublish":false},
                  "nodes":[{
                    "nodeKey":"%s","title":"%s","objective":"Exercise %s",
                    "scope":[],"acceptanceCriteria":["Hardening invariant holds"],"priority":1,
                    "requiredCapabilities":%s,"requiresHumanApproval":false,"dependsOn":[]
                  }]
                }
                """.formatted(
                name,
                context.path("packageId").asText(),
                nodeKey,
                nodeKey,
                nodeKey,
                json.writeValueAsString(requiredCapabilities)
        ));
        String response = mockMvc.perform(post(
                        "/internal/project-control/v1/projects/{projectId}/plans/proposals/{proposalId}/publish",
                        projectId, proposalId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"approvedNodeKeys\":[]}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return UUID.fromString(json.readTree(response).path("planId").asText());
    }

    private void failWorkOrderExecution(
            UUID workOrderId,
            UUID workOrderTaskId,
            UUID workOrderAttemptId,
            UUID planId,
            String nodeKey
    ) {
        jdbc.update("""
                UPDATE task_attempt
                SET status = 'FAILED', completed_at = now(),
                    error_code = 'HARDENING_TEST', error_message = 'Simulated execution failure'
                WHERE id = ?
                """, workOrderAttemptId);
        jdbc.update("""
                UPDATE agent_task
                SET status = 'FAILED', resolution_status = 'NEEDS_FOLLOW_UP', updated_at = now()
                WHERE id = ?
                """, workOrderTaskId);
        jdbc.update("""
                UPDATE work_order_execution
                SET status = 'FAILED', status_reason = 'Simulated execution failure',
                    dispatch_lease_id = NULL, dispatch_lease_expires_at = NULL, updated_at = now()
                WHERE work_order_id = ?
                """, workOrderId);
        jdbc.update("""
                UPDATE plan_execution_state SET state = 'FAILED', task_id = ?, updated_at = now()
                WHERE plan_id = ? AND node_key = ?
                """, workOrderTaskId, planId, nodeKey);
    }

    private UUID createPlanProposal(String body) throws Exception {
        String response = mockMvc.perform(post(
                        "/internal/project-control/v1/projects/{projectId}/plans/proposals", projectId)
                        .header("Authorization", "Bearer integration-project-control-token")
                        .header("X-Zhishu-Actor", "user:integration")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("PENDING_APPROVAL"))
                .andReturn().getResponse().getContentAsString();
        return UUID.fromString(json.readTree(response).path("proposalId").asText());
    }

    private RuntimeEvent event(
            String suffix,
            long sequenceNo,
            Instant occurredAt,
            RuntimeEventType type,
            Map<String, Object> payload
    ) {
        return new RuntimeEvent(
                "1.0",
                attemptId + "-" + suffix,
                taskId,
                attemptId,
                RUNTIME_RUN_ID,
                sequenceNo,
                occurredAt,
                type,
                payload
        );
    }

    private RuntimeEvent workOrderEvent(
            UUID eventTaskId,
            UUID eventAttemptId,
            String suffix,
            long sequenceNo,
            RuntimeEventType type,
            Map<String, Object> payload
    ) {
        return new RuntimeEvent(
                "1.0", eventAttemptId + "-" + suffix, eventTaskId, eventAttemptId,
                "follow-up-runtime-run", sequenceNo, Instant.now(), type, payload
        );
    }

    private Map<String, Object> artifactPayload(UUID artifactId) {
        return Map.of(
                "artifactId", artifactId.toString(),
                "artifactType", "SUMMARY",
                "producer", "NODE_RUNTIME",
                "contentPlain", SUMMARY,
                "mimeType", "text/plain",
                "sizeBytes", SUMMARY.getBytes(StandardCharsets.UTF_8).length,
                "hash", "sha256:integration-test",
                "metadata", Map.of("attemptNumber", 1, "source", "testcontainers")
        );
    }

    private int count(String sql, Object... arguments) {
        Integer result = jdbc.queryForObject(sql, Integer.class, arguments);
        return result == null ? 0 : result;
    }
}
