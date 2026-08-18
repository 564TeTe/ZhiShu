package com.zhishu.approval.persistence;

import java.util.List;
import java.util.UUID;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

@Mapper
interface ApprovalMapper {

    String SELECT_COLUMNS = """
            SELECT ar.id::text AS id,
                   ar.task_id::text AS "taskId",
                   ar.attempt_id::text AS "attemptId",
                   ta.runtime_run_id AS runtimeRunId,
                   ar.runtime_approval_id AS runtimeApprovalId,
                   ar.tool_name AS toolName,
                   ar.tool_input::text AS toolInputJson,
                   ar.risk_level AS riskLevel,
                   ar.status AS status,
                   ta.status AS attemptStatus,
                   ar.expires_at AS expiresAt,
                   ar.decided_at AS decidedAt,
                   ar.created_at AS createdAt
                   , ta.approval_policy_snapshot::text AS approvalPolicySnapshotJson
                   , ar.decision_source AS decisionSource
                   , ar.policy AS policy
                   , ar.rule AS rule
                   , ar.reason AS reason
            FROM approval_request ar
            JOIN task_attempt ta ON ta.id = ar.attempt_id
            """;

    @Select(SELECT_COLUMNS + " WHERE ar.id = #{approvalId}")
    ApprovalRow findById(@Param("approvalId") UUID approvalId);

    @Select(SELECT_COLUMNS + """
             WHERE ar.task_id = #{taskId}
               AND ar.status IN ('PENDING', 'APPROVING', 'DENYING', 'AUTO_APPROVING', 'EXPIRING')
             ORDER BY ar.created_at
            """)
    List<ApprovalRow> findPendingByTask(@Param("taskId") UUID taskId);

    @Update("""
            UPDATE approval_request ar
            SET status = #{preparingStatus}
            WHERE ar.id = #{approvalId}
              AND ar.status = 'PENDING'
              AND EXISTS (
                  SELECT 1 FROM task_attempt ta
                  WHERE ta.id = ar.attempt_id
                    AND ta.status = 'WAITING_APPROVAL'
              )
            """)
    int prepareDecision(
            @Param("approvalId") UUID approvalId,
            @Param("preparingStatus") String preparingStatus
    );

    @Update("""
            UPDATE approval_request ar
            SET status = #{preparingStatus}
            WHERE ar.id = #{approvalId}
              AND ar.status = 'PENDING'
              AND EXISTS (
                  SELECT 1 FROM task_attempt ta
                  WHERE ta.id = ar.attempt_id AND ta.status = 'WAITING_APPROVAL'
              )
            """)
    int prepareStatus(@Param("approvalId") UUID approvalId, @Param("preparingStatus") String preparingStatus);

    @Update("""
            UPDATE approval_request
            SET status = 'EXPIRING'
            WHERE id = #{approvalId}
              AND status IN ('PENDING', 'APPROVING', 'DENYING', 'AUTO_APPROVING')
            """)
    int prepareExpiry(@Param("approvalId") UUID approvalId);

    @Update("""
            UPDATE approval_request
            SET status = #{finalStatus}, decided_at = now(),
                decision_source = #{source}, policy = #{policy}, rule = #{rule}, reason = #{reason}
            WHERE id = #{approvalId}
              AND status = #{preparingStatus}
            """)
    int finalizeDecision(
            @Param("approvalId") UUID approvalId,
            @Param("preparingStatus") String preparingStatus,
            @Param("finalStatus") String finalStatus,
            @Param("source") String source,
            @Param("policy") String policy,
            @Param("rule") String rule,
            @Param("reason") String reason
    );

    @Insert("""
            INSERT INTO approval_audit (
                id, approval_id, task_id, attempt_id, actor, decision, policy, rule, reason
            )
            SELECT #{id}, ar.id, ar.task_id, ar.attempt_id, #{actor}, #{decision},
                   #{policy}, #{rule}, #{reason}
            FROM approval_request ar WHERE ar.id = #{approvalId}
            ON CONFLICT (approval_id, decision) DO NOTHING
            """)
    int insertAudit(@Param("id") UUID id, @Param("approvalId") UUID approvalId,
            @Param("actor") String actor, @Param("decision") String decision,
            @Param("policy") String policy, @Param("rule") String rule, @Param("reason") String reason);

    @Select(SELECT_COLUMNS + """
             WHERE ar.status IN ('PENDING', 'APPROVING', 'DENYING', 'AUTO_APPROVING', 'EXPIRING')
               AND ar.expires_at <= now()
             ORDER BY ar.expires_at
             LIMIT #{limit}
            """)
    List<ApprovalRow> findExpired(@Param("limit") int limit);
}
