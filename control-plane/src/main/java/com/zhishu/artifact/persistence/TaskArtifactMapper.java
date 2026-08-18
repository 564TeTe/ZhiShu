package com.zhishu.artifact.persistence;

import java.util.List;
import java.util.UUID;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

@Mapper
interface TaskArtifactMapper {

    @Select("""
            SELECT id::text AS id,
                   task_id::text AS "taskId",
                   attempt_id::text AS "attemptId",
                   artifact_type AS "artifactType",
                   producer,
                   content_plain AS "contentPlain",
                   storage_path AS "storagePath",
                   mime_type AS "mimeType",
                   size_bytes AS "sizeBytes",
                   hash,
                   COALESCE(metadata, '{}'::jsonb)::text AS "metadataJson",
                   created_at AS "createdAt"
            FROM task_artifact
            WHERE task_id = #{taskId}
            ORDER BY created_at DESC, id DESC
            """)
    List<TaskArtifactRow> findByTaskId(@Param("taskId") UUID taskId);

    @Select("""
            SELECT id::text AS id,
                   task_id::text AS "taskId",
                   attempt_id::text AS "attemptId",
                   artifact_type AS "artifactType",
                   producer,
                   content_plain AS "contentPlain",
                   storage_path AS "storagePath",
                   mime_type AS "mimeType",
                   size_bytes AS "sizeBytes",
                   hash,
                   COALESCE(metadata, '{}'::jsonb)::text AS "metadataJson",
                   created_at AS "createdAt"
            FROM task_artifact
            WHERE attempt_id = #{attemptId}
            ORDER BY created_at DESC, id DESC
            """)
    List<TaskArtifactRow> findByAttemptId(@Param("attemptId") UUID attemptId);
}
