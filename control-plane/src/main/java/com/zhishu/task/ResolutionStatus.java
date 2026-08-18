package com.zhishu.task;

public enum ResolutionStatus {
    OPEN,
    IN_PROGRESS,
    WAITING_ACCEPTANCE,
    NEEDS_FOLLOW_UP,
    RESOLVED,
    CLOSED;

    public static ResolutionStatus fromAttemptStatus(AttemptStatus status) {
        return switch (status) {
            case PENDING, STARTING, RUNNING, WAITING_APPROVAL, CANCELLING -> IN_PROGRESS;
            case SUCCEEDED -> WAITING_ACCEPTANCE;
            case FAILED, LOST, ABORTED -> NEEDS_FOLLOW_UP;
        };
    }
}
