package com.zhishu.event.persistence;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import org.springframework.stereotype.Repository;

import com.zhishu.event.AttemptProjectionRepository;
import com.zhishu.event.AttemptProjectionState;
import com.zhishu.task.AttemptStatus;

@Repository
public class MyBatisAttemptProjectionRepository implements AttemptProjectionRepository {

    private final AttemptProjectionMapper mapper;

    public MyBatisAttemptProjectionRepository(AttemptProjectionMapper mapper) {
        this.mapper = mapper;
    }

    @Override
    public Optional<AttemptProjectionState> lock(UUID attemptId) {
        return Optional.ofNullable(mapper.lock(attemptId)).map(row -> new AttemptProjectionState(
                UUID.fromString(row.getAttemptId()),
                UUID.fromString(row.getTaskId()),
                AttemptStatus.valueOf(row.getStatus())
        ));
    }

    @Override
    public boolean transition(
            UUID attemptId,
            AttemptStatus expected,
            AttemptStatus target,
            Instant completedAt,
            String errorCode,
            String errorMessage
    ) {
        return mapper.transition(
                attemptId,
                expected.name(),
                target.name(),
                completedAt,
                errorCode,
                errorMessage
        ) == 1;
    }
}
