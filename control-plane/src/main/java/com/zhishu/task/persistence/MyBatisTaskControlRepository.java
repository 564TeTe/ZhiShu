package com.zhishu.task.persistence;

import java.util.UUID;

import org.springframework.stereotype.Repository;

import com.zhishu.task.TaskControlRepository;

@Repository
public class MyBatisTaskControlRepository implements TaskControlRepository {

    private final TaskControlMapper mapper;

    public MyBatisTaskControlRepository(TaskControlMapper mapper) {
        this.mapper = mapper;
    }

    @Override
    public boolean claimCancellation(UUID taskId, UUID attemptId) {
        return mapper.claimCancellation(taskId, attemptId) == 1;
    }

    @Override
    public void expirePendingApprovals(UUID attemptId) {
        mapper.expirePendingApprovals(attemptId);
    }

    @Override
    public boolean claimRetry(UUID taskId, UUID attemptId) {
        return mapper.claimRetry(taskId, attemptId) == 1;
    }
}
