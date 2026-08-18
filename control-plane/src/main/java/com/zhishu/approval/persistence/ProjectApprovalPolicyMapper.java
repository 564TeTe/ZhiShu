package com.zhishu.approval.persistence;

import java.time.Instant;
import java.util.UUID;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

@Mapper
interface ProjectApprovalPolicyMapper {

    String COLUMNS = """
            SELECT p.id::text AS projectId,
                   p.runtime_project_ref AS projectRoot,
                   COALESCE(pap.mode, 'MANUAL') AS mode,
                   COALESCE(pap.allowed_directories, '["."]'::jsonb)::text AS allowedDirectoriesJson,
                   COALESCE(pap.trusted_commands, '[]'::jsonb)::text AS trustedCommandsJson,
                   COALESCE(pap.approval_timeout_seconds, 45) AS approvalTimeoutSeconds,
                   COALESCE(pap.updated_at, p.updated_at) AS updatedAt
            FROM project p
            LEFT JOIN project_approval_policy pap ON pap.project_id = p.id
            """;

    @Select(COLUMNS + " WHERE p.id = #{projectId}")
    ProjectApprovalPolicyRow findByProjectId(@Param("projectId") UUID projectId);

    @Select("""
            INSERT INTO project_approval_policy (
                project_id, mode, allowed_directories, trusted_commands,
                approval_timeout_seconds, created_at, updated_at
            ) VALUES (
                #{projectId}, #{mode}, CAST(#{directoriesJson} AS jsonb),
                CAST(#{commandsJson} AS jsonb), #{timeoutSeconds}, #{updatedAt}, #{updatedAt}
            )
            ON CONFLICT (project_id) DO UPDATE
            SET mode = EXCLUDED.mode,
                allowed_directories = EXCLUDED.allowed_directories,
                trusted_commands = EXCLUDED.trusted_commands,
                approval_timeout_seconds = EXCLUDED.approval_timeout_seconds,
                updated_at = EXCLUDED.updated_at
            RETURNING project_id::text
            """)
    String save(
            @Param("projectId") UUID projectId,
            @Param("mode") String mode,
            @Param("directoriesJson") String directoriesJson,
            @Param("commandsJson") String commandsJson,
            @Param("timeoutSeconds") int timeoutSeconds,
            @Param("updatedAt") Instant updatedAt
    );
}
