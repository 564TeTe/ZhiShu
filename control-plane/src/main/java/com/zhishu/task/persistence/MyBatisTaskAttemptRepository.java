package com.zhishu.task.persistence;

import java.util.Optional;
import java.util.UUID;

import org.springframework.stereotype.Repository;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zhishu.task.AttemptStatus;
import com.zhishu.task.InvalidTaskStateException;
import com.zhishu.task.TaskAttempt;
import com.zhishu.task.TaskAttemptRepository;
import com.zhishu.profile.AgentProfileSnapshot;
import com.zhishu.approval.ApprovalPolicySnapshot;

@Repository
public class MyBatisTaskAttemptRepository implements TaskAttemptRepository {

    private final TaskAttemptMapper mapper;
    private final ObjectMapper objectMapper;

    public MyBatisTaskAttemptRepository(TaskAttemptMapper mapper, ObjectMapper objectMapper) {
        this.mapper = mapper;
        this.objectMapper = objectMapper;
    }

    @Override
    public int nextAttemptNumber(UUID taskId) {
        return mapper.nextAttemptNumber(taskId);
    }

    @Override
    public void insert(TaskAttempt attempt) {
        mapper.insert(
                attempt.id(),
                attempt.taskId(),
                attempt.attemptNumber(),
                attempt.runtimeRunId(),
                attempt.status().name(),
                serializeSnapshot(attempt),
                serializeApprovalPolicy(attempt),
                attempt.startedAt(),
                attempt.completedAt(),
                attempt.errorCode(),
                attempt.errorMessage(),
                attempt.createdAt()
        );
    }

    @Override
    public void update(TaskAttempt attempt) {
        AttemptStatus expected = switch (attempt.status()) {
            case STARTING, FAILED -> AttemptStatus.PENDING;
            default -> throw new IllegalArgumentException(
                    "Initial repository slice cannot persist target status " + attempt.status()
            );
        };

        int updated = mapper.compareAndSet(
                attempt.id(),
                expected.name(),
                attempt.status().name(),
                attempt.runtimeRunId(),
                attempt.startedAt(),
                attempt.completedAt(),
                attempt.errorCode(),
                attempt.errorMessage()
        );
        if (updated != 1) {
            throw new InvalidTaskStateException(expected, attempt.status());
        }
    }

    @Override
    public Optional<TaskAttempt> findPending(UUID attemptId) {
        TaskAttemptSnapshotRow row = mapper.findPending(attemptId);
        if (row == null) return Optional.empty();
        return Optional.of(TaskAttempt.pending(
                row.id(),
                row.taskId(),
                row.attemptNumber(),
                readProfileSnapshot(row.profileSnapshot()),
                readApprovalPolicySnapshot(row.approvalPolicySnapshot()),
                row.createdAt()
        ));
    }

    @Override
    public java.util.Optional<AgentProfileSnapshot> findProfileSnapshot(UUID attemptId) {
        String json = mapper.findProfileSnapshot(attemptId);
        if (json == null) {
            return java.util.Optional.empty();
        }
        return java.util.Optional.of(readProfileSnapshot(json));
    }

    @Override
    public java.util.Optional<ApprovalPolicySnapshot> findApprovalPolicySnapshot(UUID attemptId) {
        String json = mapper.findApprovalPolicySnapshot(attemptId);
        if (json == null) return java.util.Optional.empty();
        return java.util.Optional.of(readApprovalPolicySnapshot(json));
    }

    private AgentProfileSnapshot readProfileSnapshot(String value) {
        try {
            return objectMapper.readValue(value, AgentProfileSnapshot.class);
        } catch (JsonProcessingException error) {
            throw new IllegalStateException("Stored Agent Profile snapshot is invalid", error);
        }
    }

    private ApprovalPolicySnapshot readApprovalPolicySnapshot(String value) {
        try {
            return objectMapper.readValue(value, ApprovalPolicySnapshot.class);
        } catch (JsonProcessingException error) {
            throw new IllegalStateException("Stored approval policy snapshot is invalid", error);
        }
    }

    private String serializeSnapshot(TaskAttempt attempt) {
        try {
            return objectMapper.writeValueAsString(attempt.profileSnapshot());
        } catch (JsonProcessingException error) {
            throw new IllegalArgumentException("Unable to serialize Agent Profile snapshot", error);
        }
    }

    private String serializeApprovalPolicy(TaskAttempt attempt) {
        try {
            return objectMapper.writeValueAsString(attempt.approvalPolicySnapshot());
        } catch (JsonProcessingException error) {
            throw new IllegalArgumentException("Unable to serialize approval policy snapshot", error);
        }
    }
}
