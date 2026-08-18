package com.zhishu.project.persistence;

import java.util.UUID;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

@Mapper
interface ProjectCatalogMapper {

    @Select("""
            INSERT INTO project (id, runtime_project_ref, name, display_root_path)
            VALUES (#{candidateId}, #{projectRef}, #{displayName}, #{projectRef})
            ON CONFLICT (runtime_project_ref) DO UPDATE
            SET name = EXCLUDED.name,
                display_root_path = EXCLUDED.display_root_path,
                updated_at = now()
            RETURNING id::text
            """)
    String ensureProject(
            @Param("candidateId") UUID candidateId,
            @Param("projectRef") String projectRef,
            @Param("displayName") String displayName
    );

    @Insert("""
            INSERT INTO project_approval_policy (project_id)
            VALUES (#{projectId})
            ON CONFLICT (project_id) DO NOTHING
            """)
    int ensureApprovalPolicy(@Param("projectId") UUID projectId);

    @Insert("""
            INSERT INTO workspace_binding (
                id, project_id, machine_id, local_project_id,
                workspace_path, normalized_workspace_path, is_primary, status
            )
            SELECT
                #{projectId}, #{projectId}, 'legacy-unscoped', NULL,
                #{projectRef}, #{projectRef}, TRUE, 'ACTIVE'
            WHERE NOT EXISTS (
                SELECT 1 FROM workspace_binding WHERE project_id = #{projectId}
            )
            ON CONFLICT DO NOTHING
            """)
    int ensureCompatibilityWorkspaceBinding(
            @Param("projectId") UUID projectId,
            @Param("projectRef") String projectRef
    );

    @Select("""
            SELECT ap.project_id::text AS "projectId",
                   ap.id::text AS "profileId",
                   p.runtime_project_ref AS "projectRef",
                   ap.name AS "profileName"
            FROM agent_profile ap
            JOIN project p ON p.id = ap.project_id
            WHERE ap.project_id = #{projectId}
              AND ap.enabled = TRUE
            ORDER BY ap.created_at
            LIMIT 1
            """)
    ProjectRegistrationRow findDefaultProfile(@Param("projectId") UUID projectId);

    @Select("""
            SELECT ap.project_id::text AS "projectId",
                   ap.id::text AS "profileId",
                   p.runtime_project_ref AS "projectRef",
                   ap.name AS "profileName"
            FROM agent_profile ap
            JOIN project p ON p.id = ap.project_id
            WHERE p.runtime_project_ref = #{projectRef}
              AND ap.enabled = TRUE
            ORDER BY ap.created_at
            LIMIT 1
            """)
    ProjectRegistrationRow findByProjectRef(@Param("projectRef") String projectRef);

    @Insert("""
            INSERT INTO agent_profile (
                id, project_id, name, executor, model_alias, capabilities,
                permission_policy, timeout_seconds, prompt_version, enabled
            ) VALUES (
                #{profileId}, #{projectId}, '黄金版 Claude 开发代理', 'claude', NULL,
                '["READ_FILE", "WRITE_FILE", "SEARCH_CODE", "SHELL", "GIT", "TEST"]'::jsonb,
                '{"requireApprovalFor": ["WRITE_FILE", "SHELL", "GIT"]}'::jsonb,
                600, 'task-v1', TRUE
            )
            """)
    int insertDefaultProfile(@Param("profileId") UUID profileId, @Param("projectId") UUID projectId);
}
