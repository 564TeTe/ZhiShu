package com.zhishu.event;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.zhishu.task.AttemptEventReconciler;
import com.zhishu.task.AttemptStatus;
import com.zhishu.task.TaskRepository;
import com.zhishu.task.TaskStateMachine;

@Service
public class RuntimeEventProjector implements AttemptEventReconciler {

    private final TaskEventRepository events;
    private final AttemptProjectionRepository attempts;
    private final ApprovalProjectionRepository approvals;
    private final ArtifactProjectionRepository artifacts;
    private final TaskRepository tasks;
    private final TaskStateMachine stateMachine;
    private final RuntimeLivenessObserver leases;
    private final List<TaskLifecycleObserver> lifecycleObservers;
    private final Clock clock;

    @Autowired
    public RuntimeEventProjector(
            TaskEventRepository events,
            AttemptProjectionRepository attempts,
            ApprovalProjectionRepository approvals,
            ArtifactProjectionRepository artifacts,
            TaskRepository tasks,
            TaskStateMachine stateMachine,
            RuntimeLivenessObserver leases,
            List<TaskLifecycleObserver> lifecycleObservers
    ) {
        this(events, attempts, approvals, artifacts, tasks, stateMachine,
                leases, lifecycleObservers, Clock.systemUTC());
    }

    RuntimeEventProjector(
            TaskEventRepository events,
            AttemptProjectionRepository attempts,
            ApprovalProjectionRepository approvals,
            ArtifactProjectionRepository artifacts,
            TaskRepository tasks,
            TaskStateMachine stateMachine,
            RuntimeLivenessObserver leases,
            List<TaskLifecycleObserver> lifecycleObservers,
            Clock clock
    ) {
        this.events = events;
        this.attempts = attempts;
        this.approvals = approvals;
        this.artifacts = artifacts;
        this.tasks = tasks;
        this.stateMachine = stateMachine;
        this.leases = leases;
        this.lifecycleObservers = List.copyOf(lifecycleObservers);
        this.clock = clock;
    }

    RuntimeEventProjector(
            TaskEventRepository events,
            AttemptProjectionRepository attempts,
            ApprovalProjectionRepository approvals,
            ArtifactProjectionRepository artifacts,
            TaskRepository tasks,
            TaskStateMachine stateMachine,
            Clock clock
    ) {
        this(events, attempts, approvals, artifacts, tasks, stateMachine,
                (ignored, occurredAt) -> { }, List.of(), clock);
    }

    RuntimeEventProjector(
            TaskEventRepository events,
            AttemptProjectionRepository attempts,
            ApprovalProjectionRepository approvals,
            ArtifactProjectionRepository artifacts,
            TaskRepository tasks,
            TaskStateMachine stateMachine,
            RuntimeLivenessObserver leases,
            Clock clock
    ) {
        this(events, attempts, approvals, artifacts, tasks, stateMachine,
                leases, List.of(), clock);
    }

    @Override
    @Transactional
    public void reconcile(UUID attemptId) {
        AttemptProjectionState state = attempts.lock(attemptId)
                .orElseThrow(() -> new RuntimeEventRejectedException("Attempt was not found: " + attemptId));
        AttemptStatus current = state.status();

        for (StoredTaskEvent event : events.findUnprojected(attemptId)) {
            AttemptStatus target = targetStatus(event.eventType());
            // A Runtime event may beat the HTTP 202 response. Keep it in the inbox
            // until TaskOrchestrator has persisted PENDING -> STARTING.
            if (current == AttemptStatus.PENDING) {
                return;
            }
            if (!isTerminal(current)) {
                leases.observe(state.attemptId(), event.occurredAt());
            }
            if (target == null) {
                applySideEffect(event);
                events.markProjected(event.id(), clock.instant());
                continue;
            }
            if (current == target || isTerminal(current)) {
                events.markProjected(event.id(), clock.instant());
                continue;
            }

            // Cancel wins over an approval decision that was already in flight.
            // The Runtime may still report APPROVAL_RESOLVED before RUN_ABORTED;
            // consume that informational event without moving CANCELLING back to RUNNING.
            if (current == AttemptStatus.CANCELLING
                    && event.eventType() == RuntimeEventType.APPROVAL_RESOLVED) {
                applySideEffect(event);
                events.markProjected(event.id(), clock.instant());
                continue;
            }

            if (target == AttemptStatus.ABORTED && current != AttemptStatus.CANCELLING) {
                if (!stateMachine.canTransition(current, AttemptStatus.CANCELLING)) {
                    return;
                }
                transition(state, current, AttemptStatus.CANCELLING, event);
                current = AttemptStatus.CANCELLING;
            }

            if (!stateMachine.canTransition(current, target)) {
                // A missing lower sequence event may still arrive. Do not discard
                // the current event or advance later events out of order.
                return;
            }

            applySideEffect(event);
            transition(state, current, target, event);
            current = target;
            events.markProjected(event.id(), clock.instant());
        }
    }

    private void transition(
            AttemptProjectionState state,
            AttemptStatus expected,
            AttemptStatus target,
            StoredTaskEvent event
    ) {
        Instant completedAt = isTerminal(target) ? event.occurredAt() : null;
        String errorCode = target == AttemptStatus.FAILED
                ? payloadString(event.payload(), "errorCode", "RUNTIME_RUN_FAILED")
                : null;
        String errorMessage = target == AttemptStatus.FAILED
                ? payloadString(event.payload(), "message", "Runtime run failed")
                : null;
        if (!attempts.transition(state.attemptId(), expected, target, completedAt, errorCode, errorMessage)) {
            throw new IllegalStateException("Attempt status changed concurrently: " + state.attemptId());
        }
        tasks.updateStatusForAttempt(state.taskId(), state.attemptId(), target);
        for (TaskLifecycleObserver observer : lifecycleObservers) {
            observer.observe(state.taskId(), state.attemptId(), target);
        }
    }

    private void applySideEffect(StoredTaskEvent event) {
        if (event.eventType() == RuntimeEventType.APPROVAL_REQUIRED) {
            approvals.open(event);
        } else if (event.eventType() == RuntimeEventType.APPROVAL_RESOLVED) {
            approvals.resolve(event);
        } else if (event.eventType() == RuntimeEventType.ARTIFACT_PUBLISHED) {
            artifacts.publish(event);
        }
    }

    private AttemptStatus targetStatus(RuntimeEventType type) {
        return switch (type) {
            case RUN_STARTED -> AttemptStatus.RUNNING;
            case APPROVAL_REQUIRED -> AttemptStatus.WAITING_APPROVAL;
            case APPROVAL_RESOLVED -> AttemptStatus.RUNNING;
            case RUN_COMPLETED -> AttemptStatus.SUCCEEDED;
            case RUN_FAILED -> AttemptStatus.FAILED;
            case RUN_ABORTED -> AttemptStatus.ABORTED;
            case RUNTIME_HEARTBEAT, AGENT_STATUS, COMMAND_COMPLETED, ARTIFACT_PUBLISHED, ERROR -> null;
        };
    }

    private String payloadString(Map<String, Object> payload, String key, String fallback) {
        Object value = payload.get(key);
        return value instanceof String text && !text.isBlank() ? text : fallback;
    }

    private boolean isTerminal(AttemptStatus status) {
        return status == AttemptStatus.SUCCEEDED
                || status == AttemptStatus.FAILED
                || status == AttemptStatus.LOST
                || status == AttemptStatus.ABORTED;
    }
}
