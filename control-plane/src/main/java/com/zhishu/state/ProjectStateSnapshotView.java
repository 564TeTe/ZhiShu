package com.zhishu.state;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record ProjectStateSnapshotView(
        String schemaVersion,
        UUID projectId,
        long stateRevision,
        StateEntryView goal,
        StateEntryView stage,
        String summary,
        String blocker,
        List<StateEntryView> entries,
        Instant updatedAt
) {
}
