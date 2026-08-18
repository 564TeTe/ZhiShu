package com.zhishu.event;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public interface TaskEventRepository {

    boolean attemptMatches(UUID taskId, UUID attemptId, String runtimeRunId);

    boolean insertIfAbsent(RuntimeEvent event);

    List<StoredTaskEvent> findUnprojected(UUID attemptId);

    void markProjected(long eventDatabaseId, Instant projectedAt);

    List<StoredTaskEvent> findAfter(UUID taskId, long afterId, int limit);
}
