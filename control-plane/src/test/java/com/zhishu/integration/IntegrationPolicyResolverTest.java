package com.zhishu.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.zhishu.state.ProjectStateConflictException;

class IntegrationPolicyResolverTest {

    @TempDir
    Path root;

    private final IntegrationPolicyResolver resolver = new IntegrationPolicyResolver(new ObjectMapper());

    @Test
    void selectsTheFixedNpmPresetOnlyWhenBuildAndTestScriptsExist() throws Exception {
        Files.writeString(root.resolve("package.json"), """
                {"scripts":{"build":"vite build","test":"node --test"}}
                """);

        IntegrationExecutionPolicy policy = resolver.resolve(root);

        assertThat(policy.preset()).isEqualTo("NPM");
        assertThat(policy.buildCommand()).containsExactly("npm", "run", "build");
        assertThat(policy.testCommand()).containsExactly("npm", "test");
    }

    @Test
    void selectsTheFixedMavenPresetAtAMavenRepositoryRoot() throws Exception {
        Files.writeString(root.resolve("pom.xml"), "<project/>\n");

        IntegrationExecutionPolicy policy = resolver.resolve(root);

        assertThat(policy.preset()).isEqualTo("MAVEN");
        assertThat(policy.buildCommand()).containsExactly("mvn", "-q", "-DskipTests", "compile");
        assertThat(policy.testCommand()).containsExactly("mvn", "-q", "test");
    }

    @Test
    void rejectsMissingScriptsAndAmbiguousRepositoryRoots() throws Exception {
        Files.writeString(root.resolve("package.json"), "{\"scripts\":{\"build\":\"vite build\"}}\n");
        assertThatThrownBy(() -> resolver.resolve(root))
                .isInstanceOf(ProjectStateConflictException.class)
                .hasMessageContaining("build and test scripts");

        Files.writeString(root.resolve("package.json"), """
                {"scripts":{"build":"vite build","test":"node --test"}}
                """);
        Files.writeString(root.resolve("pom.xml"), "<project/>\n");
        assertThatThrownBy(() -> resolver.resolve(root))
                .isInstanceOf(ProjectStateConflictException.class)
                .hasMessageContaining("ambiguous");
    }
}
