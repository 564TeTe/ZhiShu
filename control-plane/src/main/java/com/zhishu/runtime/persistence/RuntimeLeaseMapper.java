package com.zhishu.runtime.persistence;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

@Mapper
interface RuntimeLeaseMapper {

    @Update("""
            UPDATE task_attempt
            SET runtime_health_status = 'HEALTHY',
                last_heartbeat_at = #{observedAt},
                lease_expires_at = #{leaseExpiresAt},
                unknown_since = NULL,
                version = version + 1
            WHERE id = #{attemptId}
              AND status IN ('STARTING', 'RUNNING', 'WAITING_APPROVAL', 'CANCELLING')
              AND runtime_health_status IN ('NOT_MONITORED', 'HEALTHY', 'UNKNOWN')
            """)
    int observe(
            @Param("attemptId") UUID attemptId,
            @Param("observedAt") Instant observedAt,
            @Param("leaseExpiresAt") Instant leaseExpiresAt
    );

    @Update("""
            UPDATE task_attempt
            SET runtime_health_status = 'UNKNOWN',
                unknown_since = #{unknownSince},
                version = version + 1
            WHERE status IN ('STARTING', 'RUNNING', 'WAITING_APPROVAL', 'CANCELLING')
              AND (
                  (runtime_health_status = 'HEALTHY' AND lease_expires_at <= #{leaseDeadline})
                  OR (
                      runtime_health_status = 'NOT_MONITORED'
                      AND COALESCE(started_at, created_at) <= #{unobservedCutoff}
                  )
              )
            """)
    int markExpiredUnknown(
            @Param("leaseDeadline") Instant leaseDeadline,
            @Param("unobservedCutoff") Instant unobservedCutoff,
            @Param("unknownSince") Instant unknownSince
    );

    @Select("""
            SELECT id::text AS attemptId,
                   task_id::text AS taskId,
                   status AS attemptStatus
            FROM task_attempt
            WHERE runtime_health_status = 'UNKNOWN'
              AND unknown_since <= #{unknownCutoff}
              AND status IN ('STARTING', 'RUNNING', 'WAITING_APPROVAL', 'CANCELLING')
            ORDER BY unknown_since, id
            FOR UPDATE SKIP LOCKED
            """)
    List<RuntimeLeaseRow> findLostCandidates(@Param("unknownCutoff") Instant unknownCutoff);

    @Update("""
            UPDATE task_attempt
            SET runtime_health_status = 'LOST',
                lost_at = #{lostAt},
                lost_reason = #{reason},
                lease_expires_at = NULL,
                version = version + 1
            WHERE id = #{attemptId}
              AND runtime_health_status = 'UNKNOWN'
              AND unknown_since <= #{unknownCutoff}
              AND status IN ('STARTING', 'RUNNING', 'WAITING_APPROVAL', 'CANCELLING')
            """)
    int markLost(
            @Param("attemptId") UUID attemptId,
            @Param("unknownCutoff") Instant unknownCutoff,
            @Param("lostAt") Instant lostAt,
            @Param("reason") String reason
    );
}
