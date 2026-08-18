package com.zhishu.event;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import com.zhishu.task.AgentTask;
import com.zhishu.task.AttemptStatus;
import com.zhishu.task.TaskRepository;
import com.zhishu.task.TaskStateMachine;
import com.zhishu.task.TaskView;

class RuntimeEventProjectorTest {

    private static final Instant NOW = Instant.parse("2026-08-11T08:00:00Z");

    @Test
    void defersRunStartedThatArrivesBeforeHttpAcceptanceThenReplaysIt() {
        UUID taskId = UUID.randomUUID();
        UUID attemptId = UUID.randomUUID();
        InMemoryEvents events = new InMemoryEvents(List.of(event(1, taskId, attemptId, RuntimeEventType.RUN_STARTED)));
        InMemoryAttemptProjection attempts = new InMemoryAttemptProjection(taskId, attemptId, AttemptStatus.PENDING);
        RecordingTasks tasks = new RecordingTasks();
        RuntimeEventProjector projector = projector(events, attempts, tasks);

        projector.reconcile(attemptId);

        assertThat(attempts.status).isEqualTo(AttemptStatus.PENDING);
        assertThat(events.projected).isEmpty();

        attempts.status = AttemptStatus.STARTING;
        projector.reconcile(attemptId);

        assertThat(attempts.status).isEqualTo(AttemptStatus.RUNNING);
        assertThat(events.projected).containsExactly(1L);
        assertThat(tasks.statuses).containsExactly(AttemptStatus.RUNNING);
    }

    @Test
    void projectsOrderedLifecycleAndKeepsTaskStatusInSync() {
        UUID taskId = UUID.randomUUID();
        UUID attemptId = UUID.randomUUID();
        InMemoryEvents events = new InMemoryEvents(List.of(
                event(1, taskId, attemptId, RuntimeEventType.RUN_STARTED),
                approvalEvent(2, taskId, attemptId, RuntimeEventType.APPROVAL_REQUIRED),
                approvalEvent(3, taskId, attemptId, RuntimeEventType.APPROVAL_RESOLVED),
                event(4, taskId, attemptId, RuntimeEventType.RUN_COMPLETED)
        ));
        InMemoryAttemptProjection attempts = new InMemoryAttemptProjection(taskId, attemptId, AttemptStatus.STARTING);
        RecordingTasks tasks = new RecordingTasks();

        projector(events, attempts, tasks).reconcile(attemptId);

        assertThat(attempts.status).isEqualTo(AttemptStatus.SUCCEEDED);
        assertThat(events.projected).containsExactly(1L, 2L, 3L, 4L);
        assertThat(tasks.statuses).containsExactly(
                AttemptStatus.RUNNING,
                AttemptStatus.WAITING_APPROVAL,
                AttemptStatus.RUNNING,
                AttemptStatus.SUCCEEDED
        );
    }

    @Test
    void cancellationWinsOverLateApprovalResolutionAndDoesNotBlockRunAborted() {
        UUID taskId = UUID.randomUUID();
        UUID attemptId = UUID.randomUUID();
        InMemoryEvents events = new InMemoryEvents(List.of(
                approvalEvent(1, taskId, attemptId, RuntimeEventType.APPROVAL_RESOLVED),
                event(2, taskId, attemptId, RuntimeEventType.RUN_ABORTED)
        ));
        InMemoryAttemptProjection attempts = new InMemoryAttemptProjection(
                taskId, attemptId, AttemptStatus.CANCELLING
        );
        RecordingTasks tasks = new RecordingTasks();

        projector(events, attempts, tasks).reconcile(attemptId);

        assertThat(attempts.status).isEqualTo(AttemptStatus.ABORTED);
        assertThat(events.projected).containsExactly(1L, 2L);
        assertThat(tasks.statuses).containsExactly(AttemptStatus.ABORTED);
    }

    @Test
    void publishesArtifactAsInformationalSideEffectWithoutChangingAttemptStatus() {
        UUID taskId = UUID.randomUUID();
        UUID attemptId = UUID.randomUUID();
        StoredTaskEvent artifact = new StoredTaskEvent(
                1, "event-1", taskId, attemptId, "run-1", 1,
                RuntimeEventType.ARTIFACT_PUBLISHED,
                Map.of("artifactId", UUID.randomUUID().toString(), "artifactType", "SUMMARY"),
                NOW, NOW
        );
        InMemoryEvents events = new InMemoryEvents(List.of(artifact));
        InMemoryAttemptProjection attempts = new InMemoryAttemptProjection(
                taskId, attemptId, AttemptStatus.RUNNING
        );
        RecordingTasks tasks = new RecordingTasks();
        List<StoredTaskEvent> published = new ArrayList<>();
        ApprovalProjectionRepository approvals = new ApprovalProjectionRepository() {
            @Override public void open(StoredTaskEvent event) { }
            @Override public void resolve(StoredTaskEvent event) { }
        };
        RuntimeEventProjector projector = new RuntimeEventProjector(
                events, attempts, approvals, published::add, tasks,
                new TaskStateMachine(), Clock.fixed(NOW, ZoneOffset.UTC)
        );

        projector.reconcile(attemptId);

        assertThat(published).containsExactly(artifact);
        assertThat(attempts.status).isEqualTo(AttemptStatus.RUNNING);
        assertThat(events.projected).containsExactly(1L);
        assertThat(tasks.statuses).isEmpty();
    }

    @Test
    void heartbeatRenewsLivenessBeforeInformationalEventIsProjected() {
        UUID taskId = UUID.randomUUID();
        UUID attemptId = UUID.randomUUID();
        StoredTaskEvent heartbeat = event(1, taskId, attemptId, RuntimeEventType.RUNTIME_HEARTBEAT);
        InMemoryEvents events = new InMemoryEvents(List.of(heartbeat));
        InMemoryAttemptProjection attempts = new InMemoryAttemptProjection(
                taskId, attemptId, AttemptStatus.RUNNING
        );
        List<UUID> observed = new ArrayList<>();
        RuntimeEventProjector projector = new RuntimeEventProjector(
                events,
                attempts,
                new ApprovalProjectionRepository() {
                    @Override public void open(StoredTaskEvent event) { }
                    @Override public void resolve(StoredTaskEvent event) { }
                },
                event -> { },
                new RecordingTasks(),
                new TaskStateMachine(),
                (id, occurredAt) -> observed.add(id),
                Clock.fixed(NOW, ZoneOffset.UTC)
        );

        projector.reconcile(attemptId);

        assertThat(observed).containsExactly(attemptId);
        assertThat(events.projected).containsExactly(1L);
        assertThat(attempts.status).isEqualTo(AttemptStatus.RUNNING);
    }

    @Test
    void notifiesEveryLifecycleObserverAfterTheAttemptAndTaskTransition() {
        UUID taskId = UUID.randomUUID();
        UUID attemptId = UUID.randomUUID();
        InMemoryEvents events = new InMemoryEvents(List.of(
                event(1, taskId, attemptId, RuntimeEventType.RUN_COMPLETED)
        ));
        InMemoryAttemptProjection attempts = new InMemoryAttemptProjection(
                taskId, attemptId, AttemptStatus.RUNNING
        );
        List<String> observed = new ArrayList<>();
        RuntimeEventProjector projector = new RuntimeEventProjector(
                events,
                attempts,
                new ApprovalProjectionRepository() {
                    @Override public void open(StoredTaskEvent event) { }
                    @Override public void resolve(StoredTaskEvent event) { }
                },
                event -> { },
                new RecordingTasks(),
                new TaskStateMachine(),
                (id, occurredAt) -> { },
                List.of(
                        (task, attempt, status) -> observed.add("first:" + status),
                        (task, attempt, status) -> observed.add("second:" + status)
                ),
                Clock.fixed(NOW, ZoneOffset.UTC)
        );

        projector.reconcile(attemptId);

        assertThat(observed).containsExactly("first:SUCCEEDED", "second:SUCCEEDED");
    }

    private RuntimeEventProjector projector(
            InMemoryEvents events,
            InMemoryAttemptProjection attempts,
            RecordingTasks tasks
    ) {
        ApprovalProjectionRepository approvals = new ApprovalProjectionRepository() {
            @Override public void open(StoredTaskEvent event) { }
            @Override public void resolve(StoredTaskEvent event) { }
        };
        ArtifactProjectionRepository artifacts = event -> { };
        return new RuntimeEventProjector(
                events,
                attempts,
                approvals,
                artifacts,
                tasks,
                new TaskStateMachine(),
                Clock.fixed(NOW, ZoneOffset.UTC)
        );
    }

    private StoredTaskEvent event(
            long id,
            UUID taskId,
            UUID attemptId,
            RuntimeEventType type
    ) {
        return new StoredTaskEvent(
                id, "event-" + id, taskId, attemptId, "run-1", id, type, Map.of(), NOW, NOW
        );
    }

    private StoredTaskEvent approvalEvent(
            long id,
            UUID taskId,
            UUID attemptId,
            RuntimeEventType type
    ) {
        return new StoredTaskEvent(
                id,
                "event-" + id,
                taskId,
                attemptId,
                "run-1",
                id,
                type,
                Map.of(
                        "runtimeApprovalId", "approval-1",
                        "toolName", "Write",
                        "decision", "APPROVED"
                ),
                NOW,
                NOW
        );
    }

    private static final class InMemoryEvents implements TaskEventRepository {
        private final List<StoredTaskEvent> values;
        private final List<Long> projected = new ArrayList<>();

        private InMemoryEvents(List<StoredTaskEvent> values) {
            this.values = values;
        }

        @Override public boolean attemptMatches(UUID taskId, UUID attemptId, String runtimeRunId) { return true; }
        @Override public boolean insertIfAbsent(RuntimeEvent event) { return true; }

        @Override
        public List<StoredTaskEvent> findUnprojected(UUID attemptId) {
            return values.stream().filter(value -> !projected.contains(value.id())).toList();
        }

        @Override public void markProjected(long eventDatabaseId, Instant projectedAt) { projected.add(eventDatabaseId); }
        @Override public List<StoredTaskEvent> findAfter(UUID taskId, long afterId, int limit) { return List.of(); }
    }

    private static final class InMemoryAttemptProjection implements AttemptProjectionRepository {
        private final UUID taskId;
        private final UUID attemptId;
        private AttemptStatus status;

        private InMemoryAttemptProjection(UUID taskId, UUID attemptId, AttemptStatus status) {
            this.taskId = taskId;
            this.attemptId = attemptId;
            this.status = status;
        }

        @Override
        public Optional<AttemptProjectionState> lock(UUID ignored) {
            return Optional.of(new AttemptProjectionState(attemptId, taskId, status));
        }

        @Override
        public boolean transition(
                UUID ignored,
                AttemptStatus expected,
                AttemptStatus target,
                Instant completedAt,
                String errorCode,
                String errorMessage
        ) {
            if (status != expected) {
                return false;
            }
            status = target;
            return true;
        }
    }

    private static final class RecordingTasks implements TaskRepository {
        private final List<AttemptStatus> statuses = new ArrayList<>();
        private final Map<UUID, TaskView> views = new HashMap<>();

        @Override public void insert(AgentTask task) { }
        @Override public void attachAttempt(UUID taskId, UUID attemptId, AttemptStatus status) { }
        @Override public void updateStatusForAttempt(UUID taskId, UUID attemptId, AttemptStatus status) {
            statuses.add(status);
        }
        @Override public Optional<TaskView> findById(UUID taskId) { return Optional.ofNullable(views.get(taskId)); }
    }
}
