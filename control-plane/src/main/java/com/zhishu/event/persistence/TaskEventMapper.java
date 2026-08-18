package com.zhishu.event.persistence;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

@Mapper
interface TaskEventMapper {

    @Select("""
            SELECT EXISTS (
                SELECT 1
                FROM task_attempt
                WHERE id = #{attemptId}
                  AND task_id = #{taskId}
                  AND (runtime_run_id IS NULL OR runtime_run_id = #{runtimeRunId})
            )
            """)
    boolean attemptMatches(
            @Param("taskId") UUID taskId,
            @Param("attemptId") UUID attemptId,
            @Param("runtimeRunId") String runtimeRunId
    );

    @Insert("""
            INSERT INTO task_event (
                event_id, task_id, attempt_id, runtime_run_id, sequence_no, event_type, payload, occurred_at
            ) VALUES (
                #{eventId}, #{taskId}, #{attemptId}, #{runtimeRunId}, #{sequenceNo}, #{eventType},
                CAST(#{payloadJson} AS jsonb), #{occurredAt}
            )
            ON CONFLICT DO NOTHING
            """)
    int insertIfAbsent(
            @Param("eventId") String eventId,
            @Param("taskId") UUID taskId,
            @Param("attemptId") UUID attemptId,
            @Param("runtimeRunId") String runtimeRunId,
            @Param("sequenceNo") long sequenceNo,
            @Param("eventType") String eventType,
            @Param("payloadJson") String payloadJson,
            @Param("occurredAt") Instant occurredAt
    );

    @Select("""
            SELECT id AS id,
                   event_id AS eventId,
                   task_id::text AS "taskId",
                   attempt_id::text AS "attemptId",
                   runtime_run_id AS runtimeRunId,
                   sequence_no AS sequenceNo,
                   event_type AS eventType,
                   payload::text AS payloadJson,
                   occurred_at AS occurredAt,
                   received_at AS receivedAt
            FROM task_event
            WHERE attempt_id = #{attemptId}
              AND projected_at IS NULL
            ORDER BY sequence_no, id
            """)
    List<TaskEventRow> findUnprojected(@Param("attemptId") UUID attemptId);

    @Update("""
            UPDATE task_event
            SET projected_at = #{projectedAt}
            WHERE id = #{eventId} AND projected_at IS NULL
            """)
    int markProjected(@Param("eventId") long eventId, @Param("projectedAt") Instant projectedAt);

    @Select("""
            SELECT id AS id,
                   event_id AS eventId,
                   task_id::text AS "taskId",
                   attempt_id::text AS "attemptId",
                   runtime_run_id AS runtimeRunId,
                   sequence_no AS sequenceNo,
                   event_type AS eventType,
                   payload::text AS payloadJson,
                   occurred_at AS occurredAt,
                   received_at AS receivedAt
            FROM task_event
            WHERE task_id = #{taskId}
              AND id > #{afterId}
            ORDER BY id
            LIMIT #{limit}
            """)
    List<TaskEventRow> findAfter(
            @Param("taskId") UUID taskId,
            @Param("afterId") long afterId,
            @Param("limit") int limit
    );

    @Select("""
            SELECT id AS id,
                   event_id AS eventId,
                   task_id::text AS "taskId",
                   attempt_id::text AS "attemptId",
                   runtime_run_id AS runtimeRunId,
                   sequence_no AS sequenceNo,
                   event_type AS eventType,
                   payload::text AS payloadJson,
                   occurred_at AS occurredAt,
                   received_at AS receivedAt
            FROM task_event
            WHERE event_id = #{eventId}
               OR (attempt_id = #{attemptId} AND sequence_no = #{sequenceNo})
            ORDER BY CASE WHEN event_id = #{eventId} THEN 0 ELSE 1 END
            LIMIT 1
            """)
    TaskEventRow findConflict(
            @Param("eventId") String eventId,
            @Param("attemptId") UUID attemptId,
            @Param("sequenceNo") long sequenceNo
    );
}
