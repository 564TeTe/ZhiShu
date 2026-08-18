package com.zhishu.event;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import com.zhishu.task.AttemptStatus;

public interface AttemptProjectionRepository {

    Optional<AttemptProjectionState> lock(UUID attemptId);

    boolean transition(
            UUID attemptId,
            AttemptStatus expected,
            AttemptStatus target,
            Instant completedAt,
            String errorCode,
            String errorMessage
    );
}
