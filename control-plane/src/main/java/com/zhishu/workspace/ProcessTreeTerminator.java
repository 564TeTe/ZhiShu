package com.zhishu.workspace;

import java.io.IOException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * Terminates a process and all descendants with a bounded grace period.
 * Integration and Git commands use this instead of terminating only the
 * launcher process, because npm, Maven and Git may leave child processes.
 */
public final class ProcessTreeTerminator {

    private ProcessTreeTerminator() {
    }

    public static void terminate(Process process, Duration gracePeriod) {
        if (process == null) return;
        Duration grace = gracePeriod == null || gracePeriod.isNegative() || gracePeriod.isZero()
                ? Duration.ofSeconds(2) : gracePeriod;
        List<ProcessHandle> descendants = process.toHandle().descendants().toList();
        List<ProcessHandle> reverse = new ArrayList<>(descendants);
        Collections.reverse(reverse);
        reverse.forEach(ProcessHandle::destroy);
        process.destroy();
        waitFor(reverse, grace);

        // A launcher can create a child after the first snapshot (npm and Maven
        // commonly do this). Capture a second snapshot before the forcible pass
        // so late descendants are not left running after the parent exits.
        List<ProcessHandle> lateDescendants = process.toHandle().descendants().toList();
        lateDescendants.stream().filter(handle -> !reverse.contains(handle)).forEach(ProcessHandle::destroy);
        if (process.isAlive()) process.destroyForcibly();
        lateDescendants.stream().filter(ProcessHandle::isAlive).forEach(ProcessHandle::destroyForcibly);
        reverse.stream().filter(ProcessHandle::isAlive).forEach(ProcessHandle::destroyForcibly);
        List<ProcessHandle> allDescendants = new ArrayList<>(reverse);
        lateDescendants.stream().filter(handle -> !allDescendants.contains(handle)).forEach(allDescendants::add);
        waitFor(allDescendants, grace);
    }

    public static byte[] awaitOutput(
            java.util.concurrent.Future<byte[]> output,
            Process process,
            Duration timeout
    ) throws IOException {
        try {
            return output.get(timeout.toMillis(), TimeUnit.MILLISECONDS);
        } catch (java.util.concurrent.TimeoutException error) {
            close(process);
            output.cancel(true);
            throw new IOException("Process output was not collected before the bounded timeout.", error);
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            close(process);
            output.cancel(true);
            throw new IOException("Process output collection was interrupted.", error);
        } catch (java.util.concurrent.ExecutionException error) {
            Throwable cause = error.getCause();
            if (cause instanceof java.io.UncheckedIOException unchecked) throw unchecked.getCause();
            throw new IOException("Process output collection failed.", cause);
        }
    }

    public static void close(Process process) {
        if (process == null) return;
        try {
            process.getInputStream().close();
        } catch (IOException ignored) {
            // The process is already being terminated; its streams are best effort.
        }
        try {
            process.getErrorStream().close();
        } catch (IOException ignored) {
            // The process is already being terminated; its streams are best effort.
        }
        try {
            process.getOutputStream().close();
        } catch (IOException ignored) {
            // The process is already being terminated; its streams are best effort.
        }
    }

    private static void waitFor(List<ProcessHandle> handles, Duration timeout) {
        long deadline = System.nanoTime() + timeout.toNanos();
        for (ProcessHandle handle : handles) {
            long remaining = deadline - System.nanoTime();
            if (remaining <= 0) return;
            try {
                handle.onExit().get(remaining, TimeUnit.NANOSECONDS);
            } catch (Exception ignored) {
                // The forcible pass below handles descendants that ignore SIGTERM.
            }
        }
    }
}
