package com.zhishu.project.persistence;

import java.util.List;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

@Mapper
interface WorkspaceBindingMapper {

    String BASE_SELECT = """
            SELECT p.id::text AS "projectId",
                   p.name AS "displayName",
                   p.repository_identity AS "repositoryIdentity",
                   p.status AS "projectStatus",
                   p.identity_version AS "identityVersion",
                   wb.id::text AS "workspaceId",
                   wb.machine_id AS "machineId",
                   wb.local_project_id AS "localProjectId",
                   wb.workspace_path AS "workspacePath",
                   wb.normalized_workspace_path AS "normalizedWorkspacePath",
                   wb.repository_url AS "repositoryUrl",
                   wb.remote_fingerprint AS "remoteFingerprint",
                   wb.branch AS "branch",
                   wb.is_primary AS "primary",
                   wb.status AS "bindingStatus",
                   wb.last_seen_at AS "lastSeenAt",
                   ap.id::text AS "profileId",
                   p.runtime_project_ref AS "projectRef",
                   ap.name AS "profileName"
            FROM workspace_binding wb
            JOIN project p ON p.id = wb.project_id
            JOIN LATERAL (
                SELECT id, name
                FROM agent_profile
                WHERE project_id = p.id AND enabled = TRUE
                ORDER BY created_at
                LIMIT 1
            ) ap ON TRUE
            """;

    @Select(BASE_SELECT + """
            WHERE wb.machine_id = #{machineId}
              AND wb.local_project_id = #{localProjectId}
              AND wb.status = 'ACTIVE'
              AND p.status = 'ACTIVE'
            LIMIT 1
            """)
    WorkspaceProjectMatchRow findByMachineAndLocalProjectId(
            @Param("machineId") String machineId,
            @Param("localProjectId") String localProjectId
    );

    @Select(BASE_SELECT + """
            WHERE wb.machine_id = #{machineId}
              AND wb.normalized_workspace_path = #{normalizedWorkspacePath}
              AND wb.status = 'ACTIVE'
              AND p.status = 'ACTIVE'
            LIMIT 1
            """)
    WorkspaceProjectMatchRow findByMachineAndPath(
            @Param("machineId") String machineId,
            @Param("normalizedWorkspacePath") String normalizedWorkspacePath
    );

    @Select(BASE_SELECT + """
            WHERE wb.remote_fingerprint = #{remoteFingerprint}
              AND wb.status = 'ACTIVE'
              AND p.status = 'ACTIVE'
            ORDER BY wb.is_primary DESC, wb.updated_at DESC
            """)
    List<WorkspaceProjectMatchRow> findByRemoteFingerprint(
            @Param("remoteFingerprint") String remoteFingerprint
    );

    @Select(BASE_SELECT + """
            WHERE wb.normalized_workspace_path = #{normalizedWorkspacePath}
              AND wb.status = 'ACTIVE'
              AND p.status = 'ACTIVE'
              AND (wb.machine_id = 'legacy-unscoped' OR p.runtime_project_ref = #{normalizedWorkspacePath})
            ORDER BY wb.machine_id = 'legacy-unscoped' DESC, wb.updated_at DESC
            """)
    List<WorkspaceProjectMatchRow> findCompatibilityPath(
            @Param("normalizedWorkspacePath") String normalizedWorkspacePath
    );

}
