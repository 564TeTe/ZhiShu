package com.zhishu.task;

import java.util.Optional;
import java.util.UUID;

public interface TaskAcceptanceRepository {

    Optional<TaskAcceptanceView> findByClientRequestId(UUID taskId, String clientRequestId);

    void insert(TaskAcceptanceView decision);

    boolean updateResolution(UUID taskId, UUID attemptId, ResolutionStatus target);
}
