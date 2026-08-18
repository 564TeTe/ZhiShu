package com.zhishu.workspace;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

import org.springframework.stereotype.Component;

/** Executes the adapter's fixed Git argv without invoking a command shell. */
@Component
public class GitCommandRunner {

    private static final int OUTPUT_LIMIT = 1_000_000;
    private final WorkspaceProvisionerProperties properties;

    public GitCommandRunner(WorkspaceProvisionerProperties properties) {
        this.properties = properties;
    }

    public Result run(Path repositoryRoot, List<String> arguments) throws IOException {
        return run(repositoryRoot, arguments, Map.of());
    }

    public Result run(
            Path repositoryRoot,
            List<String> arguments,
            Map<String, String> trustedEnvironment
    ) throws IOException {
        if (repositoryRoot == null || arguments == null || arguments.isEmpty()) {
            throw new IOException("Git repository root and argv are required.");
        }
        List<String> command = new ArrayList<>();
        command.add(properties.gitExecutable());
        Path disabledHooks = disabledHooksPath();
        command.add("-c");
        command.add("core.hooksPath=" + disabledHooks);
        command.add("-C");
        command.add(repositoryRoot.toString());
        command.addAll(arguments);
        ProcessBuilder builder = new ProcessBuilder(command);
        builder.directory(repositoryRoot.toFile());
        Map<String, String> environment = builder.environment();
        environment.remove("GIT_DIR");
        environment.remove("GIT_WORK_TREE");
        environment.remove("GIT_INDEX_FILE");
        environment.put("GIT_TERMINAL_PROMPT", "0");
        environment.put("GIT_CONFIG_NOSYSTEM", "1");
        for (Map.Entry<String, String> entry : trustedEnvironment.entrySet()) {
            if (!List.of(
                    "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL",
                    "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"
            ).contains(entry.getKey())) {
                throw new IOException("Git environment key is outside the adapter whitelist.");
            }
            environment.put(entry.getKey(), entry.getValue());
        }

        long started = System.nanoTime();
        Process process = builder.start();
        CompletableFuture<byte[]> stdout = CompletableFuture.supplyAsync(() -> read(process.getInputStream()));
        CompletableFuture<byte[]> stderr = CompletableFuture.supplyAsync(() -> read(process.getErrorStream()));
        boolean finished;
        try {
            finished = process.waitFor(properties.operationTimeout().toMillis(), TimeUnit.MILLISECONDS);
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            ProcessTreeTerminator.terminate(process, Duration.ofSeconds(2));
            throw new IOException("Git operation was interrupted.", error);
        }
        if (!finished) {
            ProcessTreeTerminator.terminate(process, Duration.ofSeconds(2));
            ProcessTreeTerminator.close(process);
            stdout.cancel(true);
            stderr.cancel(true);
            throw new IOException("Git operation exceeded " + properties.operationTimeout() + ".");
        }
        long durationMillis = Duration.ofNanos(System.nanoTime() - started).toMillis();
        byte[] out = ProcessTreeTerminator.awaitOutput(stdout, process, Duration.ofSeconds(5));
        byte[] err = ProcessTreeTerminator.awaitOutput(stderr, process, Duration.ofSeconds(5));
        return new Result(
                process.exitValue(), text(out), text(err), durationMillis,
                List.copyOf(arguments)
        );
    }

    private Path disabledHooksPath() throws IOException {
        // A fresh, non-existent path prevents candidate code from placing a hook in a
        // shared Control Plane directory between controlled Git operations.
        return Path.of(System.getProperty("java.io.tmpdir"),
                        "zhishu-disabled-git-hooks-" + UUID.randomUUID())
                .toAbsolutePath().normalize();
    }

    public Result requireSuccess(Path repositoryRoot, List<String> arguments) throws IOException {
        return requireSuccess(repositoryRoot, arguments, Map.of());
    }

    public Result requireSuccess(
            Path repositoryRoot,
            List<String> arguments,
            Map<String, String> trustedEnvironment
    ) throws IOException {
        Result result = run(repositoryRoot, arguments, trustedEnvironment);
        if (result.exitCode() != 0) {
            String detail = result.stderr().isBlank() ? result.stdout() : result.stderr();
            throw new IOException("Git " + arguments.get(0) + " failed with exit "
                    + result.exitCode() + ": " + detail.trim());
        }
        return result;
    }

    private byte[] read(java.io.InputStream stream) {
        try (stream) {
            byte[] bytes = stream.readNBytes(OUTPUT_LIMIT + 1);
            if (bytes.length <= OUTPUT_LIMIT) return bytes;
            return java.util.Arrays.copyOf(bytes, OUTPUT_LIMIT);
        } catch (IOException error) {
            throw new java.io.UncheckedIOException(error);
        }
    }

    private String text(byte[] bytes) {
        return new String(bytes, StandardCharsets.UTF_8);
    }

    public record Result(
            int exitCode,
            String stdout,
            String stderr,
            long durationMillis,
            List<String> arguments
    ) {
    }
}
