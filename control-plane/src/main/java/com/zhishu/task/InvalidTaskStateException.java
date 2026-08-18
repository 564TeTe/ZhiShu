package com.zhishu.task;

public class InvalidTaskStateException extends RuntimeException {

    public InvalidTaskStateException(String message) {
        super(message);
    }

    public InvalidTaskStateException(AttemptStatus current, AttemptStatus target) {
        super("Illegal TaskAttempt transition: " + current + " -> " + target);
    }
}
