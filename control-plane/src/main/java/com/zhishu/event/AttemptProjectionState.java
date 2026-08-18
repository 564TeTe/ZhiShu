package com.zhishu.event;

import java.util.UUID;

import com.zhishu.task.AttemptStatus;

public record AttemptProjectionState(UUID attemptId, UUID taskId, AttemptStatus status) {
}
