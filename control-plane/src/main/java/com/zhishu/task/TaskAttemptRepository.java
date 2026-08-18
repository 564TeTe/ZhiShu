package com.zhishu.task;

import java.util.Optional;
import java.util.UUID;

import com.zhishu.profile.AgentProfileSnapshot;
import com.zhishu.approval.ApprovalPolicySnapshot;

public interface TaskAttemptRepository {

    int nextAttemptNumber(UUID taskId);

    void insert(TaskAttempt attempt);

    void update(TaskAttempt attempt);

    default Optional<TaskAttempt> findPending(UUID attemptId) {
        return Optional.empty();
    }

    default Optional<AgentProfileSnapshot> findProfileSnapshot(UUID attemptId) {
        return Optional.empty();
    }

    default Optional<ApprovalPolicySnapshot> findApprovalPolicySnapshot(UUID attemptId) {
        return Optional.empty();
    }
}
