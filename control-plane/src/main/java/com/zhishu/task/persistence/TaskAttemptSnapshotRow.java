package com.zhishu.task.persistence;

import java.time.Instant;
import java.util.UUID;

record TaskAttemptSnapshotRow(
        UUID id,
        UUID taskId,
        int attemptNumber,
        String profileSnapshot,
        String approvalPolicySnapshot,
        Instant createdAt
) {
}
