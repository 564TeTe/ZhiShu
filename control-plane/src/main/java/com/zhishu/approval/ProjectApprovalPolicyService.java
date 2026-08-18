package com.zhishu.approval;

import java.nio.file.Path;
import java.time.Clock;
import java.util.List;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Autowired;

import com.zhishu.task.TaskNotFoundException;

@Service
public class ProjectApprovalPolicyService {

    private final ProjectApprovalPolicyRepository policies;
    private final Clock clock;

    @Autowired
    public ProjectApprovalPolicyService(ProjectApprovalPolicyRepository policies) {
        this(policies, Clock.systemUTC());
    }

    ProjectApprovalPolicyService(ProjectApprovalPolicyRepository policies, Clock clock) {
        this.policies = policies;
        this.clock = clock;
    }

    public ProjectApprovalPolicyView get(UUID projectId) {
        return policies.findByProjectId(projectId)
                .orElseThrow(() -> new TaskNotFoundException("Project approval policy was not found: " + projectId));
    }

    public ApprovalPolicySnapshot resolve(UUID projectId, ApprovalMode requestedMode) {
        return get(projectId).resolve(requestedMode);
    }

    public ApprovalPolicySnapshot resolveForRoot(
            UUID projectId,
            ApprovalMode requestedMode,
            String projectRoot
    ) {
        Path root = Path.of(projectRoot).normalize();
        if (!root.isAbsolute()) {
            throw new IllegalArgumentException("Approval policy project root must be absolute");
        }
        ApprovalPolicySnapshot base = resolve(projectId, requestedMode);
        return new ApprovalPolicySnapshot(
                base.mode(), base.requestedMode(), root.toString(), base.allowedDirectories(),
                base.trustedCommands(), base.approvalTimeoutSeconds()
        );
    }

    public ProjectApprovalPolicyView update(
            UUID projectId,
            ApprovalMode mode,
            List<String> allowedDirectories,
            List<List<String>> trustedCommands,
            int timeoutSeconds
    ) {
        ProjectApprovalPolicyView current = get(projectId);
        List<String> directories = normalizeDirectories(current.projectRoot(), allowedDirectories);
        List<List<String>> commands = normalizeCommands(trustedCommands);
        return policies.save(new ProjectApprovalPolicyView(
                projectId, current.projectRoot(), mode, directories, commands, timeoutSeconds, clock.instant()
        ));
    }

    private List<String> normalizeDirectories(String projectRoot, List<String> values) {
        Path root = Path.of(projectRoot).toAbsolutePath().normalize();
        List<String> normalized = values == null || values.isEmpty() ? List.of(".") : values.stream()
                .map(String::trim)
                .filter(value -> !value.isEmpty())
                .distinct()
                .toList();
        for (String value : normalized) {
            Path candidate = root.resolve(value).normalize();
            if (Path.of(value).isAbsolute() || !candidate.startsWith(root)) {
                throw new IllegalArgumentException("Allowed directory must be relative and inside the project: " + value);
            }
        }
        return normalized;
    }

    private List<List<String>> normalizeCommands(List<List<String>> values) {
        if (values == null) return List.of();
        return values.stream().map(command -> {
            List<String> tokens = command.stream().map(String::trim).filter(token -> !token.isEmpty()).toList();
            if (tokens.isEmpty()) throw new IllegalArgumentException("Trusted command cannot be empty");
            return tokens;
        }).distinct().toList();
    }
}
