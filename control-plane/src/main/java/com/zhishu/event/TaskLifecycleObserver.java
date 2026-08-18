package com.zhishu.event;

import java.util.UUID;

import com.zhishu.task.AttemptStatus;

/** Receives committed execution-projection transitions without owning Task truth. */
public interface TaskLifecycleObserver {

    void observe(UUID taskId, UUID attemptId, AttemptStatus status);
}
