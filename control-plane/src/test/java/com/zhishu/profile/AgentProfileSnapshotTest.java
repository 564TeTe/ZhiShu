package com.zhishu.profile;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.assertThat;

import java.util.Set;

import org.junit.jupiter.api.Test;

class AgentProfileSnapshotTest {

    @Test
    void rejectsApprovalForDisabledCapability() {
        assertThatThrownBy(() -> new AgentProfileSnapshot(
                ExecutorType.CLAUDE,
                null,
                Set.of(Capability.READ_FILE),
                Set.of(Capability.WRITE_FILE),
                600,
                "task-v1"
        )).isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("disabled capability");
    }

    @Test
    void createsReadOnlySnapshotWithoutConnectionOrApprovalPolicy() {
        AgentProfileSnapshot snapshot = new AgentProfileSnapshot(
                ExecutorType.OPENCODE,
                "conn-claude",
                "deepseek/deepseek-v4-pro",
                Set.of(Capability.READ_FILE, Capability.SEARCH_CODE, Capability.WRITE_FILE, Capability.SHELL),
                Set.of(Capability.WRITE_FILE, Capability.SHELL),
                600,
                "task-v1"
        ).asReadOnly();

        assertThat(snapshot.connectionRef()).isNull();
        assertThat(snapshot.capabilities()).containsExactlyInAnyOrder(Capability.READ_FILE, Capability.SEARCH_CODE);
        assertThat(snapshot.requireApprovalFor()).isEmpty();
    }
}
