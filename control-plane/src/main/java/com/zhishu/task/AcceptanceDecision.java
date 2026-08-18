package com.zhishu.task;

public enum AcceptanceDecision {
    RESOLVED,
    NEEDS_FOLLOW_UP,
    CLOSED;

    public ResolutionStatus resolutionStatus() {
        return switch (this) {
            case RESOLVED -> ResolutionStatus.RESOLVED;
            case NEEDS_FOLLOW_UP -> ResolutionStatus.NEEDS_FOLLOW_UP;
            case CLOSED -> ResolutionStatus.CLOSED;
        };
    }
}
