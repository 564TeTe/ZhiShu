package com.zhishu.task;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface TaskFollowUpRepository {

    Optional<TaskFollowUpView> findByClientRequestId(UUID taskId, String clientRequestId);

    List<TaskFollowUpView> findByTaskId(UUID taskId);

    void insert(TaskFollowUp followUp);
}
