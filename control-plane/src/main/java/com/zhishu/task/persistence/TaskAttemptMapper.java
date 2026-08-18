package com.zhishu.task.persistence;

import java.time.Instant;
import java.util.UUID;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

@Mapper
interface TaskAttemptMapper {

    @Select("""
            SELECT COALESCE(MAX(attempt_number), 0) + 1
            FROM task_attempt
            WHERE task_id = #{taskId}
            """)
    int nextAttemptNumber(@Param("taskId") UUID taskId);

    @Insert("""
            INSERT INTO task_attempt (
                id, task_id, attempt_number, runtime_run_id, status,
                profile_snapshot, approval_policy_snapshot, started_at, completed_at,
                error_code, error_message, created_at
            ) VALUES (
                #{id}, #{taskId}, #{attemptNumber}, #{runtimeRunId}, #{status},
                CAST(#{profileSnapshot} AS jsonb), CAST(#{approvalPolicySnapshot} AS jsonb), #{startedAt}, #{completedAt},
                #{errorCode}, #{errorMessage}, #{createdAt}
            )
            """)
    int insert(
            @Param("id") UUID id,
            @Param("taskId") UUID taskId,
            @Param("attemptNumber") int attemptNumber,
            @Param("runtimeRunId") String runtimeRunId,
            @Param("status") String status,
            @Param("profileSnapshot") String profileSnapshot,
            @Param("approvalPolicySnapshot") String approvalPolicySnapshot,
            @Param("startedAt") Instant startedAt,
            @Param("completedAt") Instant completedAt,
            @Param("errorCode") String errorCode,
            @Param("errorMessage") String errorMessage,
            @Param("createdAt") Instant createdAt
    );

    @Update("""
            UPDATE task_attempt
            SET runtime_run_id = #{runtimeRunId},
                status = #{targetStatus},
                started_at = #{startedAt},
                completed_at = #{completedAt},
                error_code = #{errorCode},
                error_message = #{errorMessage},
                version = version + 1
            WHERE id = #{id}
              AND status = #{expectedStatus}
            """)
    int compareAndSet(
            @Param("id") UUID id,
            @Param("expectedStatus") String expectedStatus,
            @Param("targetStatus") String targetStatus,
            @Param("runtimeRunId") String runtimeRunId,
            @Param("startedAt") Instant startedAt,
            @Param("completedAt") Instant completedAt,
            @Param("errorCode") String errorCode,
            @Param("errorMessage") String errorMessage
    );

    @Select("""
            SELECT id,
                   task_id AS taskId,
                   attempt_number AS attemptNumber,
                   profile_snapshot::text AS profileSnapshot,
                   approval_policy_snapshot::text AS approvalPolicySnapshot,
                   created_at AS createdAt
            FROM task_attempt
            WHERE id = #{attemptId}
              AND status = 'PENDING'
            """)
    TaskAttemptSnapshotRow findPending(@Param("attemptId") UUID attemptId);

    @Select("""
            SELECT profile_snapshot::text
            FROM task_attempt
            WHERE id = #{attemptId}
            """)
    String findProfileSnapshot(@Param("attemptId") UUID attemptId);

    @Select("""
            SELECT approval_policy_snapshot::text
            FROM task_attempt
            WHERE id = #{attemptId}
            """)
    String findApprovalPolicySnapshot(@Param("attemptId") UUID attemptId);
}
