package com.zhishu.task;

import java.util.Optional;
import java.util.UUID;

public interface ExecutionConfigurationRepository {

    Optional<ExecutionConfiguration> findEnabled(UUID projectId, UUID profileId);
}
