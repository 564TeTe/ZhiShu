package com.zhishu.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class IntegrationCommandRunnerTest {

    @TempDir
    Path temporaryRoot;

    @Test
    void boundsStdoutAndStderrToTheConfiguredLimit() throws Exception {
        Path workspace = Files.createDirectory(temporaryRoot.resolve("workspace"));
        IntegrationCommandRunner runner = new IntegrationCommandRunner(
                new IntegrationExecutionProperties(true, Duration.ofSeconds(10), 1_024,
                        IntegrationSandboxMode.BEST_EFFORT)
        );
        IntegrationExecutionPolicy policy = new IntegrationExecutionPolicy(
                "test", outputCommand("x", 5_000), outputCommand("y", 5_000)
        );

        IntegrationCommandRunner.Result result = runner.test(workspace, policy);

        assertThat(result.exitCode()).isZero();
        assertThat(result.stdout()).hasSize(1_024);
        assertThat(result.stderr()).hasSize(1_024);
    }

    @Test
    void timeoutTerminatesTheCommandWithinAReasonableBound() throws Exception {
        Path workspace = Files.createDirectory(temporaryRoot.resolve("workspace"));
        IntegrationCommandRunner runner = new IntegrationCommandRunner(
                new IntegrationExecutionProperties(true, Duration.ofMillis(200), 1_024,
                        IntegrationSandboxMode.BEST_EFFORT)
        );
        IntegrationExecutionPolicy policy = new IntegrationExecutionPolicy(
                "test", sleepCommand(), sleepCommand()
        );

        long started = System.nanoTime();
        assertThatThrownBy(() -> runner.test(workspace, policy))
                .isInstanceOf(IOException.class)
                .hasMessageContaining("exceeded");

        assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofSeconds(8));
    }

    @Test
    void rejectsAFileAndRequiredSandboxModeBeforeStartingAProcess() throws Exception {
        Path file = Files.createFile(temporaryRoot.resolve("not-a-workspace"));
        IntegrationExecutionPolicy policy = new IntegrationExecutionPolicy(
                "test", List.of("echo", "ok"), List.of("echo", "ok")
        );
        IntegrationCommandRunner bestEffort = new IntegrationCommandRunner(
                new IntegrationExecutionProperties(true, Duration.ofSeconds(10), 1_024,
                        IntegrationSandboxMode.BEST_EFFORT)
        );
        assertThatThrownBy(() -> bestEffort.test(file, policy))
                .isInstanceOf(IOException.class)
                .hasMessageContaining("canonical directory");

        IntegrationCommandRunner required = new IntegrationCommandRunner(
                new IntegrationExecutionProperties(true, Duration.ofSeconds(10), 1_024,
                        IntegrationSandboxMode.REQUIRED)
        );
        Path workspace = Files.createDirectory(temporaryRoot.resolve("workspace"));
        assertThatThrownBy(() -> required.test(workspace, policy))
                .isInstanceOf(IOException.class)
                .hasMessageContaining("full sandbox is required");
    }

    private List<String> outputCommand(String character, int count) {
        if (isWindows()) {
            return List.of("powershell", "-NoProfile", "-NonInteractive", "-Command",
                    "[Console]::Write(('" + character + "' * " + count + " -join '')); [Console]::Error.Write(('"
                            + character + "' * " + count + " -join ''))");
        }
        return List.of("sh", "-c", "printf '%0.s" + character + "' $(seq 1 " + count + "); printf '%0.s"
                + character + "' $(seq 1 " + count + ") >&2");
    }

    private List<String> sleepCommand() {
        if (isWindows()) {
            return List.of("powershell", "-NoProfile", "-NonInteractive", "-Command", "Start-Sleep -Seconds 10");
        }
        return List.of("sh", "-c", "sleep 10");
    }

    private boolean isWindows() {
        return System.getProperty("os.name", "").toLowerCase(java.util.Locale.ROOT).contains("win");
    }
}
