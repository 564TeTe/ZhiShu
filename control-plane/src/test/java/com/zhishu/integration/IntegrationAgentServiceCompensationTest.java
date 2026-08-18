package com.zhishu.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.function.Consumer;

import org.junit.jupiter.api.Test;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.TransactionTemplate;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.zhishu.approval.ApprovalPolicySnapshot;
import com.zhishu.profile.AgentProfileSnapshot;
import com.zhishu.profile.ExecutorType;
import com.zhishu.task.TaskApplicationService;
import com.zhishu.task.TaskAttempt;
import com.zhishu.state.ProjectStateConflictException;

class IntegrationAgentServiceCompensationTest {

    @Test
    void dispatchFailureMarksAgentFailedAndKeepsPreparedTaskBinding() throws Exception {
        JdbcTemplate jdbc = org.mockito.Mockito.mock(JdbcTemplate.class);
        TransactionTemplate transactions = org.mockito.Mockito.mock(TransactionTemplate.class);
        TaskApplicationService tasks = org.mockito.Mockito.mock(TaskApplicationService.class);
        UUID projectId = UUID.randomUUID();
        UUID planId = UUID.randomUUID();
        UUID gateId = UUID.randomUUID();
        UUID integrationRunId = UUID.randomUUID();
        UUID agentRunId = UUID.randomUUID();
        UUID profileId = UUID.randomUUID();
        UUID taskId = UUID.randomUUID();
        UUID attemptId = UUID.randomUUID();
        AgentProfileSnapshot snapshot = new AgentProfileSnapshot(
                ExecutorType.CLAUDE, null, null, java.util.Set.of(), java.util.Set.of(), 60, "test"
        );
        TaskAttempt attempt = TaskAttempt.pending(
                attemptId, taskId, 1, snapshot,
                ApprovalPolicySnapshot.manual("C:\\isolated\\agent"), Instant.now()
        );
        TaskApplicationService.PreparedTask prepared = new TaskApplicationService.PreparedTask(
                taskId, attempt, null
        );
        Object claim = agentClaim(agentRunId, profileId, taskId, false);
        IntegrationAgentRunView failedView = new IntegrationAgentRunView(
                agentRunId, projectId, gateId, integrationRunId, profileId, taskId, attemptId,
                "FAILED", "repair", "user:test", Instant.now(), Instant.now(), Instant.now(),
                "runtime dispatch failed", false
        );

        when(transactions.execute(any())).thenReturn(claim);
        doAnswer(invocation -> {
            @SuppressWarnings("unchecked")
            Consumer<TransactionStatus> callback = invocation.getArgument(0);
            callback.accept(null);
            return null;
        }).when(transactions).executeWithoutResult(any());
        when(jdbc.update(anyString(), any(Object[].class))).thenReturn(1);
        when(tasks.prepareInWorkspace(any(), anyString())).thenReturn(prepared);
        when(tasks.dispatch(prepared)).thenThrow(new IllegalStateException("runtime dispatch failed"));

        IntegrationAgentService service = spy(new IntegrationAgentService(
                jdbc, transactions, new ObjectMapper(), tasks
        ));
        doReturn(failedView).when(service).get(
                projectId, planId, gateId, integrationRunId, agentRunId, false
        );

        IntegrationAgentRunView result = service.start(
                projectId, planId, gateId, integrationRunId, "user:test", "agent-request-1", profileId
        );

        assertThat(result.status()).isEqualTo("FAILED");
        assertThat(result.taskId()).isEqualTo(taskId);
        assertThat(result.attemptId()).isEqualTo(attemptId);
        verify(jdbc).update(
                org.mockito.ArgumentMatchers.contains("SET task_id = COALESCE"),
                eq(taskId), eq(attemptId), anyString(), eq(agentRunId)
        );
        verify(jdbc).update(
                org.mockito.ArgumentMatchers.contains("INTEGRATION_AGENT_FAILED"),
                any(Object[].class)
        );
    }

    @Test
    void requestHashBindsThePlanId() {
        UUID projectId = UUID.randomUUID();
        UUID gateId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        UUID planA = UUID.randomUUID();
        UUID planB = UUID.randomUUID();

        assertThat(IntegrationAgentService.requestHash(projectId, planA, gateId, runId, null))
                .isNotEqualTo(IntegrationAgentService.requestHash(projectId, planB, gateId, runId, null));
    }

    @Test
    void getRejectsAnAgentRunWhenTheExecutionBelongsToAnotherPlan() {
        JdbcTemplate jdbc = org.mockito.Mockito.mock(JdbcTemplate.class);
        when(jdbc.queryForMap(anyString(), any(Object[].class)))
                .thenThrow(new EmptyResultDataAccessException(1));
        IntegrationAgentService service = new IntegrationAgentService(
                jdbc,
                org.mockito.Mockito.mock(TransactionTemplate.class),
                new ObjectMapper(),
                org.mockito.Mockito.mock(TaskApplicationService.class)
        );
        UUID projectId = UUID.randomUUID();
        UUID planId = UUID.randomUUID();
        UUID gateId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        UUID agentRunId = UUID.randomUUID();

        org.assertj.core.api.Assertions.assertThatThrownBy(() -> service.get(
                projectId, planId, gateId, runId, agentRunId, false
        )).isInstanceOf(ProjectStateConflictException.class);
        verify(jdbc).queryForMap(
                org.mockito.ArgumentMatchers.contains("execution.plan_id = ?"),
                eq(planId), eq(agentRunId), eq(projectId), eq(gateId), eq(runId)
        );
    }

    private Object agentClaim(UUID agentRunId, UUID profileId, UUID taskId, boolean replayed) throws Exception {
        Class<?> type = Class.forName("com.zhishu.integration.IntegrationAgentService$AgentClaim");
        var constructor = type.getDeclaredConstructor(
                UUID.class, UUID.class, Path.class, String.class, UUID.class, boolean.class
        );
        constructor.setAccessible(true);
        return constructor.newInstance(
                agentRunId, profileId, Path.of("C:\\isolated\\agent"), "repair", taskId, replayed
        );
    }
}
