package com.zhishu.runtime;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.zhishu.event.AttemptProjectionRepository;
import com.zhishu.event.AttemptProjectionState;
import com.zhishu.event.RuntimeLivenessObserver;
import com.zhishu.event.TaskLifecycleObserver;
import com.zhishu.task.AttemptStatus;
import com.zhishu.task.TaskRepository;
import com.zhishu.task.TaskStateMachine;

@Service
public class RuntimeLeaseService implements RuntimeLivenessObserver {

    static final String LOST_ERROR_CODE = "RUNTIME_LEASE_LOST";
    static final String LOST_REASON = "Runtime heartbeat lease expired after the UNKNOWN grace window";

    private final AttemptRuntimeHealthRepository health;
    private final AttemptProjectionRepository attempts;
    private final TaskRepository tasks;
    private final TaskStateMachine stateMachine;
    private final RuntimeLeaseProperties properties;
    private final Clock clock;
    private final List<TaskLifecycleObserver> lifecycleObservers;

    @Autowired
    public RuntimeLeaseService(
            AttemptRuntimeHealthRepository health,
            AttemptProjectionRepository attempts,
            TaskRepository tasks,
            TaskStateMachine stateMachine,
            RuntimeLeaseProperties properties,
            List<TaskLifecycleObserver> lifecycleObservers
    ) {
        this(health, attempts, tasks, stateMachine, properties, lifecycleObservers, Clock.systemUTC());
    }

    RuntimeLeaseService(
            AttemptRuntimeHealthRepository health,
            AttemptProjectionRepository attempts,
            TaskRepository tasks,
            TaskStateMachine stateMachine,
            RuntimeLeaseProperties properties,
            List<TaskLifecycleObserver> lifecycleObservers,
            Clock clock
    ) {
        this.health = health;
        this.attempts = attempts;
        this.tasks = tasks;
        this.stateMachine = stateMachine;
        this.properties = properties;
        this.clock = clock;
        this.lifecycleObservers = List.copyOf(lifecycleObservers);
    }

    RuntimeLeaseService(
            AttemptRuntimeHealthRepository health,
            AttemptProjectionRepository attempts,
            TaskRepository tasks,
            TaskStateMachine stateMachine,
            RuntimeLeaseProperties properties,
            Clock clock
    ) {
        this(health, attempts, tasks, stateMachine, properties,
                List.of(), clock);
    }

    /** Any authenticated event for the current run is proof that its process is still alive. */
    @Override
    public void observe(UUID attemptId, Instant occurredAt) {
        Instant now = clock.instant();
        Instant effectiveObservedAt = occurredAt.isAfter(now) ? now : occurredAt;
        Instant leaseExpiresAt = effectiveObservedAt.plus(properties.duration());
        if (!leaseExpiresAt.isAfter(now)) {
            return;
        }
        health.observe(attemptId, effectiveObservedAt, leaseExpiresAt);
    }

    /** Advances HEALTHY -> UNKNOWN -> LOST without collapsing a transient timeout into failure. */
    @Transactional
    public RuntimeLeaseSweepResult sweep() {
        Instant now = clock.instant();
        int unknown = health.markExpiredUnknown(now, now.minus(properties.duration()), now);
        Instant unknownCutoff = now.minus(properties.unknownGrace());
        int lost = 0;

        for (RuntimeLeaseCandidate candidate : health.findLostCandidates(unknownCutoff)) {
            AttemptProjectionState state = attempts.lock(candidate.attemptId()).orElse(null);
            if (state == null || state.status() != candidate.attemptStatus() || !isLeaseManaged(state.status())) {
                continue;
            }
            if (!stateMachine.canTransition(state.status(), AttemptStatus.LOST)) {
                continue;
            }
            if (!health.markLost(candidate.attemptId(), unknownCutoff, now, LOST_REASON)) {
                continue;
            }
            if (!attempts.transition(
                    candidate.attemptId(), state.status(), AttemptStatus.LOST,
                    now, LOST_ERROR_CODE, LOST_REASON
            )) {
                throw new IllegalStateException("Attempt status changed while declaring Runtime LOST: "
                        + candidate.attemptId());
            }
            tasks.updateStatusForAttempt(candidate.taskId(), candidate.attemptId(), AttemptStatus.LOST);
            for (TaskLifecycleObserver observer : lifecycleObservers) {
                observer.observe(candidate.taskId(), candidate.attemptId(), AttemptStatus.LOST);
            }
            lost += 1;
        }
        return new RuntimeLeaseSweepResult(unknown, lost);
    }

    private boolean isLeaseManaged(AttemptStatus status) {
        return status == AttemptStatus.STARTING
                || status == AttemptStatus.RUNNING
                || status == AttemptStatus.WAITING_APPROVAL
                || status == AttemptStatus.CANCELLING;
    }

    public record RuntimeLeaseSweepResult(int markedUnknown, int markedLost) {
    }
}
