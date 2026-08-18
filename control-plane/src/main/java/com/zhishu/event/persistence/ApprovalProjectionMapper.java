package com.zhishu.event.persistence;

import java.util.UUID;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;

@Mapper
interface ApprovalProjectionMapper {

    @Insert("""
            INSERT INTO approval_request (
                id, task_id, attempt_id, runtime_approval_id, tool_name,
                tool_input, risk_level, status, expires_at
            ) VALUES (
                #{id}, #{taskId}, #{attemptId}, #{runtimeApprovalId}, #{toolName},
                CAST(#{toolInputJson} AS jsonb), #{riskLevel}, 'PENDING',
                now() + make_interval(secs => COALESCE((
                    SELECT (approval_policy_snapshot ->> 'approvalTimeoutSeconds')::integer
                    FROM task_attempt WHERE id = #{attemptId}
                ), 45))
            )
            ON CONFLICT (attempt_id, runtime_approval_id) DO NOTHING
            """)
    int open(
            @Param("id") UUID id,
            @Param("taskId") UUID taskId,
            @Param("attemptId") UUID attemptId,
            @Param("runtimeApprovalId") String runtimeApprovalId,
            @Param("toolName") String toolName,
            @Param("toolInputJson") String toolInputJson,
            @Param("riskLevel") String riskLevel
    );

    @Update("""
            UPDATE approval_request
            SET status = #{status}, decided_at = now(),
                decision_source = #{source}, policy = #{policy}, rule = #{rule}, reason = #{reason}
            WHERE attempt_id = #{attemptId}
              AND runtime_approval_id = #{runtimeApprovalId}
              AND status IN ('PENDING', 'APPROVING', 'DENYING', 'AUTO_APPROVING', 'EXPIRING')
            """)
    int resolve(
            @Param("attemptId") UUID attemptId,
            @Param("runtimeApprovalId") String runtimeApprovalId,
            @Param("status") String status,
            @Param("source") String source,
            @Param("policy") String policy,
            @Param("rule") String rule,
            @Param("reason") String reason
    );

    @Insert("""
            INSERT INTO approval_audit (
                id, approval_id, task_id, attempt_id, actor, decision, policy, rule, reason
            )
            SELECT #{id}, ar.id, ar.task_id, ar.attempt_id, 'system:runtime',
                   #{decision}, #{policy}, #{rule}, #{reason}
            FROM approval_request ar
            WHERE ar.attempt_id = #{attemptId}
              AND ar.runtime_approval_id = #{runtimeApprovalId}
            ON CONFLICT (approval_id, decision) DO NOTHING
            """)
    int insertRuntimeAudit(
            @Param("id") UUID id,
            @Param("attemptId") UUID attemptId,
            @Param("runtimeApprovalId") String runtimeApprovalId,
            @Param("decision") String decision,
            @Param("policy") String policy,
            @Param("rule") String rule,
            @Param("reason") String reason
    );
}
