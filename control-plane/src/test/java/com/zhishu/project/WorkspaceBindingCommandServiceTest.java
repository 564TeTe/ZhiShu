package com.zhishu.project;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.Test;

class WorkspaceBindingCommandServiceTest {

    @Test
    void confirmsOnlyTheCurrentDeterministicMoveProposalWithActorAndIdempotencyKey() {
        UUID projectId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        WorkspaceProjectMatch match = match(projectId, workspaceId);
        WorkspaceIdentityResolutionService resolutions = new WorkspaceIdentityResolutionService(
                bindingRepository(match)
        );
        ProjectIdentityResolutionView proposed = resolutions.resolve(
                "machine-1", "local-1", "D:\\demo-moved", null
        );
        AtomicReference<WorkspaceBindingCommand> applied = new AtomicReference<>();
        WorkspaceBindingCommandRepository commands = new WorkspaceBindingCommandRepository() {
            @Override
            public Optional<WorkspaceBindingChangeView> findReplay(String actor, String clientRequestId, String hash) {
                return Optional.empty();
            }

            @Override
            public WorkspaceBindingChangeView apply(WorkspaceBindingCommand command) {
                applied.set(command);
                return new WorkspaceBindingChangeView(
                        UUID.randomUUID(), command.proposalId(), command.action(), command.actor(),
                        command.clientRequestId(), 1, 2, match.binding(), Instant.now()
                );
            }
        };

        WorkspaceBindingChangeView result = new WorkspaceBindingCommandService(resolutions, commands).confirm(
                projectId,
                workspaceId,
                proposed.proposal().proposalId(),
                "MOVE_WORKSPACE",
                "machine-1",
                "local-1",
                "D:\\demo-moved",
                1,
                " user:1 ",
                " request-1 "
        );

        assertThat(result.action()).isEqualTo("MOVE_WORKSPACE");
        assertThat(applied.get().actor()).isEqualTo("user:1");
        assertThat(applied.get().clientRequestId()).isEqualTo("request-1");
        assertThat(applied.get().requestHash()).hasSize(64);
    }

    private WorkspaceBindingRepository bindingRepository(WorkspaceProjectMatch match) {
        return new WorkspaceBindingRepository() {
            @Override public Optional<WorkspaceProjectMatch> findByMachineAndLocalProjectId(String machineId, String localProjectId) { return Optional.of(match); }
            @Override public Optional<WorkspaceProjectMatch> findByMachineAndPath(String machineId, String path) { return Optional.empty(); }
            @Override public List<WorkspaceProjectMatch> findByRemoteFingerprint(String fingerprint) { return List.of(); }
            @Override public List<WorkspaceProjectMatch> findCompatibilityPath(String path) { return List.of(); }
        };
    }

    private WorkspaceProjectMatch match(UUID projectId, UUID workspaceId) {
        WorkspaceBindingView binding = new WorkspaceBindingView(
                workspaceId, projectId, "machine-1", "local-1", "D:\\demo", "D:\\demo",
                null, null, null, true, "ACTIVE", Instant.parse("2026-08-15T00:00:00Z")
        );
        return new WorkspaceProjectMatch(
                new ProjectIdentityView(projectId, "Demo", null, "ACTIVE", 1),
                binding,
                new ProjectRegistration(projectId, UUID.randomUUID(), "D:\\demo", "Default")
        );
    }
}
