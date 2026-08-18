package com.zhishu.task;

import java.time.Clock;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.zhishu.profile.AgentProfileSnapshot;
import com.zhishu.profile.Capability;
import com.zhishu.profile.ExecutorType;
import com.zhishu.runtime.RuntimeAccepted;
import com.zhishu.runtime.RuntimeClient;
import com.zhishu.runtime.RuntimeClientException;
import com.zhishu.runtime.RuntimeStartCommand;

@Service
public class TaskOrchestrator {

    private final TaskAttemptRepository attempts;
    private final TaskRepository tasks;
    private final RuntimeClient runtimeClient;
    private final TaskStateMachine stateMachine;
    private final AttemptEventReconciler eventReconciler;
    private final Clock clock;

    @Autowired
    public TaskOrchestrator(
            TaskAttemptRepository attempts,
            TaskRepository tasks,
            RuntimeClient runtimeClient,
            TaskStateMachine stateMachine,
            AttemptEventReconciler eventReconciler
    ) {
        this(attempts, tasks, runtimeClient, stateMachine, eventReconciler, Clock.systemUTC());
    }

    TaskOrchestrator(
            TaskAttemptRepository attempts,
            TaskRepository tasks,
            RuntimeClient runtimeClient,
            TaskStateMachine stateMachine,
            AttemptEventReconciler eventReconciler,
            Clock clock
    ) {
        this.attempts = attempts;
        this.tasks = tasks;
        this.runtimeClient = runtimeClient;
        this.stateMachine = stateMachine;
        this.eventReconciler = eventReconciler;
        this.clock = clock;
    }

    public TaskAttempt start(StartAttemptCommand command) {
        return dispatch(command, prepare(command));
    }

    public com.zhishu.approval.ApprovalPolicySnapshot approvalPolicyFor(UUID attemptId) {
        return attempts.findApprovalPolicySnapshot(attemptId)
                .orElseThrow(() -> new TaskNotFoundException("Approval policy snapshot was not found"));
    }

    public AgentProfileSnapshot profileFor(UUID attemptId) {
        return attempts.findProfileSnapshot(attemptId)
                .orElseThrow(() -> new TaskNotFoundException("Agent Profile snapshot was not found"));
    }

    public TaskAttempt restorePending(UUID attemptId) {
        return attempts.findPending(attemptId)
                .orElseThrow(() -> new InvalidTaskStateException(
                        "Attempt is not available for pending dispatch recovery"
                ));
    }

    /** Persists a PENDING attempt and attaches it before crossing the Runtime HTTP boundary. */
    public TaskAttempt prepare(StartAttemptCommand command) {
        Instant now = clock.instant();
        TaskAttempt attempt = TaskAttempt.pending(
                UUID.randomUUID(),
                command.taskId(),
                attempts.nextAttemptNumber(command.taskId()),
                command.profileSnapshot(),
                command.approvalPolicySnapshot(),
                now
        );

        // This repository call commits PENDING before the network boundary.
        // The orchestrator deliberately owns no transaction spanning Node HTTP.
        attempts.insert(attempt);
        tasks.attachAttempt(attempt.taskId(), attempt.id(), attempt.status());
        return attempt;
    }

    /** Starts a previously prepared attempt after its transaction has committed. */
    public TaskAttempt dispatch(StartAttemptCommand command, TaskAttempt attempt) {
        RuntimeStartCommand runtimeCommand = toRuntimeCommand(command, attempt);
        try {
            RuntimeAccepted accepted = runtimeClient.start(runtimeCommand);
            attempt.markStarting(accepted.runtimeRunId(), clock.instant(), stateMachine);
            attempts.update(attempt);
            tasks.updateStatusForAttempt(attempt.taskId(), attempt.id(), attempt.status());
            eventReconciler.reconcile(attempt.id());
            return attempt;
        } catch (RuntimeClientException error) {
            attempt.markFailed(error.code(), error.getMessage(), clock.instant(), stateMachine);
            attempts.update(attempt);
            tasks.updateStatusForAttempt(attempt.taskId(), attempt.id(), attempt.status());
            throw error;
        }
    }

    private RuntimeStartCommand toRuntimeCommand(StartAttemptCommand command, TaskAttempt attempt) {
        AgentProfileSnapshot profile = command.profileSnapshot();
        List<String> capabilities = sortedCapabilities(profile.capabilities());
        List<String> approvals = sortedCapabilities(profile.requireApprovalFor());
        String connectionRef = profile.connectionRef();
        if (connectionRef == null && profile.executor() == ExecutorType.CLAUDE
                && command.additionalContext() != null) {
            String legacyRef = String.valueOf(command.additionalContext().getOrDefault("connectionRef", "")).trim();
            connectionRef = legacyRef.isEmpty() ? null : legacyRef;
        }

        return new RuntimeStartCommand(
                "1.0",
                UUID.randomUUID().toString(),
                attempt.id() + ":start",
                attempt.taskId().toString(),
                attempt.id().toString(),
                command.projectRef(),
                profile.executor().wireValue(),
                profile.modelAlias(),
                connectionRef,
                command.objective(),
                capabilities,
                new RuntimeStartCommand.PermissionPolicy(
                        approvals,
                        command.approvalPolicySnapshot().mode(),
                        command.approvalPolicySnapshot().projectRoot(),
                        command.approvalPolicySnapshot().allowedDirectories(),
                        command.approvalPolicySnapshot().trustedCommands(),
                        command.approvalPolicySnapshot().approvalTimeoutSeconds()
                ),
                command.additionalContext() == null ? Map.of() : Map.copyOf(command.additionalContext())
        );
    }

    private List<String> sortedCapabilities(java.util.Set<Capability> values) {
        return values.stream()
                .map(Enum::name)
                .sorted(Comparator.naturalOrder())
                .toList();
    }
}
