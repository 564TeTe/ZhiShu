package com.zhishu.projectactivity;

import java.util.List;
import java.util.UUID;

public record ProjectActivityFeed(
        String schemaVersion,
        UUID projectId,
        String status,
        Long requestedAfterCursor,
        long latestCursor,
        long retentionFloorCursor,
        long nextCursor,
        boolean hasMore,
        List<ProjectActivityEvent> events
) {
}
