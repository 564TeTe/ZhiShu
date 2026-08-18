package com.zhishu.task;

import java.util.UUID;

import com.zhishu.profile.AgentProfileSnapshot;

public record ExecutionConfiguration(
        UUID projectId,
        UUID profileId,
        String projectRef,
        AgentProfileSnapshot profileSnapshot
) {
}
