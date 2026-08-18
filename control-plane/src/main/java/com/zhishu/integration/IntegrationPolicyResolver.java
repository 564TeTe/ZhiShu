package com.zhishu.integration;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.List;

import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zhishu.state.ProjectStateConflictException;

/** Selects one fixed project-level Integration preset without accepting command argv from clients. */
@Component
public class IntegrationPolicyResolver {

    private final ObjectMapper json;

    public IntegrationPolicyResolver(ObjectMapper json) {
        this.json = json;
    }

    IntegrationExecutionPolicy resolve(Path repositoryRoot) {
        Path root = repositoryRoot.toAbsolutePath().normalize();
        Path packageJson = root.resolve("package.json");
        Path pom = root.resolve("pom.xml");
        boolean npm = regularFile(packageJson);
        boolean maven = regularFile(pom);
        if (npm == maven) {
            throw new ProjectStateConflictException(npm
                    ? "Integration Policy is ambiguous because package.json and pom.xml both exist at repository root."
                    : "No supported Integration Policy preset was found at repository root.");
        }
        if (npm) {
            validateNpmScripts(packageJson);
            return new IntegrationExecutionPolicy(
                    "NPM", List.of("npm", "run", "build"), List.of("npm", "test")
            );
        }
        return new IntegrationExecutionPolicy(
                "MAVEN", List.of("mvn", "-q", "-DskipTests", "compile"), List.of("mvn", "-q", "test")
        );
    }

    private boolean regularFile(Path path) {
        return Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS) && !Files.isSymbolicLink(path);
    }

    private void validateNpmScripts(Path packageJson) {
        try {
            JsonNode scripts = json.readTree(Files.readString(packageJson)).path("scripts");
            if (!scripts.path("build").isTextual() || scripts.path("build").asText().isBlank()
                    || !scripts.path("test").isTextual() || scripts.path("test").asText().isBlank()) {
                throw new ProjectStateConflictException(
                        "NPM Integration Policy requires non-empty build and test scripts."
                );
            }
        } catch (IOException error) {
            throw new ProjectStateConflictException("NPM Integration Policy could not read package.json.");
        }
    }
}
