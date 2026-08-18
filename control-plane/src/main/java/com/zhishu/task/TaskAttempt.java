package com.zhishu.task;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

import com.zhishu.profile.AgentProfileSnapshot;
import com.zhishu.approval.ApprovalPolicySnapshot;

public final class TaskAttempt {

    private final UUID id;
    private final UUID taskId;
    private final int attemptNumber;
    private final AgentProfileSnapshot profileSnapshot;
    private final ApprovalPolicySnapshot approvalPolicySnapshot;
    private final Instant createdAt;
    private AttemptStatus status;
    private String runtimeRunId;
    private Instant startedAt;
    private Instant completedAt;
    private String errorCode;
    private String errorMessage;

    private TaskAttempt(
            UUID id,
            UUID taskId,
            int attemptNumber,
            AgentProfileSnapshot profileSnapshot,
            ApprovalPolicySnapshot approvalPolicySnapshot,
            Instant createdAt
    ) {
        this.id = Objects.requireNonNull(id, "id");
        this.taskId = Objects.requireNonNull(taskId, "taskId");
        this.attemptNumber = attemptNumber;
        this.profileSnapshot = Objects.requireNonNull(profileSnapshot, "profileSnapshot");
        this.approvalPolicySnapshot = Objects.requireNonNull(approvalPolicySnapshot, "approvalPolicySnapshot");
        this.createdAt = Objects.requireNonNull(createdAt, "createdAt");
        this.status = AttemptStatus.PENDING;
    }

    public static TaskAttempt pending(
            UUID id,
            UUID taskId,
            int attemptNumber,
            AgentProfileSnapshot snapshot,
            ApprovalPolicySnapshot approvalPolicySnapshot,
            Instant createdAt
    ) {
        if (attemptNumber <= 0) {
            throw new IllegalArgumentException("attemptNumber must be positive");
        }
        return new TaskAttempt(id, taskId, attemptNumber, snapshot, approvalPolicySnapshot, createdAt);
    }

    public static TaskAttempt pending(
            UUID id, UUID taskId, int attemptNumber, AgentProfileSnapshot snapshot, Instant createdAt
    ) {
        return pending(id, taskId, attemptNumber, snapshot, ApprovalPolicySnapshot.manual("."), createdAt);
    }

    public void markStarting(String runtimeRunId, Instant acceptedAt, TaskStateMachine stateMachine) {
        stateMachine.requireTransition(status, AttemptStatus.STARTING);
        this.runtimeRunId = Objects.requireNonNull(runtimeRunId, "runtimeRunId");
        this.startedAt = Objects.requireNonNull(acceptedAt, "acceptedAt");
        this.status = AttemptStatus.STARTING;
    }

    public void markFailed(
            String errorCode,
            String errorMessage,
            Instant failedAt,
            TaskStateMachine stateMachine
    ) {
        stateMachine.requireTransition(status, AttemptStatus.FAILED);
        this.errorCode = Objects.requireNonNull(errorCode, "errorCode");
        this.errorMessage = Objects.requireNonNull(errorMessage, "errorMessage");
        this.completedAt = Objects.requireNonNull(failedAt, "failedAt");
        this.status = AttemptStatus.FAILED;
    }

    public UUID id() { return id; }
    public UUID taskId() { return taskId; }
    public int attemptNumber() { return attemptNumber; }
    public AgentProfileSnapshot profileSnapshot() { return profileSnapshot; }
    public ApprovalPolicySnapshot approvalPolicySnapshot() { return approvalPolicySnapshot; }
    public Instant createdAt() { return createdAt; }
    public AttemptStatus status() { return status; }
    public String runtimeRunId() { return runtimeRunId; }
    public Instant startedAt() { return startedAt; }
    public Instant completedAt() { return completedAt; }
    public String errorCode() { return errorCode; }
    public String errorMessage() { return errorMessage; }
}
