package com.zhishu.event.persistence;

import java.time.Instant;
import java.util.UUID;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

@Mapper
interface AttemptProjectionMapper {

    @Select("""
            SELECT id::text AS "attemptId", task_id::text AS "taskId", status AS status
            FROM task_attempt
            WHERE id = #{attemptId}
            FOR UPDATE
            """)
    AttemptProjectionRow lock(@Param("attemptId") UUID attemptId);

    @Update("""
            UPDATE task_attempt
            SET status = #{targetStatus},
                runtime_health_status = CASE
                    WHEN #{targetStatus} IN ('SUCCEEDED', 'FAILED', 'LOST', 'ABORTED')
                        AND runtime_health_status <> 'LOST' THEN 'TERMINATED'
                    ELSE runtime_health_status
                END,
                lease_expires_at = CASE
                    WHEN #{targetStatus} IN ('SUCCEEDED', 'FAILED', 'LOST', 'ABORTED') THEN NULL
                    ELSE lease_expires_at
                END,
                completed_at = COALESCE(#{completedAt}, completed_at),
                error_code = COALESCE(#{errorCode}, error_code),
                error_message = COALESCE(#{errorMessage}, error_message),
                version = version + 1
            WHERE id = #{attemptId}
              AND status = #{expectedStatus}
            """)
    int transition(
            @Param("attemptId") UUID attemptId,
            @Param("expectedStatus") String expectedStatus,
            @Param("targetStatus") String targetStatus,
            @Param("completedAt") Instant completedAt,
            @Param("errorCode") String errorCode,
            @Param("errorMessage") String errorMessage
    );
}
