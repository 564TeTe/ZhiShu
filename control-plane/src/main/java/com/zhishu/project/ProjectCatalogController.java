package com.zhishu.project;

import java.util.UUID;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

@RestController
@RequestMapping("/api/v1/projects")
public class ProjectCatalogController {

    private final ProjectCatalogService projects;

    public ProjectCatalogController(ProjectCatalogService projects) {
        this.projects = projects;
    }

    @PostMapping("/ensure")
    public ProjectRegistration ensure(@Valid @RequestBody EnsureProjectRequest request) {
        return projects.ensure(request.candidateProjectId(), request.projectRef(), request.displayName());
    }

    @GetMapping("/resolve")
    public ProjectRegistration resolve(@RequestParam String projectRef) {
        return projects.resolve(projectRef);
    }

    public record EnsureProjectRequest(
            @NotNull UUID candidateProjectId,
            @NotBlank String projectRef,
            @NotBlank String displayName
    ) {
    }
}
