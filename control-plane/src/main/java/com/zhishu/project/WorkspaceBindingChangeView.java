package com.zhishu.project;

import java.time.Instant;
import java.util.UUID;

public record WorkspaceBindingChangeView(
        UUID changeId,
        UUID proposalId,
        String action,
        String actor,
        String clientRequestId,
        long baseIdentityVersion,
        long resultingIdentityVersion,
        WorkspaceBindingView binding,
        Instant createdAt
) {
}
