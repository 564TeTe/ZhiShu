package com.zhishu.state;

public class ProjectStateConflictException extends RuntimeException {
    public ProjectStateConflictException(String message) {
        super(message);
    }
}
