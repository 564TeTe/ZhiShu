package com.zhishu.task.persistence;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.stereotype.Repository;

import com.zhishu.task.AgentTask;
import com.zhishu.task.AttemptStatus;
import com.zhishu.task.TaskNotFoundException;
import com.zhishu.task.TaskRepository;
import com.zhishu.task.TaskAttemptView;
import com.zhishu.task.TaskSearchCriteria;
import com.zhishu.task.TaskView;

@Repository
public class MyBatisTaskRepository implements TaskRepository {

    private final TaskMapper mapper;

    public MyBatisTaskRepository(TaskMapper mapper) {
        this.mapper = mapper;
    }

    @Override
    public void insert(AgentTask task) {
        mapper.insert(
                task.id(),
                task.projectId(),
                task.profileId(),
                task.title(),
                task.objective(),
                task.status().name(),
                task.resolutionStatus().name(),
                task.createdAt()
        );
    }

    @Override
    public void attachAttempt(UUID taskId, UUID attemptId, AttemptStatus status) {
        if (mapper.attachAttempt(taskId, attemptId, status.name()) != 1) {
            throw new TaskNotFoundException(taskId);
        }
    }

    @Override
    public void updateStatusForAttempt(UUID taskId, UUID attemptId, AttemptStatus status) {
        if (mapper.updateStatusForAttempt(taskId, attemptId, status.name()) != 1) {
            throw new IllegalStateException("Attempt is no longer current for task " + taskId);
        }
    }

    @Override
    public boolean claimFollowUp(UUID taskId, UUID parentAttemptId) {
        return mapper.claimFollowUp(taskId, parentAttemptId) == 1;
    }

    @Override
    public boolean archiveIfTerminal(UUID taskId, String actor, String reason) {
        return mapper.archiveIfTerminal(taskId, actor, reason) == 1;
    }

    @Override
    public Optional<TaskView> findById(UUID taskId) {
        return Optional.ofNullable(mapper.findById(taskId));
    }

    @Override
    public Optional<TaskView> findIncludingArchivedById(UUID taskId) {
        return Optional.ofNullable(mapper.findIncludingArchivedById(taskId));
    }

    @Override
    public Optional<TaskView> findByProjectAndId(UUID projectId, UUID taskId) {
        return Optional.ofNullable(mapper.findByProjectAndId(projectId, taskId));
    }

    @Override
    public List<TaskView> list(UUID projectId, int limit) {
        return mapper.list(projectId, limit);
    }

    @Override
    public List<TaskView> search(TaskSearchCriteria criteria) {
        return mapper.search(
                criteria.projectId(),
                criteria.archiveScope().name(),
                criteria.status() == null ? null : criteria.status().name(),
                criteria.resolutionStatus() == null ? null : criteria.resolutionStatus().name(),
                criteria.searchPattern(),
                criteria.beforeCreatedAt(),
                criteria.beforeTaskId(),
                criteria.limit()
        );
    }

    @Override
    public List<TaskAttemptView> listAttempts(UUID taskId) {
        return mapper.listAttempts(taskId);
    }
}
