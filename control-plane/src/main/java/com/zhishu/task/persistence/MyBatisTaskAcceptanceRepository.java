package com.zhishu.task.persistence;

import java.util.Optional;
import java.util.UUID;

import org.springframework.stereotype.Repository;

import com.zhishu.task.ResolutionStatus;
import com.zhishu.task.TaskAcceptanceRepository;
import com.zhishu.task.TaskAcceptanceView;

@Repository
public class MyBatisTaskAcceptanceRepository implements TaskAcceptanceRepository {

    private final TaskAcceptanceMapper mapper;

    public MyBatisTaskAcceptanceRepository(TaskAcceptanceMapper mapper) {
        this.mapper = mapper;
    }

    @Override
    public Optional<TaskAcceptanceView> findByClientRequestId(UUID taskId, String clientRequestId) {
        return Optional.ofNullable(mapper.findByClientRequestId(taskId, clientRequestId));
    }

    @Override
    public void insert(TaskAcceptanceView decision) {
        mapper.insert(
                decision.id(), decision.taskId(), decision.attemptId(), decision.clientRequestId(),
                decision.actor(), decision.decision().name(), decision.reason(), decision.createdAt()
        );
    }

    @Override
    public boolean updateResolution(UUID taskId, UUID attemptId, ResolutionStatus target) {
        return mapper.updateResolution(taskId, attemptId, target.name()) == 1;
    }
}
