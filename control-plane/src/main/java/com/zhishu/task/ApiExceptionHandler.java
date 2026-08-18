package com.zhishu.task;

import java.time.Instant;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import com.zhishu.event.RuntimeEventRejectedException;
import com.zhishu.approval.ApprovalConflictException;
import com.zhishu.project.ProjectRegistrationNotFoundException;
import com.zhishu.project.ProjectIdentityConflictException;
import com.zhishu.runtime.RuntimeClientException;
import com.zhishu.state.ProjectStateConflictException;

@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(TaskNotFoundException.class)
    ResponseEntity<Map<String, Object>> taskNotFound(TaskNotFoundException error) {
        return error(HttpStatus.NOT_FOUND, "TASK_NOT_FOUND", error.getMessage());
    }

    @ExceptionHandler(ProjectRegistrationNotFoundException.class)
    ResponseEntity<Map<String, Object>> projectRegistrationNotFound(ProjectRegistrationNotFoundException error) {
        return error(HttpStatus.NOT_FOUND, "PROJECT_REGISTRATION_NOT_FOUND", error.getMessage());
    }

    @ExceptionHandler(RuntimeEventRejectedException.class)
    ResponseEntity<Map<String, Object>> rejectedEvent(RuntimeEventRejectedException error) {
        return error(HttpStatus.UNPROCESSABLE_ENTITY, "RUNTIME_EVENT_REJECTED", error.getMessage());
    }

    @ExceptionHandler(RuntimeClientException.class)
    ResponseEntity<Map<String, Object>> runtimeUnavailable(RuntimeClientException error) {
        return error(HttpStatus.BAD_GATEWAY, error.code(), error.getMessage());
    }

    @ExceptionHandler({ApprovalConflictException.class, InvalidTaskStateException.class})
    ResponseEntity<Map<String, Object>> conflict(RuntimeException error) {
        return error(HttpStatus.CONFLICT, "INVALID_TASK_STATE", error.getMessage());
    }

    @ExceptionHandler(ProjectIdentityConflictException.class)
    ResponseEntity<Map<String, Object>> projectIdentityConflict(ProjectIdentityConflictException error) {
        return error(HttpStatus.CONFLICT, "PROJECT_IDENTITY_CONFLICT", error.getMessage());
    }

    @ExceptionHandler(ProjectStateConflictException.class)
    ResponseEntity<Map<String, Object>> projectStateConflict(ProjectStateConflictException error) {
        return error(HttpStatus.CONFLICT, "PROJECT_STATE_CONFLICT", error.getMessage());
    }

    @ExceptionHandler({IllegalArgumentException.class, MethodArgumentNotValidException.class})
    ResponseEntity<Map<String, Object>> badRequest(Exception error) {
        return error(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", error.getMessage());
    }

    private ResponseEntity<Map<String, Object>> error(HttpStatus status, String code, String message) {
        return ResponseEntity.status(status).body(Map.of(
                "timestamp", Instant.now().toString(),
                "status", status.value(),
                "code", code,
                "message", message
        ));
    }
}
