package com.zhishu.task;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import com.zhishu.profile.AgentProfileSnapshot;
import com.zhishu.profile.Capability;
import com.zhishu.profile.ExecutorType;
import com.zhishu.runtime.RuntimeAccepted;

class TaskApplicationServiceTest {

    private static final Instant NOW = Instant.parse("2026-08-11T08:00:00Z");

    @Test
    void createsTaskAndReturnsAcceptedAttemptSnapshot() {
        UUID projectId = UUID.randomUUID();
        UUID profileId = UUID.randomUUID();
        InMemoryTaskRepository tasks = new InMemoryTaskRepository();
        InMemoryAttemptRepository attempts = new InMemoryAttemptRepository();
        ExecutionConfiguration configuration = new ExecutionConfiguration(
                projectId,
                profileId,
                "D:\\workspace\\demo",
                profile()
        );
        TaskOrchestrator orchestrator = new TaskOrchestrator(
                attempts,
                tasks,
                command -> new RuntimeAccepted("run-1", true),
                new TaskStateMachine(),
                ignored -> { },
                Clock.fixed(NOW, ZoneOffset.UTC)
        );
        TaskApplicationService service = new TaskApplicationService(
                tasks,
                (requestedProject, requestedProfile) -> Optional.of(configuration),
                orchestrator,
                Clock.fixed(NOW, ZoneOffset.UTC)
        );

        TaskView created = service.create(new CreateTaskCommand(
                projectId,
                profileId,
                "Run tests",
                "Inspect the project and run its tests.",
                Map.of()
        ));

        assertThat(created.status()).isEqualTo(AttemptStatus.STARTING);
        assertThat(created.runtimeRunId()).isEqualTo("run-1");
        assertThat(created.attemptNumber()).isEqualTo(1);
        assertThat(created.projectId()).isEqualTo(projectId);
    }

    @Test
    void rejectsUnknownProjectProfileBeforeCreatingTask() {
        InMemoryTaskRepository tasks = new InMemoryTaskRepository();
        TaskApplicationService service = new TaskApplicationService(
                tasks,
                (projectId, profileId) -> Optional.empty(),
                null,
                Clock.fixed(NOW, ZoneOffset.UTC)
        );

        assertThatThrownBy(() -> service.create(new CreateTaskCommand(
                UUID.randomUUID(), UUID.randomUUID(), "Task", "Objective", Map.of()
        ))).isInstanceOf(TaskNotFoundException.class);
        assertThat(tasks.task).isNull();
    }

    @Test
    void codexOverrideCreatesControlledWriteAttemptSnapshot() {
        UUID projectId = UUID.randomUUID();
        UUID profileId = UUID.randomUUID();
        InMemoryTaskRepository tasks = new InMemoryTaskRepository();
        InMemoryAttemptRepository attempts = new InMemoryAttemptRepository();
        ExecutionConfiguration configuration = new ExecutionConfiguration(
                projectId,
                profileId,
                "D:\\workspace\\demo",
                new AgentProfileSnapshot(
                        ExecutorType.CLAUDE,
                        "conn-claude",
                        "claude-sonnet",
                        Set.of(Capability.READ_FILE, Capability.SEARCH_CODE, Capability.WRITE_FILE, Capability.SHELL),
                        Set.of(Capability.WRITE_FILE, Capability.SHELL),
                        600,
                        "task-v1"
                )
        );
        TaskOrchestrator orchestrator = new TaskOrchestrator(
                attempts,
                tasks,
                command -> new RuntimeAccepted("run-codex", true),
                new TaskStateMachine(),
                ignored -> { },
                Clock.fixed(NOW, ZoneOffset.UTC)
        );
        TaskApplicationService service = new TaskApplicationService(
                tasks,
                (requestedProject, requestedProfile) -> Optional.of(configuration),
                orchestrator,
                Clock.fixed(NOW, ZoneOffset.UTC)
        );

        service.create(new CreateTaskCommand(
                projectId,
                profileId,
                "Review",
                "Review the project without changes.",
                "conn-ignored",
                ExecutorType.CODEX,
                "gpt-5",
                Map.of()
        ));

        AgentProfileSnapshot snapshot = attempts.attempt.profileSnapshot();
        assertThat(snapshot.executor()).isEqualTo(ExecutorType.CODEX);
        assertThat(snapshot.modelAlias()).isEqualTo("gpt-5");
        assertThat(snapshot.connectionRef()).isNull();
        assertThat(snapshot.capabilities()).containsExactlyInAnyOrder(
                Capability.READ_FILE, Capability.WRITE_FILE, Capability.SEARCH_CODE, Capability.SHELL
        );
        assertThat(snapshot.requireApprovalFor()).containsExactlyInAnyOrder(Capability.WRITE_FILE, Capability.SHELL);
    }

    @Test
    void changingExecutorWithoutModelDoesNotReuseClaudeModel() {
        UUID projectId = UUID.randomUUID();
        UUID profileId = UUID.randomUUID();
        InMemoryTaskRepository tasks = new InMemoryTaskRepository();
        InMemoryAttemptRepository attempts = new InMemoryAttemptRepository();
        ExecutionConfiguration configuration = new ExecutionConfiguration(
                projectId,
                profileId,
                "D:\\workspace\\demo",
                new AgentProfileSnapshot(
                        ExecutorType.CLAUDE,
                        "conn-claude",
                        "claude-sonnet",
                        Set.of(Capability.READ_FILE, Capability.SEARCH_CODE),
                        Set.of(),
                        600,
                        "task-v1"
                )
        );
        TaskOrchestrator orchestrator = new TaskOrchestrator(
                attempts,
                tasks,
                command -> new RuntimeAccepted("run-opencode", true),
                new TaskStateMachine(),
                ignored -> { },
                Clock.fixed(NOW, ZoneOffset.UTC)
        );
        TaskApplicationService service = new TaskApplicationService(
                tasks,
                (requestedProject, requestedProfile) -> Optional.of(configuration),
                orchestrator,
                Clock.fixed(NOW, ZoneOffset.UTC)
        );

        service.create(new CreateTaskCommand(
                projectId,
                profileId,
                "Review",
                "Review the project without changes.",
                null,
                ExecutorType.OPENCODE,
                null,
                Map.of()
        ));

        AgentProfileSnapshot snapshot = attempts.attempt.profileSnapshot();
        assertThat(snapshot.executor()).isEqualTo(ExecutorType.OPENCODE);
        assertThat(snapshot.modelAlias()).isNull();
        assertThat(snapshot.connectionRef()).isNull();
    }

    @Test
    void archivesTerminalTask() {
        UUID taskId = UUID.randomUUID();
        InMemoryTaskRepository tasks = taskRepositoryWithStatus(taskId, AttemptStatus.SUCCEEDED);
        TaskApplicationService service = new TaskApplicationService(
                tasks,
                (projectId, profileId) -> Optional.empty(),
                null,
                Clock.fixed(NOW, ZoneOffset.UTC)
        );

        service.delete(taskId);

        assertThat(tasks.findById(taskId)).isEmpty();
        assertThat(tasks.findIncludingArchivedById(taskId)).get().satisfies(task -> {
            assertThat(task.archivedAt()).isEqualTo(NOW);
            assertThat(task.archivedBy()).isEqualTo("legacy-control-v1");
        });
    }

    @Test
    void rejectsDeletingActiveTask() {
        UUID taskId = UUID.randomUUID();
        InMemoryTaskRepository tasks = taskRepositoryWithStatus(taskId, AttemptStatus.RUNNING);
        TaskApplicationService service = new TaskApplicationService(
                tasks,
                (projectId, profileId) -> Optional.empty(),
                null,
                Clock.fixed(NOW, ZoneOffset.UTC)
        );

        assertThatThrownBy(() -> service.delete(taskId))
                .isInstanceOf(InvalidTaskStateException.class)
                .hasMessageContaining("current status is RUNNING");
        assertThat(tasks.findById(taskId)).isPresent();
    }

    private InMemoryTaskRepository taskRepositoryWithStatus(UUID taskId, AttemptStatus status) {
        InMemoryTaskRepository tasks = new InMemoryTaskRepository();
        tasks.insert(new AgentTask(
                taskId,
                UUID.randomUUID(),
                UUID.randomUUID(),
                "Task",
                "Objective",
                status,
                null,
                NOW
        ));
        tasks.status = status;
        return tasks;
    }

    private AgentProfileSnapshot profile() {
        return new AgentProfileSnapshot(
                ExecutorType.CLAUDE,
                null,
                Set.of(Capability.READ_FILE, Capability.TEST),
                Set.of(),
                600,
                "task-v1"
        );
    }

    private static final class InMemoryAttemptRepository implements TaskAttemptRepository {
        private TaskAttempt attempt;

        @Override public int nextAttemptNumber(UUID taskId) { return 1; }
        @Override public void insert(TaskAttempt attempt) { this.attempt = attempt; }
        @Override public void update(TaskAttempt attempt) { this.attempt = attempt; }
    }

    private static final class InMemoryTaskRepository implements TaskRepository {
        private AgentTask task;
        private UUID attemptId;
        private AttemptStatus status;
        private TaskAttempt attempt;
        private Instant archivedAt;
        private String archivedBy;
        private String archiveReason;

        @Override
        public void insert(AgentTask task) {
            this.task = task;
            this.status = task.status();
        }

        @Override
        public void attachAttempt(UUID taskId, UUID attemptId, AttemptStatus status) {
            this.attemptId = attemptId;
            this.status = status;
        }

        @Override
        public void updateStatusForAttempt(UUID taskId, UUID attemptId, AttemptStatus status) {
            this.status = status;
        }

        @Override
        public boolean archiveIfTerminal(UUID taskId, String actor, String reason) {
            if (task == null || !task.id().equals(taskId)) {
                return false;
            }
            if (status != AttemptStatus.SUCCEEDED
                    && status != AttemptStatus.FAILED
                    && status != AttemptStatus.LOST
                    && status != AttemptStatus.ABORTED) {
                return false;
            }
            archivedAt = NOW;
            archivedBy = actor;
            archiveReason = reason;
            return true;
        }

        @Override
        public Optional<TaskView> findById(UUID taskId) {
            if (archivedAt != null) {
                return Optional.empty();
            }
            return findIncludingArchivedById(taskId);
        }

        @Override
        public Optional<TaskView> findIncludingArchivedById(UUID taskId) {
            if (task == null || !task.id().equals(taskId)) {
                return Optional.empty();
            }
            return Optional.of(view());
        }

        @Override
        public Optional<TaskView> findByProjectAndId(UUID projectId, UUID taskId) {
            if (task == null || !task.id().equals(taskId) || !task.projectId().equals(projectId)) {
                return Optional.empty();
            }
            return Optional.of(view());
        }

        private TaskView view() {
            return Optional.of(new TaskView(
                    task.id(),
                    task.projectId(),
                    task.profileId(),
                    task.title(),
                    task.objective(),
                    status,
                    ResolutionStatus.fromAttemptStatus(status),
                    attemptId,
                    attemptId == null ? null : 1,
                    status == AttemptStatus.STARTING ? "run-1" : null,
                    com.zhishu.runtime.RuntimeHealthStatus.NOT_MONITORED,
                    null,
                    null,
                    null,
                    null,
                    null,
                    task.createdAt(),
                    status == AttemptStatus.STARTING ? NOW : null,
                    null,
                    null,
                    null,
                    archivedAt,
                    archivedBy,
                    archiveReason
            )).orElseThrow();
        }
    }
}
