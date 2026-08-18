package com.zhishu.integration;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

import org.springframework.stereotype.Component;

import com.zhishu.workspace.ProcessTreeTerminator;

/** Runs the frozen server-owned project preset directly in the isolated Integration Worktree. */
@Component
public class IntegrationCommandRunner {

    private static final Set<String> SAFE_ENVIRONMENT_KEYS = Set.of(
            "PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP",
            "USERPROFILE", "HOME", "JAVA_HOME", "MAVEN_HOME", "M2_HOME", "NPM_CONFIG_CACHE"
    );

    private final IntegrationExecutionProperties properties;

    public IntegrationCommandRunner(IntegrationExecutionProperties properties) {
        this.properties = properties;
    }

    public Result build(Path workspace, IntegrationExecutionPolicy policy) throws IOException {
        return run(workspace, policy.buildCommand());
    }

    public Result test(Path workspace, IntegrationExecutionPolicy policy) throws IOException {
        return run(workspace, policy.testCommand());
    }

    private Result run(Path workspace, List<String> configured) throws IOException {
        verifySandboxCapability();
        List<String> command = new ArrayList<>(configured);
        if (isWindows()) {
            if ("npm".equalsIgnoreCase(command.get(0))) command.set(0, "npm.cmd");
            if ("mvn".equalsIgnoreCase(command.get(0))) command.set(0, "mvn.cmd");
            if ("mvnw".equalsIgnoreCase(command.get(0))) command.set(0, "mvnw.cmd");
        }
        Path executionDirectory = requireExecutionDirectory(workspace);
        ProcessBuilder builder = new ProcessBuilder(command);
        builder.directory(executionDirectory.toFile());
        Map<String, String> inherited = new HashMap<>(builder.environment());
        Map<String, String> environment = builder.environment();
        environment.clear();
        inherited.forEach((key, value) -> {
            if (SAFE_ENVIRONMENT_KEYS.contains(key.toUpperCase(java.util.Locale.ROOT))) {
                environment.put(key, value);
            }
        });
        environment.put("CI", "true");
        environment.put("GIT_TERMINAL_PROMPT", "0");
        environment.put("GIT_CONFIG_NOSYSTEM", "1");
        environment.remove("GIT_DIR");
        environment.remove("GIT_WORK_TREE");
        environment.remove("GIT_INDEX_FILE");

        long started = System.nanoTime();
        Process process = builder.start();
        CompletableFuture<byte[]> stdout = CompletableFuture.supplyAsync(() -> read(process.getInputStream()));
        CompletableFuture<byte[]> stderr = CompletableFuture.supplyAsync(() -> read(process.getErrorStream()));
        boolean finished;
        try {
            finished = process.waitFor(properties.commandTimeout().toMillis(), TimeUnit.MILLISECONDS);
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            ProcessTreeTerminator.terminate(process, Duration.ofSeconds(2));
            ProcessTreeTerminator.close(process);
            throw new IOException("Integration command was interrupted.", error);
        }
        if (!finished) {
            ProcessTreeTerminator.terminate(process, Duration.ofSeconds(2));
            ProcessTreeTerminator.close(process);
            stdout.cancel(true);
            stderr.cancel(true);
            throw new IOException("Integration command exceeded " + properties.commandTimeout() + ".");
        }
        byte[] out = ProcessTreeTerminator.awaitOutput(stdout, process, Duration.ofSeconds(5));
        byte[] err = ProcessTreeTerminator.awaitOutput(stderr, process, Duration.ofSeconds(5));
        return new Result(
                process.exitValue(), text(out), text(err),
                Duration.ofNanos(System.nanoTime() - started).toMillis(), List.copyOf(command)
        );
    }

    private Path requireExecutionDirectory(Path workspace) throws IOException {
        if (workspace == null) throw new IOException("Integration workspace is required.");
        Path normalized = workspace.toAbsolutePath().normalize();
        if (!Files.isDirectory(normalized, LinkOption.NOFOLLOW_LINKS)
                || Files.isSymbolicLink(normalized)) {
            throw new IOException("Integration workspace must be a canonical directory.");
        }
        Path real = normalized.toRealPath();
        if (!real.equals(normalized)) throw new IOException("Integration workspace resolves through a link.");
        return real;
    }

    private byte[] read(java.io.InputStream stream) {
        try (stream) {
            byte[] bytes = stream.readNBytes(properties.outputLimit() + 1);
            if (bytes.length <= properties.outputLimit()) return bytes;
            return java.util.Arrays.copyOf(bytes, properties.outputLimit());
        } catch (IOException error) {
            throw new java.io.UncheckedIOException(error);
        }
    }

    private String text(byte[] bytes) {
        return new String(bytes, StandardCharsets.UTF_8);
    }

    private boolean isWindows() {
        return System.getProperty("os.name", "").toLowerCase(java.util.Locale.ROOT).contains("win");
    }

    void verifySandboxCapability() throws IOException {
        if (properties.sandboxMode() == IntegrationSandboxMode.REQUIRED) {
            throw new IOException(
                    "Integration full sandbox is required, but this Control Plane build has no "
                            + "OS-level CPU, memory, disk and network isolation provider."
            );
        }
    }

    public record Result(
            int exitCode,
            String stdout,
            String stderr,
            long durationMillis,
            List<String> command
    ) {
    }
}
