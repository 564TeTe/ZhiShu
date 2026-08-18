package com.zhishu.workspace;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Path;
import java.time.Duration;

import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

class WorkspaceProvisionerPropertiesTest {

    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withUserConfiguration(TestConfiguration.class)
            .withPropertyValues(
                    "zhishu.workspace.provisioning.root=build/test-workspaces",
                    "zhishu.workspace.provisioning.operation-timeout=45s",
                    "zhishu.workspace.provisioning.lease-duration=10m",
                    "zhishu.workspace.provisioning.scan-delay=2s",
                    "zhishu.workspace.provisioning.git-executable=custom-git"
            );

    @Test
    void bindsTheCanonicalRecordConstructorWhenConvenienceConstructorAlsoExists() {
        contextRunner.run(context -> {
            assertThat(context).hasNotFailed();
            WorkspaceProvisionerProperties properties = context.getBean(WorkspaceProvisionerProperties.class);
            assertThat(properties.root()).isEqualTo(Path.of("build/test-workspaces").toAbsolutePath().normalize());
            assertThat(properties.operationTimeout()).isEqualTo(Duration.ofSeconds(45));
            assertThat(properties.leaseDuration()).isEqualTo(Duration.ofMinutes(10));
            assertThat(properties.scanDelay()).isEqualTo(Duration.ofSeconds(2));
            assertThat(properties.gitExecutable()).isEqualTo("custom-git");
        });
    }

    @EnableConfigurationProperties(WorkspaceProvisionerProperties.class)
    private static class TestConfiguration {
    }
}
