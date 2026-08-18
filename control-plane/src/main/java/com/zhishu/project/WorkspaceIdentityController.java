package com.zhishu.project;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

@RestController
@RequestMapping("/internal/project-control/v1")
public class WorkspaceIdentityController {

    private final WorkspaceIdentityResolutionService resolutionService;
    private final WorkspaceBindingCommandService commandService;

    public WorkspaceIdentityController(
            WorkspaceIdentityResolutionService resolutionService,
            WorkspaceBindingCommandService commandService
    ) {
        this.resolutionService = resolutionService;
        this.commandService = commandService;
    }

    @GetMapping("/workspaces/resolve")
    public ProjectIdentityResolutionView resolve(
            @RequestParam String machineId,
            @RequestParam(required = false) String localProjectId,
            @RequestParam String normalizedWorkspacePath,
            @RequestParam(required = false) String remoteFingerprint
    ) {
        return resolutionService.resolve(machineId, localProjectId, normalizedWorkspacePath, remoteFingerprint);
    }

    @PostMapping("/projects/{projectId}/workspace-bindings/{workspaceId}/confirm")
    public WorkspaceBindingChangeView confirm(
            @PathVariable UUID projectId,
            @PathVariable UUID workspaceId,
            @RequestHeader("X-Zhishu-Actor") String actor,
            @Valid @RequestBody ConfirmWorkspaceBindingRequest request
    ) {
        return commandService.confirm(
                projectId,
                workspaceId,
                request.proposalId(),
                request.action(),
                request.machineId(),
                request.localProjectId(),
                request.workspacePath(),
                request.baseIdentityVersion(),
                actor,
                request.clientRequestId()
        );
    }

    public record ConfirmWorkspaceBindingRequest(
            @NotNull UUID proposalId,
            @NotBlank String action,
            @NotBlank String machineId,
            String localProjectId,
            @NotBlank String workspacePath,
            @Min(1) long baseIdentityVersion,
            @NotBlank @Size(max = 120) String clientRequestId
    ) {
    }
}
