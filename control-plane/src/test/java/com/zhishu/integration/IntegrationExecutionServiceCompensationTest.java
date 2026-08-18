package com.zhishu.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.io.IOException;
import java.nio.file.Path;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.RejectedExecutionException;
import java.util.function.Consumer;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.core.task.TaskExecutor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.TransactionTemplate;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.zhishu.plan.AutomaticReplanService;
import com.zhishu.state.ProjectStateConflictException;
import com.zhishu.workspace.GitCommandRunner;
import com.zhishu.workspace.WorkspaceProvisionerProperties;

class IntegrationExecutionServiceCompensationTest {

    @TempDir
    Path temporaryRoot;

    @Test
    void requiredSandboxRejectsBeforeClaimingAnIntegrationRun() throws Exception {
        TransactionTemplate transactions = org.mockito.Mockito.mock(TransactionTemplate.class);
        IntegrationCommandRunner commands = org.mockito.Mockito.mock(IntegrationCommandRunner.class);
        org.mockito.Mockito.doThrow(new IOException("full sandbox is required"))
                .when(commands).verifySandboxCapability();
        IntegrationExecutionService service = new IntegrationExecutionService(
                org.mockito.Mockito.mock(JdbcTemplate.class),
                transactions,
                new ObjectMapper(),
                new IntegrationExecutionProperties(true, Duration.ofMinutes(1), 1_024,
                        IntegrationSandboxMode.REQUIRED),
                new WorkspaceProvisionerProperties(
                        temporaryRoot, Duration.ofSeconds(5), Duration.ofMinutes(5), Duration.ofSeconds(1)
                ),
                org.mockito.Mockito.mock(GitCommandRunner.class),
                commands,
                org.mockito.Mockito.mock(IntegrationPolicyResolver.class),
                org.mockito.Mockito.mock(GitIntegrationWorkspacePort.class),
                org.mockito.Mockito.mock(AutomaticReplanService.class),
                command -> { }
        );

        org.assertj.core.api.Assertions.assertThatThrownBy(() -> service.execute(
                UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), "user:test", "request-1"
        )).isInstanceOf(ProjectStateConflictException.class)
                .hasMessageContaining("full sandbox is required");
        verifyNoInteractions(transactions);
    }

    @Test
    void rejectedTaskExecutorImmediatelyFailsRunAndGateAndDeduplicatesReplan() throws Exception {
        JdbcTemplate jdbc = org.mockito.Mockito.mock(JdbcTemplate.class);
        TransactionTemplate transactions = org.mockito.Mockito.mock(TransactionTemplate.class);
        AutomaticReplanService replans = org.mockito.Mockito.mock(AutomaticReplanService.class);
        UUID projectId = UUID.randomUUID();
        UUID planId = UUID.randomUUID();
        UUID gateId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        IntegrationExecutionView failedView = failedView(projectId, planId, gateId, runId);
        IntegrationExecutionPolicy policy = new IntegrationExecutionPolicy(
                "NPM", List.of("npm", "run", "build"), List.of("npm", "test")
        );
        Object claim = executionClaim(runId, policy);

        when(transactions.execute(any())).thenReturn(claim);
        doAnswer(invocation -> {
            @SuppressWarnings("unchecked")
            Consumer<TransactionStatus> callback = invocation.getArgument(0);
            callback.accept(null);
            return null;
        }).when(transactions).executeWithoutResult(any());
        when(jdbc.update(anyString(), any(Object[].class))).thenReturn(1);
        when(jdbc.queryForObject(anyString(), eq(UUID.class), any(Object[].class))).thenReturn(gateId);
        when(replans.createForIntegrationFailure(
                eq(projectId), eq(planId), eq(runId), anyString(), anyString()
        )).thenReturn(Map.of("proposalId", UUID.randomUUID()));

        TaskExecutor rejectingExecutor = command -> { throw new RejectedExecutionException("queue full"); };
        IntegrationExecutionService service = spy(new IntegrationExecutionService(
                jdbc,
                transactions,
                new ObjectMapper(),
                new IntegrationExecutionProperties(true, Duration.ofMinutes(1), 1_024,
                        IntegrationSandboxMode.BEST_EFFORT),
                new WorkspaceProvisionerProperties(
                        temporaryRoot, Duration.ofSeconds(5), Duration.ofMinutes(5), Duration.ofSeconds(1)
                ),
                org.mockito.Mockito.mock(GitCommandRunner.class),
                org.mockito.Mockito.mock(IntegrationCommandRunner.class),
                org.mockito.Mockito.mock(IntegrationPolicyResolver.class),
                org.mockito.Mockito.mock(GitIntegrationWorkspacePort.class),
                replans,
                rejectingExecutor
        ));
        doReturn(failedView).when(service).get(projectId, planId, gateId, runId, false);

        IntegrationExecutionView result = service.execute(
                projectId, planId, gateId, "user:test", "request-rejected-1"
        );

        assertThat(result.status()).isEqualTo("FAILED");
        assertThat(result.failureCode()).isEqualTo("INTEGRATION_EXECUTION_FAILED");
        verify(replans).createForIntegrationFailure(
                eq(projectId), eq(planId), eq(runId), eq("system:automatic-replan"), anyString()
        );
        verify(jdbc).update(org.mockito.ArgumentMatchers.contains("SET status = 'FAILED'"), any(Object[].class));
        verify(jdbc).update(org.mockito.ArgumentMatchers.contains("SET apply_state = 'FAILED'"), any(Object[].class));
        verify(jdbc, org.mockito.Mockito.times(2)).update(
                org.mockito.ArgumentMatchers.contains("INSERT INTO integration_gate_event"),
                any(Object[].class)
        );
    }

    private Object executionClaim(UUID runId, IntegrationExecutionPolicy policy) throws Exception {
        Class<?> type = Class.forName(
                "com.zhishu.integration.IntegrationExecutionService$ExecutionClaim"
        );
        var constructor = type.getDeclaredConstructor(
                UUID.class, Path.class, String.class, Path.class, String.class, String.class,
                IntegrationExecutionPolicy.class, List.class, boolean.class
        );
        constructor.setAccessible(true);
        return constructor.newInstance(
                runId, temporaryRoot, "base-commit", temporaryRoot.resolve("integration"),
                "zhishu/integration/12345678/12345678", "ownership-token", policy, List.of(), false
        );
    }

    private IntegrationExecutionView failedView(UUID projectId, UUID planId, UUID gateId, UUID runId) {
        Instant now = Instant.now();
        return new IntegrationExecutionView(
                runId,
                projectId,
                planId,
                gateId,
                1,
                "FAILED",
                temporaryRoot.toString(),
                "base-commit",
                null,
                temporaryRoot.resolve("integration").toString(),
                "zhishu/integration/12345678/12345678",
                "RETAINED",
                "INTEGRATION_EXECUTION_FAILED",
                "Integration execution worker was unavailable.",
                null,
                null,
                null,
                "NONE",
                null,
                null,
                null,
                "NPM",
                "npm run build",
                "npm test",
                "user:test",
                Timestamp.from(now).toInstant(),
                null,
                now,
                false,
                List.<IntegrationExecutionView.StepView>of()
        );
    }
}
