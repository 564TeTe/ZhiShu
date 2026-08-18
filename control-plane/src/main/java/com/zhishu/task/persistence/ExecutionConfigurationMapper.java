package com.zhishu.task.persistence;

import java.util.UUID;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

@Mapper
interface ExecutionConfigurationMapper {

    @Select("""
            SELECT p.id AS projectId,
                   ap.id AS profileId,
                   p.runtime_project_ref AS projectRef,
                   ap.executor AS executor,
                   ap.connection_ref AS connectionRef,
                   ap.model_alias AS modelAlias,
                   ap.capabilities::text AS capabilitiesJson,
                   ap.permission_policy::text AS permissionPolicyJson,
                   ap.timeout_seconds AS timeoutSeconds,
                   ap.prompt_version AS promptVersion
            FROM project p
            JOIN agent_profile ap ON ap.project_id = p.id
            WHERE p.id = #{projectId}
              AND ap.id = #{profileId}
              AND ap.enabled = TRUE
            """)
    ExecutionConfigurationRow findEnabled(
            @Param("projectId") UUID projectId,
            @Param("profileId") UUID profileId
    );
}
