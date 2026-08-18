package com.zhishu.integration;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "zhishu.integration.execution")
public record IntegrationExecutionProperties(
        boolean enabled,
        Duration commandTimeout,
        int outputLimit,
        IntegrationSandboxMode sandboxMode
) {
    public IntegrationExecutionProperties {
        if (commandTimeout == null || commandTimeout.isZero() || commandTimeout.isNegative()) {
            throw new IllegalArgumentException("Integration command timeout must be positive");
        }
        if (outputLimit < 1_024 || outputLimit > 5_000_000) {
            throw new IllegalArgumentException("Integration output limit must be between 1024 and 5000000");
        }
        if (sandboxMode == null) sandboxMode = IntegrationSandboxMode.REQUIRED;
    }
}
