package com.zhishu.project;

import java.util.UUID;

public record ProjectRegistration(UUID projectId, UUID profileId, String projectRef, String profileName) {
}
