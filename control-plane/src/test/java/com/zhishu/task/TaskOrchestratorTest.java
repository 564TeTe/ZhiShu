package com.zhishu.task;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import com.zhishu.profile.AgentProfileSnapshot;
import com.zhishu.profile.Capability;
import com.zhishu.profile.ExecutorType;
import com.zhishu.runtime.RuntimeAccepted;
import com.zhishu.runtime.RuntimeClient;
import com.zhishu.runtime.RuntimeClientException;
import com.zhishu.runtime.RuntimeStartCommand;

class TaskOrchestratorTest {

    private static final Instant NOW = Instant.parse("2026-08-11T00:00:00Z");

    @Test
    void persistsPendingBeforeCallingRuntimeAndMovesToStartingOnlyAfter202Acceptance() {
        RecordingAttemptRepository repository = new RecordingAttemptRepository(2);
        RecordingTaskRepository taskRepository = new RecordingTaskRepository();
        RecordingRuntimeClient runtimeClient = new RecordingRuntimeClient(repository);
        TaskOrchestrator orchestrator = new TaskOrchestrator(
                repository,
                taskRepository,
                runtimeClient,
                new TaskStateMachine(),
                ignored -> { },
                Clock.fixed(NOW, ZoneOffset.UTC)
        );

        UUID taskId = UUID.randomUUID();
        TaskAttempt result = orchestrator.start(command(taskId));

        assertThat(runtimeClient.statusObservedAtCall).isEqualTo(AttemptStatus.PENDING);
        assertThat(repository.operations).containsExactly("insert:PENDING", "update:STARTING");
        assertThat(taskRepository.operations).containsExactly("attach:PENDING", "update:STARTING");
        assertThat(result.attemptNumber()).isEqualTo(2);
        assertThat(result.status()).isEqualTo(AttemptStatus.STARTING);
        assertThat(result.runtimeRunId()).isEqualTo("run-node-1");
        assertThat(runtimeClient.command.idempotencyKey()).isEqualTo(result.id() + ":start");
        assertThat(runtimeClient.command.executor()).isEqualTo("claude");
        assertThat(runtimeClient.command.capabilities())
                .containsExactly("READ_FILE", "TEST", "WRITE_FILE");
        assertThat(runtimeClient.command.permissionPolicy().requireApprovalFor())
                .containsExactly("WRITE_FILE");
    }

    @Test
    void recordsFailedAttemptWhenNodeCannotAcceptStart() {
        RecordingAttemptRepository repository = new RecordingAttemptRepository(1);
        RecordingTaskRepository taskRepository = new RecordingTaskRepository();
        RuntimeClient failingClient = command -> {
            throw new RuntimeClientException("RUNTIME_UNAVAILABLE", "Node is offline");
        };
        TaskOrchestrator orchestrator = new TaskOrchestrator(
                repository,
                taskRepository,
                failingClient,
                new TaskStateMachine(),
                ignored -> { },
                Clock.fixed(NOW, ZoneOffset.UTC)
        );

        assertThatThrownBy(() -> orchestrator.start(command(UUID.randomUUID())))
                .isInstanceOf(RuntimeClientException.class)
                .hasMessage("Node is offline");

        assertThat(repository.operations).containsExactly("insert:PENDING", "update:FAILED");
        assertThat(taskRepository.operations).containsExactly("attach:PENDING", "update:FAILED");
        assertThat(repository.lastAttempt.errorCode()).isEqualTo("RUNTIME_UNAVAILABLE");
        assertThat(repository.lastAttempt.completedAt()).isEqualTo(NOW);
    }

    private static final class RecordingTaskRepository implements TaskRepository {
        private final List<String> operations = new ArrayList<>();

        @Override
        public void insert(AgentTask task) {
            operations.add("insert:" + task.status());
        }

        @Override
        public void attachAttempt(UUID taskId, UUID attemptId, AttemptStatus status) {
            operations.add("attach:" + status);
        }

        @Override
        public void updateStatusForAttempt(UUID taskId, UUID attemptId, AttemptStatus status) {
            operations.add("update:" + status);
        }

        @Override
        public Optional<TaskView> findById(UUID taskId) {
            return Optional.empty();
        }
    }

    private StartAttemptCommand command(UUID taskId) {
        AgentProfileSnapshot snapshot = new AgentProfileSnapshot(
                ExecutorType.CLAUDE,
                "primary-coding",
                Set.of(Capability.READ_FILE, Capability.WRITE_FILE, Capability.TEST),
                Set.of(Capability.WRITE_FILE),
                600,
                "task-v1"
        );
        return new StartAttemptCommand(
                taskId,
                "D:\\workspace\\calculator-java",
                "修复 divide 方法并运行测试",
                snapshot,
                Map.of("historySummary", "第一次执行")
        );
    }

    private static final class RecordingAttemptRepository implements TaskAttemptRepository {
        private final int nextAttemptNumber;
        private final List<String> operations = new ArrayList<>();
        private TaskAttempt lastAttempt;

        private RecordingAttemptRepository(int nextAttemptNumber) {
            this.nextAttemptNumber = nextAttemptNumber;
        }

        @Override
        public int nextAttemptNumber(UUID taskId) {
            return nextAttemptNumber;
        }

        @Override
        public void insert(TaskAttempt attempt) {
            lastAttempt = attempt;
            operations.add("insert:" + attempt.status());
        }

        @Override
        public void update(TaskAttempt attempt) {
            lastAttempt = attempt;
            operations.add("update:" + attempt.status());
        }
    }

    private static final class RecordingRuntimeClient implements RuntimeClient {
        private final RecordingAttemptRepository repository;
        private AttemptStatus statusObservedAtCall;
        private RuntimeStartCommand command;

        private RecordingRuntimeClient(RecordingAttemptRepository repository) {
            this.repository = repository;
        }

        @Override
        public RuntimeAccepted start(RuntimeStartCommand command) {
            this.command = command;
            this.statusObservedAtCall = repository.lastAttempt.status();
            return new RuntimeAccepted("run-node-1", true);
        }
    }
}
