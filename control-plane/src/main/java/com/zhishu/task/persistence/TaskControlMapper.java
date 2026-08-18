package com.zhishu.task.persistence;

import java.util.UUID;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;

@Mapper
interface TaskControlMapper {

    @Update("""
            UPDATE task_attempt
            SET status = 'CANCELLING', version = version + 1
            WHERE id = #{attemptId}
              AND task_id = #{taskId}
              AND status IN ('STARTING', 'RUNNING', 'WAITING_APPROVAL')
            """)
    int claimCancellation(@Param("taskId") UUID taskId, @Param("attemptId") UUID attemptId);

    @Update("""
            UPDATE approval_request
            SET status = 'EXPIRED', decided_at = now()
            WHERE attempt_id = #{attemptId}
              AND status IN ('PENDING', 'APPROVING', 'DENYING')
            """)
    int expirePendingApprovals(@Param("attemptId") UUID attemptId);

    @Update("""
            UPDATE agent_task
            SET status = 'PENDING',
                resolution_status = 'IN_PROGRESS',
                resolution_version = resolution_version + 1,
                updated_at = now()
            WHERE id = #{taskId}
              AND current_attempt_id = #{attemptId}
              AND status IN ('SUCCEEDED', 'FAILED', 'LOST', 'ABORTED')
            """)
    int claimRetry(@Param("taskId") UUID taskId, @Param("attemptId") UUID attemptId);
}
