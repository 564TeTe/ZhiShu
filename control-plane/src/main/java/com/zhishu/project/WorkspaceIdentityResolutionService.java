package com.zhishu.project;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.nio.charset.StandardCharsets;

import org.springframework.stereotype.Service;

@Service
public class WorkspaceIdentityResolutionService {

    private final WorkspaceBindingRepository workspaceBindings;

    public WorkspaceIdentityResolutionService(WorkspaceBindingRepository workspaceBindings) {
        this.workspaceBindings = workspaceBindings;
    }

    public ProjectIdentityResolutionView resolve(
            String machineId,
            String localProjectId,
            String normalizedWorkspacePath,
            String remoteFingerprint
    ) {
        String machine = requireText(machineId, "machineId");
        String workspacePath = requireText(normalizedWorkspacePath, "normalizedWorkspacePath");
        String localId = optionalText(localProjectId);
        String fingerprint = optionalText(remoteFingerprint);

        Map<UUID, CandidateAccumulator> candidates = new LinkedHashMap<>();
        if (localId != null) {
            workspaceBindings.findByMachineAndLocalProjectId(machine, localId)
                    .ifPresent(match -> add(candidates, match, "LOCAL_PROJECT_ID"));
        }
        workspaceBindings.findByMachineAndPath(machine, workspacePath)
                .ifPresent(match -> add(candidates, match, "WORKSPACE_PATH"));
        if (fingerprint != null) {
            workspaceBindings.findByRemoteFingerprint(fingerprint)
                    .forEach(match -> add(candidates, match, "REMOTE_FINGERPRINT"));
        }
        if (candidates.isEmpty()) {
            workspaceBindings.findCompatibilityPath(workspacePath)
                    .forEach(match -> add(candidates, match, "LEGACY_RUNTIME_REF"));
        }

        List<ProjectIdentityCandidateView> candidateViews = candidates.values().stream()
                .map(CandidateAccumulator::toView)
                .toList();
        if (candidates.isEmpty()) {
            return new ProjectIdentityResolutionView(
                    "1.0", "NOT_FOUND", null, null, candidateViews, List.of(), null, null
            );
        }
        if (candidates.size() > 1) {
            return new ProjectIdentityResolutionView(
                    "1.0",
                    "AMBIGUOUS",
                    null,
                    null,
                    candidateViews,
                    List.of("Workspace identity signals resolve to more than one project."),
                    null,
                    null
            );
        }

        CandidateAccumulator candidate = candidates.values().iterator().next();
        WorkspaceBindingProposalView proposal = proposalFor(candidate, machine, localId, workspacePath);
        if (proposal != null) {
            return new ProjectIdentityResolutionView(
                    "1.0",
                    "PROPOSAL_REQUIRED",
                    candidate.match.project(),
                    candidate.match.binding(),
                    candidateViews,
                    List.of(),
                    proposal,
                    candidate.match.executionRegistration()
            );
        }
        String resolution = candidate.evidence.contains("LOCAL_PROJECT_ID")
                ? "MATCHED_BY_LOCAL_PROJECT_ID"
                : candidate.evidence.contains("WORKSPACE_PATH") || candidate.evidence.contains("LEGACY_RUNTIME_REF")
                        ? "MATCHED_BY_WORKSPACE_PATH"
                        : "MATCHED_BY_REMOTE_FINGERPRINT";
        return new ProjectIdentityResolutionView(
                "1.0",
                resolution,
                candidate.match.project(),
                candidate.match.binding(),
                candidateViews,
                List.of(),
                null,
                candidate.match.executionRegistration()
        );
    }

    private WorkspaceBindingProposalView proposalFor(
            CandidateAccumulator candidate,
            String machineId,
            String localProjectId,
            String workspacePath
    ) {
        WorkspaceBindingView binding = candidate.match.binding();
        String action = null;
        String reason = null;
        if (candidate.evidence.contains("LOCAL_PROJECT_ID")
                && !binding.normalizedWorkspacePath().equals(workspacePath)) {
            action = "MOVE_WORKSPACE";
            reason = "The same machine-scoped local project is now observed at a different path.";
        } else if ((candidate.evidence.contains("WORKSPACE_PATH")
                || candidate.evidence.contains("LEGACY_RUNTIME_REF"))
                && localProjectId != null
                && (!machineId.equals(binding.machineId())
                    || !localProjectId.equals(binding.localProjectId()))) {
            action = "REBIND_LOCAL_PROJECT";
            reason = "The workspace path matches, but its machine/local project locator changed.";
        }
        if (action == null) return null;

        ProjectIdentityView project = candidate.match.project();
        String proposalKey = String.join("|",
                action,
                project.projectId().toString(),
                binding.workspaceId().toString(),
                machineId,
                localProjectId == null ? "" : localProjectId,
                workspacePath,
                Long.toString(project.identityVersion())
        );
        return new WorkspaceBindingProposalView(
                UUID.nameUUIDFromBytes(proposalKey.getBytes(StandardCharsets.UTF_8)),
                action,
                machineId,
                localProjectId,
                workspacePath,
                project.projectId(),
                List.of(project.projectId()),
                List.of(reason),
                project.identityVersion(),
                "PENDING"
        );
    }

    private void add(
            Map<UUID, CandidateAccumulator> candidates,
            WorkspaceProjectMatch match,
            String evidence
    ) {
        candidates.computeIfAbsent(
                match.project().projectId(),
                ignored -> new CandidateAccumulator(match)
        ).evidence.add(evidence);
    }

    private String requireText(String value, String field) {
        String normalized = optionalText(value);
        if (normalized == null) {
            throw new IllegalArgumentException(field + " is required");
        }
        return normalized;
    }

    private String optionalText(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return value.trim();
    }

    private static final class CandidateAccumulator {
        private final WorkspaceProjectMatch match;
        private final LinkedHashSet<String> evidence = new LinkedHashSet<>();

        private CandidateAccumulator(WorkspaceProjectMatch match) {
            this.match = match;
        }

        private ProjectIdentityCandidateView toView() {
            List<String> matchedBy = new ArrayList<>(evidence);
            String confidence = evidence.contains("LOCAL_PROJECT_ID") || evidence.contains("WORKSPACE_PATH")
                    ? "EXACT"
                    : evidence.contains("REMOTE_FINGERPRINT") ? "STRONG" : "WEAK";
            return new ProjectIdentityCandidateView(match.project(), matchedBy, confidence);
        }
    }
}
