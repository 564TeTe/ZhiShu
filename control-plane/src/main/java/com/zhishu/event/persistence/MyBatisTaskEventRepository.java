package com.zhishu.event.persistence;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.stereotype.Repository;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zhishu.event.RuntimeEvent;
import com.zhishu.event.RuntimeEventType;
import com.zhishu.event.StoredTaskEvent;
import com.zhishu.event.TaskEventRepository;

@Repository
public class MyBatisTaskEventRepository implements TaskEventRepository {

    private static final TypeReference<Map<String, Object>> PAYLOAD_TYPE = new TypeReference<>() { };

    private final TaskEventMapper mapper;
    private final ObjectMapper objectMapper;

    public MyBatisTaskEventRepository(TaskEventMapper mapper, ObjectMapper objectMapper) {
        this.mapper = mapper;
        this.objectMapper = objectMapper;
    }

    @Override
    public boolean attemptMatches(UUID taskId, UUID attemptId, String runtimeRunId) {
        return mapper.attemptMatches(taskId, attemptId, runtimeRunId);
    }

    @Override
    public boolean insertIfAbsent(RuntimeEvent event) {
        int inserted = mapper.insertIfAbsent(
                event.eventId(),
                event.taskId(),
                event.attemptId(),
                event.runtimeRunId(),
                event.sequenceNo(),
                event.type().name(),
                writePayload(event.payload()),
                event.occurredAt()
        );
        if (inserted == 1) {
            return true;
        }
        TaskEventRow existing = mapper.findConflict(
                event.eventId(),
                event.attemptId(),
                event.sequenceNo()
        );
        if (existing == null || !sameEvent(existing, event)) {
            throw new com.zhishu.event.RuntimeEventRejectedException(
                    "Runtime event id or attempt sequence was reused with different content"
            );
        }
        return false;
    }

    @Override
    public List<StoredTaskEvent> findUnprojected(UUID attemptId) {
        return mapper.findUnprojected(attemptId).stream().map(this::toDomain).toList();
    }

    @Override
    public void markProjected(long eventDatabaseId, Instant projectedAt) {
        mapper.markProjected(eventDatabaseId, projectedAt);
    }

    @Override
    public List<StoredTaskEvent> findAfter(UUID taskId, long afterId, int limit) {
        return mapper.findAfter(taskId, afterId, limit).stream().map(this::toDomain).toList();
    }

    private StoredTaskEvent toDomain(TaskEventRow row) {
        try {
            return new StoredTaskEvent(
                    row.getId(),
                    row.getEventId(),
                    UUID.fromString(row.getTaskId()),
                    UUID.fromString(row.getAttemptId()),
                    row.getRuntimeRunId(),
                    row.getSequenceNo(),
                    RuntimeEventType.valueOf(row.getEventType()),
                    objectMapper.readValue(row.getPayloadJson(), PAYLOAD_TYPE),
                    row.getOccurredAt(),
                    row.getReceivedAt()
            );
        } catch (JsonProcessingException error) {
            throw new IllegalStateException("Stored Runtime event payload is invalid", error);
        }
    }

    private boolean sameEvent(TaskEventRow existing, RuntimeEvent incoming) {
        StoredTaskEvent stored = toDomain(existing);
        return stored.eventId().equals(incoming.eventId())
                && stored.taskId().equals(incoming.taskId())
                && stored.attemptId().equals(incoming.attemptId())
                && java.util.Objects.equals(stored.runtimeRunId(), incoming.runtimeRunId())
                && stored.sequenceNo() == incoming.sequenceNo()
                && stored.eventType() == incoming.type()
                && stored.payload().equals(incoming.payload())
                && stored.occurredAt().equals(incoming.occurredAt());
    }

    private String writePayload(Map<String, Object> payload) {
        try {
            return objectMapper.writeValueAsString(payload);
        } catch (JsonProcessingException error) {
            throw new IllegalArgumentException("Runtime event payload cannot be serialized", error);
        }
    }
}
