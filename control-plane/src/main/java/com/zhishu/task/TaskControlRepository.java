package com.zhishu.task;

import java.util.UUID;

public interface TaskControlRepository {

    boolean claimCancellation(UUID taskId, UUID attemptId);

    void expirePendingApprovals(UUID attemptId);

    boolean claimRetry(UUID taskId, UUID attemptId);
}
