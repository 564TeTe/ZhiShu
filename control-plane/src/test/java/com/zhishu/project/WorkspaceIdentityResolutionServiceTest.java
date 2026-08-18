package com.zhishu.project;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.Test;

class WorkspaceIdentityResolutionServiceTest {

    @Test
    void prefersMachineScopedLocalProjectMatch() {
        WorkspaceProjectMatch match = match(UUID.randomUUID(), "machine-1", "local-1", "D:\\demo");
        WorkspaceBindingRepository repository = repository(Optional.of(match), Optional.empty(), List.of(), List.of());

        ProjectIdentityResolutionView result = new WorkspaceIdentityResolutionService(repository)
                .resolve(" machine-1 ", " local-1 ", " D:\\demo ", null);

        assertThat(result.resolution()).isEqualTo("MATCHED_BY_LOCAL_PROJECT_ID");
        assertThat(result.project()).isEqualTo(match.project());
        assertThat(result.executionRegistration()).isEqualTo(match.executionRegistration());
        assertThat(result.candidates()).hasSize(1);
    }

    @Test
    void reportsAmbiguityWithoutChoosingOrWriting() {
        WorkspaceProjectMatch localMatch = match(UUID.randomUUID(), "machine-1", "local-1", "D:\\old");
        WorkspaceProjectMatch pathMatch = match(UUID.randomUUID(), "machine-1", "local-2", "D:\\demo");
        WorkspaceBindingRepository repository = repository(
                Optional.of(localMatch), Optional.of(pathMatch), List.of(), List.of()
        );

        ProjectIdentityResolutionView result = new WorkspaceIdentityResolutionService(repository)
                .resolve("machine-1", "local-1", "D:\\demo", null);

        assertThat(result.resolution()).isEqualTo("AMBIGUOUS");
        assertThat(result.project()).isNull();
        assertThat(result.binding()).isNull();
        assertThat(result.executionRegistration()).isNull();
        assertThat(result.candidates()).hasSize(2);
    }

    @Test
    void turnsLegacyPathMatchIntoExplicitRebindProposal() {
        WorkspaceProjectMatch match = match(UUID.randomUUID(), "legacy-unscoped", null, "D:\\demo");
        WorkspaceBindingRepository repository = repository(
                Optional.empty(), Optional.empty(), List.of(), List.of(match)
        );

        ProjectIdentityResolutionView result = new WorkspaceIdentityResolutionService(repository)
                .resolve("machine-1", "local-1", "D:\\demo", null);

        assertThat(result.resolution()).isEqualTo("PROPOSAL_REQUIRED");
        assertThat(result.candidates().getFirst().matchedBy()).containsExactly("LEGACY_RUNTIME_REF");
        assertThat(result.candidates().getFirst().confidence()).isEqualTo("WEAK");
        assertThat(result.proposal().action()).isEqualTo("REBIND_LOCAL_PROJECT");
    }

    private WorkspaceBindingRepository repository(
            Optional<WorkspaceProjectMatch> local,
            Optional<WorkspaceProjectMatch> path,
            List<WorkspaceProjectMatch> remote,
            List<WorkspaceProjectMatch> compatibility
    ) {
        return new WorkspaceBindingRepository() {
            @Override public Optional<WorkspaceProjectMatch> findByMachineAndLocalProjectId(String machineId, String localProjectId) { return local; }
            @Override public Optional<WorkspaceProjectMatch> findByMachineAndPath(String machineId, String normalizedWorkspacePath) { return path; }
            @Override public List<WorkspaceProjectMatch> findByRemoteFingerprint(String remoteFingerprint) { return remote; }
            @Override public List<WorkspaceProjectMatch> findCompatibilityPath(String normalizedWorkspacePath) { return compatibility; }
        };
    }

    private WorkspaceProjectMatch match(UUID projectId, String machineId, String localProjectId, String path) {
        UUID profileId = UUID.randomUUID();
        return new WorkspaceProjectMatch(
                new ProjectIdentityView(projectId, "Demo", null, "ACTIVE", 1),
                new WorkspaceBindingView(
                        UUID.randomUUID(), projectId, machineId, localProjectId, path, path,
                        null, null, null, true, "ACTIVE", Instant.parse("2026-08-15T00:00:00Z")
                ),
                new ProjectRegistration(projectId, profileId, path, "Default")
        );
    }
}
