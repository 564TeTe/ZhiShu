package com.zhishu.approval;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

import org.springframework.stereotype.Service;

@Service
public class ApprovalPolicyEvaluator {
    private static final Set<String> READ_TOOLS = Set.of(
            "read", "readfile", "glob", "grep", "search", "searchcode", "list", "listdirectory"
    );
    private static final Set<String> CREDENTIAL_NAMES = Set.of(
            ".env", ".npmrc", ".pypirc", "id_rsa", "id_ed25519", "credentials", "credentials.json",
            "service-account.json", "token", "token.json"
    );
    private static final Set<String> SHELL_META = Set.of("|", "||", "&", "&&", ";", ">", ">>", "<", "`", "$(");
    private static final List<List<String>> SAFE_COMMANDS = List.of(
            List.of("npm", "test"), List.of("npm", "run", "test"), List.of("npm", "run", "lint"),
            List.of("npm", "run", "build"), List.of("pnpm", "test"), List.of("pnpm", "lint"),
            List.of("pnpm", "build"), List.of("yarn", "test"), List.of("yarn", "lint"),
            List.of("yarn", "build"), List.of("mvn", "test"), List.of("mvn", "package"),
            List.of("./mvnw", "test"), List.of("./mvnw", "package"), List.of("gradle", "test"),
            List.of("gradle", "build"), List.of("./gradlew", "test"), List.of("./gradlew", "build"),
            List.of("git", "diff"), List.of("git", "status"), List.of("git", "log")
    );

    public ApprovalPolicyEvaluation evaluate(
            ApprovalPolicySnapshot policy,
            String toolName,
            Map<String, Object> toolInput
    ) {
        Path root;
        try {
            root = realOrNormalized(Path.of(policy.projectRoot()));
        } catch (RuntimeException | IOException error) {
            return deny("invalid-project-root", "Project root cannot be resolved safely");
        }
        List<String> textValues = flattenStrings(toolInput == null ? Map.of() : toolInput);
        for (String value : textValues) {
            if (mentionsCredential(value)) return deny("credential-file", "Credential files are never permitted");
        }
        for (Map.Entry<String, Object> entry : (toolInput == null ? Map.<String, Object>of() : toolInput).entrySet()) {
            if (isPathKey(entry.getKey())) {
                for (String value : flattenStrings(entry.getValue())) {
                    ApprovalPolicyEvaluation pathResult = validatePath(policy, root, value);
                    if (pathResult != null) return pathResult;
                }
            }
        }

        List<String> command = commandTokens(toolInput == null ? Map.of() : toolInput);
        if (!command.isEmpty()) {
            String joined = String.join(" ", command).toLowerCase(Locale.ROOT);
            if (containsShellMeta(joined)) return deny("shell-metacharacter", "Shell composition is not eligible for approval");
            for (String token : command.subList(1, command.size())) {
                String pathToken = token.contains("=") ? token.substring(token.indexOf('=') + 1) : token;
                if (looksLikePath(pathToken)) {
                    ApprovalPolicyEvaluation pathResult = validatePath(policy, root, pathToken);
                    if (pathResult != null) return pathResult;
                }
            }
            if (isDestructive(command)) return deny("dangerous-delete", "Destructive or system-level commands are forbidden");
            if (isNetworkUpload(command)) return deny("network-upload", "Network upload or publishing commands are forbidden");
        }

        if (policy.mode() == ApprovalMode.MANUAL) {
            return manual("manual-mode", "Project policy requires a user decision");
        }
        String normalizedTool = toolName == null ? "" : toolName.replaceAll("[^A-Za-z]", "").toLowerCase(Locale.ROOT);
        if (READ_TOOLS.contains(normalizedTool)) {
            return allow("safe-read-search", "Read/search operation is inside an allowed project directory");
        }
        if (!command.isEmpty() && SAFE_COMMANDS.contains(command)) {
            return allow("safe-command", "Command exactly matched a built-in test, lint, build, or read rule");
        }
        if (policy.mode() == ApprovalMode.AUTO_TRUSTED && policy.trustedCommands().contains(command)) {
            return allow("trusted-command", "Command exactly matched the project trusted command allowlist");
        }
        return manual("no-auto-rule", "No automatic approval rule matched this operation");
    }

    private ApprovalPolicyEvaluation validatePath(ApprovalPolicySnapshot policy, Path root, String raw) {
        if (raw == null || raw.isBlank() || raw.contains("\n")) return null;
        try {
            Path supplied = Path.of(raw);
            Path candidate = realOrNormalized(supplied.isAbsolute() ? supplied : root.resolve(supplied));
            if (!candidate.startsWith(root)) return deny("outside-project", "Path resolves outside the project root");
            boolean allowed = policy.allowedDirectories().stream().anyMatch(directory -> {
                try {
                    return candidate.startsWith(realOrNormalized(root.resolve(directory)));
                } catch (IOException | RuntimeException error) {
                    return false;
                }
            });
            if (!allowed) return deny("outside-allowed-directory", "Path is outside the configured project directories");
            return null;
        } catch (RuntimeException | IOException error) {
            return deny("invalid-path", "Path cannot be resolved safely");
        }
    }

    private Path realOrNormalized(Path path) throws IOException {
        Path absolute = path.toAbsolutePath().normalize();
        Path existing = absolute;
        List<Path> missing = new ArrayList<>();
        while (existing != null && !Files.exists(existing)) {
            Path name = existing.getFileName();
            if (name != null) missing.add(0, name);
            existing = existing.getParent();
        }
        Path resolved = existing == null ? absolute : existing.toRealPath();
        for (Path part : missing) resolved = resolved.resolve(part);
        return resolved.normalize();
    }

    private boolean isPathKey(String key) {
        String value = key.toLowerCase(Locale.ROOT);
        return value.contains("path") || value.equals("file") || value.equals("cwd") || value.equals("directory");
    }

    private boolean mentionsCredential(String value) {
        String normalized = value.replace('\\', '/').toLowerCase(Locale.ROOT);
        for (String segment : normalized.split("/")) {
            if (CREDENTIAL_NAMES.contains(segment) || segment.startsWith(".env.")) return true;
        }
        return normalized.contains("/.ssh/") || normalized.contains("/.aws/") || normalized.contains("private_key");
    }

    private List<String> commandTokens(Map<String, Object> input) {
        Object value = input.get("argv");
        if (value instanceof Collection<?> collection) {
            return collection.stream().map(String::valueOf).map(String::trim).filter(s -> !s.isEmpty()).toList();
        }
        value = input.getOrDefault("command", input.get("cmd"));
        if (!(value instanceof String text) || text.isBlank()) return List.of();
        return tokenize(text);
    }

    private List<String> tokenize(String command) {
        List<String> tokens = new ArrayList<>();
        StringBuilder token = new StringBuilder();
        char quote = 0;
        for (int i = 0; i < command.length(); i++) {
            char current = command.charAt(i);
            if ((current == '\'' || current == '"')) {
                if (quote == 0) quote = current;
                else if (quote == current) quote = 0;
                else token.append(current);
            } else if (Character.isWhitespace(current) && quote == 0) {
                if (!token.isEmpty()) { tokens.add(token.toString()); token.setLength(0); }
            } else token.append(current);
        }
        if (quote != 0) return List.of("__INVALID_QUOTE__");
        if (!token.isEmpty()) tokens.add(token.toString());
        return List.copyOf(tokens);
    }

    private boolean containsShellMeta(String command) {
        return SHELL_META.stream().anyMatch(command::contains) || command.contains("\n") || command.contains("\r");
    }

    private boolean isDestructive(List<String> command) {
        String executable = command.get(0).toLowerCase(Locale.ROOT);
        String joined = String.join(" ", command).toLowerCase(Locale.ROOT);
        return Set.of("rm", "rmdir", "del", "erase", "remove-item", "format", "diskpart", "reg", "shutdown").contains(executable)
                || joined.startsWith("git clean") || joined.startsWith("git reset --hard")
                || joined.contains("drop database") || joined.contains("truncate table");
    }

    private boolean looksLikePath(String value) {
        if (value == null || value.isBlank() || value.startsWith("-")
                || value.matches("(?i)^[a-z][a-z0-9+.-]*://.*")) return false;
        return value.startsWith("../") || value.startsWith("..\\") || value.startsWith("/")
                || value.matches("^[A-Za-z]:[\\\\/].*") || value.contains("/") || value.contains("\\");
    }

    private boolean isNetworkUpload(List<String> command) {
        String executable = command.get(0).toLowerCase(Locale.ROOT);
        String joined = String.join(" ", command).toLowerCase(Locale.ROOT);
        return Set.of("scp", "sftp", "ftp", "rsync", "nc", "netcat").contains(executable)
                || executable.equals("curl") || executable.equals("wget")
                || executable.equals("invoke-webrequest") || executable.equals("invoke-restmethod")
                || joined.startsWith("git push") || joined.startsWith("npm publish")
                || joined.startsWith("pnpm publish") || joined.startsWith("yarn publish")
                || joined.startsWith("docker push") || joined.startsWith("twine upload")
                || joined.startsWith("aws s3 ") || joined.startsWith("az storage ")
                || joined.startsWith("gcloud storage ") || joined.startsWith("gh release upload")
                || joined.contains(" deploy") || joined.contains(" publish");
    }

    private List<String> flattenStrings(Object value) {
        List<String> result = new ArrayList<>();
        if (value instanceof String text) result.add(text);
        else if (value instanceof Map<?, ?> map) map.values().forEach(item -> result.addAll(flattenStrings(item)));
        else if (value instanceof Collection<?> collection) collection.forEach(item -> result.addAll(flattenStrings(item)));
        return result;
    }

    private ApprovalPolicyEvaluation allow(String rule, String reason) {
        return new ApprovalPolicyEvaluation(ApprovalPolicyEvaluation.Outcome.AUTO_APPROVE, rule, reason);
    }
    private ApprovalPolicyEvaluation manual(String rule, String reason) {
        return new ApprovalPolicyEvaluation(ApprovalPolicyEvaluation.Outcome.MANUAL, rule, reason);
    }
    private ApprovalPolicyEvaluation deny(String rule, String reason) {
        return new ApprovalPolicyEvaluation(ApprovalPolicyEvaluation.Outcome.DENY, rule, reason);
    }
}
