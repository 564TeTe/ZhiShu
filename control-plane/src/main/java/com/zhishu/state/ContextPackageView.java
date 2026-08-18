package com.zhishu.state;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public record ContextPackageView(
        UUID packageId,
        String packageType,
        CompositeContextVersion version,
        Map<String, Object> project,
        ProjectStateSnapshotView state,
        Map<String, Object> activePlan,
        List<StateEntryView> decisions,
        List<StateEntryView> constraints,
        List<StateEntryView> risks,
        List<ProjectChangeView> recentChanges,
        List<Map<String, Object>> derivedSystemFacts,
        Map<String, Object> truncation
) {
    public record CompositeContextVersion(
            long stateRevision,
            Long planVersion,
            long executionWatermark,
            Instant contextGeneratedAt,
            String contextPackageVersion
    ) {
    }
}
