package com.zhishu.runtime;

import java.util.UUID;

import com.zhishu.task.AttemptStatus;

/** Attempt whose UNKNOWN grace window has elapsed and may be declared LOST. */
public record RuntimeLeaseCandidate(UUID attemptId, UUID taskId, AttemptStatus attemptStatus) {
}
