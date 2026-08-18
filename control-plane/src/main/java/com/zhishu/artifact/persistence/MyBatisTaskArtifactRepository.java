package com.zhishu.artifact.persistence;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.stereotype.Repository;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zhishu.artifact.ArtifactType;
import com.zhishu.artifact.TaskArtifactRepository;
import com.zhishu.artifact.TaskArtifactView;

@Repository
public class MyBatisTaskArtifactRepository implements TaskArtifactRepository {

    private static final TypeReference<Map<String, Object>> METADATA_TYPE = new TypeReference<>() { };

    private final TaskArtifactMapper mapper;
    private final ObjectMapper objectMapper;

    public MyBatisTaskArtifactRepository(TaskArtifactMapper mapper, ObjectMapper objectMapper) {
        this.mapper = mapper;
        this.objectMapper = objectMapper;
    }

    @Override
    public List<TaskArtifactView> findByTaskId(UUID taskId) {
        return mapper.findByTaskId(taskId).stream().map(this::toView).toList();
    }

    @Override
    public List<TaskArtifactView> findByAttemptId(UUID attemptId) {
        return mapper.findByAttemptId(attemptId).stream().map(this::toView).toList();
    }

    private TaskArtifactView toView(TaskArtifactRow row) {
        try {
            return new TaskArtifactView(
                    UUID.fromString(row.getId()),
                    UUID.fromString(row.getTaskId()),
                    UUID.fromString(row.getAttemptId()),
                    ArtifactType.valueOf(row.getArtifactType()),
                    row.getProducer(),
                    row.getContentPlain(),
                    row.getStoragePath(),
                    row.getMimeType(),
                    row.getSizeBytes(),
                    row.getHash(),
                    objectMapper.readValue(row.getMetadataJson(), METADATA_TYPE),
                    row.getCreatedAt()
            );
        } catch (JsonProcessingException error) {
            throw new IllegalStateException("Stored artifact metadata is invalid", error);
        }
    }
}
