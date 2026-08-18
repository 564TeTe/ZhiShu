package com.zhishu.project;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.UUID;

import org.springframework.stereotype.Service;

@Service
public class WorkspaceBindingCommandService {

    private final WorkspaceIdentityResolutionService resolutions;
    private final WorkspaceBindingCommandRepository commands;

    public WorkspaceBindingCommandService(
            WorkspaceIdentityResolutionService resolutions,
            WorkspaceBindingCommandRepository commands
    ) {
        this.resolutions = resolutions;
        this.commands = commands;
    }

    public WorkspaceBindingChangeView confirm(
            UUID projectId,
            UUID workspaceId,
            UUID proposalId,
            String action,
            String machineId,
            String localProjectId,
            String workspacePath,
            long baseIdentityVersion,
            String actor,
            String clientRequestId
    ) {
        String normalizedActor = requireText(actor, "actor");
        String normalizedRequestId = requireText(clientRequestId, "clientRequestId");
        String normalizedMachineId = requireText(machineId, "machineId");
        String normalizedWorkspacePath = requireText(workspacePath, "workspacePath");
        String normalizedLocalProjectId = localProjectId == null || localProjectId.isBlank()
                ? null
                : localProjectId.trim();
        String requestHash = sha256(String.join("|",
                proposalId.toString(), action, projectId.toString(), workspaceId.toString(),
                normalizedMachineId, normalizedLocalProjectId == null ? "" : normalizedLocalProjectId,
                normalizedWorkspacePath, Long.toString(baseIdentityVersion)
        ));
        WorkspaceBindingChangeView replay = commands.findReplay(
                normalizedActor, normalizedRequestId, requestHash
        ).orElse(null);
        if (replay != null) return replay;

        ProjectIdentityResolutionView resolution = resolutions.resolve(
                normalizedMachineId, normalizedLocalProjectId, normalizedWorkspacePath, null
        );
        WorkspaceBindingProposalView current = resolution.proposal();
        if (!"PROPOSAL_REQUIRED".equals(resolution.resolution()) || current == null) {
            throw new ProjectIdentityConflictException("The workspace no longer requires this proposal.");
        }
        if (!projectId.equals(current.targetProjectId())
                || !workspaceId.equals(resolution.binding().workspaceId())
                || !proposalId.equals(current.proposalId())
                || !action.equals(current.action())
                || baseIdentityVersion != current.baseIdentityVersion()) {
            throw new ProjectIdentityConflictException("The workspace proposal is stale or does not match current identity facts.");
        }

        return commands.apply(new WorkspaceBindingCommand(
                proposalId,
                action,
                projectId,
                workspaceId,
                normalizedMachineId,
                normalizedLocalProjectId,
                normalizedWorkspacePath,
                normalizedWorkspacePath,
                baseIdentityVersion,
                normalizedActor,
                normalizedRequestId,
                requestHash
        ));
    }

    private String requireText(String value, String field) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(field + " is required");
        return value.trim();
    }

    private String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("SHA-256 is unavailable", error);
        }
    }
}
