package com.zhishu.task.persistence;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.springframework.stereotype.Repository;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zhishu.task.AcceptanceDecision;
import com.zhishu.task.AttemptStatus;
import com.zhishu.task.TaskFollowUp;
import com.zhishu.task.TaskFollowUpRepository;
import com.zhishu.task.TaskFollowUpView;

@Repository
public class MyBatisTaskFollowUpRepository implements TaskFollowUpRepository {

    private static final TypeReference<Map<String, Object>> CONTEXT_TYPE = new TypeReference<>() { };

    private final TaskFollowUpMapper mapper;
    private final ObjectMapper objectMapper;

    public MyBatisTaskFollowUpRepository(TaskFollowUpMapper mapper, ObjectMapper objectMapper) {
        this.mapper = mapper;
        this.objectMapper = objectMapper;
    }

    @Override
    public Optional<TaskFollowUpView> findByClientRequestId(UUID taskId, String clientRequestId) {
        return Optional.ofNullable(mapper.findByClientRequestId(taskId, clientRequestId)).map(this::toView);
    }

    @Override
    public List<TaskFollowUpView> findByTaskId(UUID taskId) {
        return mapper.findByTaskId(taskId).stream().map(this::toView).toList();
    }

    @Override
    public void insert(TaskFollowUp followUp) {
        try {
            mapper.insert(
                    followUp.id(), followUp.taskId(), followUp.parentAttemptId(), followUp.attemptId(),
                    followUp.clientRequestId(), followUp.actor(), followUp.feedback(),
                    followUp.requestedAcceptance(), objectMapper.writeValueAsString(followUp.additionalContext()),
                    followUp.createdAt()
            );
        } catch (JsonProcessingException error) {
            throw new IllegalArgumentException("Unable to serialize follow-up context", error);
        }
    }

    private TaskFollowUpView toView(TaskFollowUpRow row) {
        try {
            return new TaskFollowUpView(
                    UUID.fromString(row.getId()), UUID.fromString(row.getTaskId()),
                    UUID.fromString(row.getParentAttemptId()), UUID.fromString(row.getAttemptId()),
                    row.getClientRequestId(), row.getActor(), row.getFeedback(), row.getRequestedAcceptance(),
                    objectMapper.readValue(row.getAdditionalContextJson(), CONTEXT_TYPE),
                    row.getAttemptNumber(), AttemptStatus.valueOf(row.getAttemptStatus()), row.getErrorCode(),
                    row.getErrorMessage(), row.getAcceptanceDecision() == null
                            ? null : AcceptanceDecision.valueOf(row.getAcceptanceDecision()),
                    row.getAcceptanceReason(), row.getAcceptanceAt(), row.getCreatedAt()
            );
        } catch (JsonProcessingException error) {
            throw new IllegalStateException("Stored follow-up context is invalid", error);
        }
    }
}
