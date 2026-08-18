package com.zhishu.task.persistence;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

@Mapper
interface TaskFollowUpMapper {

    String COLUMNS = """
            SELECT f.id::text AS id,
                   f.task_id::text AS "taskId",
                   f.parent_attempt_id::text AS "parentAttemptId",
                   f.attempt_id::text AS "attemptId",
                   f.client_request_id AS "clientRequestId",
                   f.actor,
                   f.feedback,
                   f.requested_acceptance AS "requestedAcceptance",
                   f.additional_context::text AS "additionalContextJson",
                   ta.attempt_number AS "attemptNumber",
                   ta.status AS "attemptStatus",
                   ta.error_code AS "errorCode",
                   ta.error_message AS "errorMessage",
                   acceptance.decision AS "acceptanceDecision",
                   acceptance.reason AS "acceptanceReason",
                   acceptance.created_at AS "acceptanceAt",
                   f.created_at AS "createdAt"
            FROM task_follow_up f
            JOIN task_attempt ta ON ta.id = f.attempt_id
            LEFT JOIN LATERAL (
                SELECT aa.decision, aa.reason, aa.created_at
                FROM task_acceptance_audit aa
                WHERE aa.attempt_id = f.attempt_id
                ORDER BY aa.created_at DESC
                LIMIT 1
            ) acceptance ON TRUE
            """;

    @Select(COLUMNS + " WHERE f.task_id = #{taskId} AND f.client_request_id = #{clientRequestId}")
    TaskFollowUpRow findByClientRequestId(
            @Param("taskId") UUID taskId,
            @Param("clientRequestId") String clientRequestId
    );

    @Select(COLUMNS + " WHERE f.task_id = #{taskId} ORDER BY f.created_at DESC")
    List<TaskFollowUpRow> findByTaskId(@Param("taskId") UUID taskId);

    @Insert("""
            INSERT INTO task_follow_up (
                id, task_id, parent_attempt_id, attempt_id, client_request_id, actor,
                feedback, requested_acceptance, additional_context, created_at
            ) VALUES (
                #{id}, #{taskId}, #{parentAttemptId}, #{attemptId}, #{clientRequestId}, #{actor},
                #{feedback}, #{requestedAcceptance}, CAST(#{additionalContext} AS jsonb), #{createdAt}
            )
            """)
    int insert(
            @Param("id") UUID id,
            @Param("taskId") UUID taskId,
            @Param("parentAttemptId") UUID parentAttemptId,
            @Param("attemptId") UUID attemptId,
            @Param("clientRequestId") String clientRequestId,
            @Param("actor") String actor,
            @Param("feedback") String feedback,
            @Param("requestedAcceptance") String requestedAcceptance,
            @Param("additionalContext") String additionalContext,
            @Param("createdAt") Instant createdAt
    );
}
