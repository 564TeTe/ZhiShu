package com.zhishu.event.persistence;

import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.springframework.stereotype.Repository;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zhishu.event.ArtifactProjectionRepository;
import com.zhishu.event.StoredTaskEvent;

@Repository
public class MyBatisArtifactProjectionRepository implements ArtifactProjectionRepository {

    private static final Set<String> ARTIFACT_TYPES = Set.of(
            "SUMMARY", "FILE_CHANGE", "GIT_DIFF", "TEST_REPORT", "ERROR_REPORT"
    );

    private final ArtifactProjectionMapper mapper;
    private final ObjectMapper objectMapper;

    public MyBatisArtifactProjectionRepository(ArtifactProjectionMapper mapper, ObjectMapper objectMapper) {
        this.mapper = mapper;
        this.objectMapper = objectMapper;
    }

    @Override
    public void publish(StoredTaskEvent event) {
        Map<String, Object> payload = event.payload();
        String artifactType = requiredString(payload, "artifactType");
        if (!ARTIFACT_TYPES.contains(artifactType)) {
            throw new IllegalArgumentException("Unsupported artifact type: " + artifactType);
        }
        mapper.publish(
                UUID.fromString(requiredString(payload, "artifactId")),
                event.taskId(),
                event.attemptId(),
                artifactType,
                requiredString(payload, "producer"),
                optionalString(payload, "contentPlain"),
                optionalString(payload, "mimeType"),
                optionalLong(payload, "sizeBytes"),
                optionalString(payload, "hash"),
                writeJson(payload.get("metadata")),
                event.occurredAt()
        );
    }

    private String requiredString(Map<String, Object> payload, String key) {
        String value = optionalString(payload, key);
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Runtime artifact payload requires " + key);
        }
        return value;
    }

    private String optionalString(Map<String, Object> payload, String key) {
        Object value = payload.get(key);
        return value instanceof String text ? text : null;
    }

    private Long optionalLong(Map<String, Object> payload, String key) {
        Object value = payload.get(key);
        return value instanceof Number number ? number.longValue() : null;
    }

    private String writeJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value == null ? Map.of() : value);
        } catch (JsonProcessingException error) {
            throw new IllegalArgumentException("Artifact metadata cannot be serialized", error);
        }
    }
}
