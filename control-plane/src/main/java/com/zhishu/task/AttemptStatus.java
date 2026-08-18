package com.zhishu.task;

public enum AttemptStatus {
    PENDING,
    STARTING,
    RUNNING,
    WAITING_APPROVAL,
    CANCELLING,
    SUCCEEDED,
    FAILED,
    LOST,
    ABORTED

    ;

    public boolean isTerminal() {
        return this == SUCCEEDED || this == FAILED || this == LOST || this == ABORTED;
    }
}
