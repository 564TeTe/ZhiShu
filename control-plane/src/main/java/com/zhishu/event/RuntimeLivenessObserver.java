package com.zhishu.event;

import java.util.UUID;
import java.time.Instant;

/** Receives authenticated Runtime activity without coupling event projection to lease persistence. */
@FunctionalInterface
public interface RuntimeLivenessObserver {
    void observe(UUID attemptId, Instant occurredAt);
}
