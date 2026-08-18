package com.zhishu.project;

import java.util.UUID;

public record ProjectIdentityView(
        UUID projectId,
        String displayName,
        String repositoryIdentity,
        String status,
        long identityVersion
) {
}
