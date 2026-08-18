package com.zhishu.runtime;

/** Durable liveness projection for a Runtime-owned Task Attempt. */
public enum RuntimeHealthStatus {
    NOT_MONITORED,
    HEALTHY,
    UNKNOWN,
    LOST,
    TERMINATED
}
