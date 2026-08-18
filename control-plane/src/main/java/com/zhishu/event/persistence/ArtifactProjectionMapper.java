package com.zhishu.event.persistence;

import java.time.Instant;
import java.util.UUID;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
interface ArtifactProjectionMapper {

    @Insert("""
            INSERT INTO task_artifact (
                id, task_id, attempt_id, artifact_type, producer,
                content_plain, mime_type, size_bytes, hash, metadata, created_at
            ) VALUES (
                #{id}, #{taskId}, #{attemptId}, #{artifactType}, #{producer},
                #{contentPlain}, #{mimeType}, #{sizeBytes}, #{hash},
                CAST(#{metadataJson} AS jsonb), #{createdAt}
            )
            ON CONFLICT (id) DO NOTHING
            """)
    int publish(
            @Param("id") UUID id,
            @Param("taskId") UUID taskId,
            @Param("attemptId") UUID attemptId,
            @Param("artifactType") String artifactType,
            @Param("producer") String producer,
            @Param("contentPlain") String contentPlain,
            @Param("mimeType") String mimeType,
            @Param("sizeBytes") Long sizeBytes,
            @Param("hash") String hash,
            @Param("metadataJson") String metadataJson,
            @Param("createdAt") Instant createdAt
    );
}
