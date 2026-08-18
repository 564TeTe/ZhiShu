package com.zhishu.task;

import java.util.UUID;

public class TaskNotFoundException extends RuntimeException {

    public TaskNotFoundException(UUID taskId) {
        super("Task was not found: " + taskId);
    }

    public TaskNotFoundException(String message) {
        super(message);
    }
}
