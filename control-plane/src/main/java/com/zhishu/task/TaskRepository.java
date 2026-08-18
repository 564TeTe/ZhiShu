package com.zhishu.task;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface TaskRepository {

    void insert(AgentTask task);

    void attachAttempt(UUID taskId, UUID attemptId, AttemptStatus status);

    void updateStatusForAttempt(UUID taskId, UUID attemptId, AttemptStatus status);

    default boolean claimFollowUp(UUID taskId, UUID parentAttemptId) {
        return false;
    }

    default boolean archiveIfTerminal(UUID taskId, String actor, String reason) {
        return false;
    }

    Optional<TaskView> findById(UUID taskId);

    default Optional<TaskView> findIncludingArchivedById(UUID taskId) {
        return Optional.empty();
    }

    default Optional<TaskView> findByProjectAndId(UUID projectId, UUID taskId) {
        return Optional.empty();
    }

    default List<TaskView> list(UUID projectId, int limit) {
        return List.of();
    }

    default List<TaskView> search(TaskSearchCriteria criteria) {
        return List.of();
    }

    default List<TaskAttemptView> listAttempts(UUID taskId) {
        return List.of();
    }
}
