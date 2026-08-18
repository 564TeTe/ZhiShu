package com.zhishu.workspace;

import java.nio.file.Path;
import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.ConstructorBinding;

@ConfigurationProperties(prefix = "zhishu.workspace.provisioning")
public record WorkspaceProvisionerProperties(
        Path root,
        Duration operationTimeout,
        Duration leaseDuration,
        Duration scanDelay,
        String gitExecutable
) {
    public WorkspaceProvisionerProperties(
            Path root,
            Duration operationTimeout,
            Duration leaseDuration,
            Duration scanDelay
    ) {
        this(root, operationTimeout, leaseDuration, scanDelay, "git");
    }

    @ConstructorBinding
    public WorkspaceProvisionerProperties {
        if (root == null) throw new IllegalArgumentException("Workspace provisioning root is required");
        root = root.toAbsolutePath().normalize();
        if (operationTimeout == null || operationTimeout.isZero() || operationTimeout.isNegative()) {
            throw new IllegalArgumentException("Workspace provisioning operation timeout must be positive");
        }
        if (leaseDuration == null || leaseDuration.isZero() || leaseDuration.isNegative()) {
            throw new IllegalArgumentException("Workspace provisioning lease duration must be positive");
        }
        if (scanDelay == null || scanDelay.isZero() || scanDelay.isNegative()) {
            throw new IllegalArgumentException("Workspace provisioning scan delay must be positive");
        }
        if (gitExecutable == null || gitExecutable.isBlank()) gitExecutable = "git";
        else gitExecutable = gitExecutable.trim();
    }
}
