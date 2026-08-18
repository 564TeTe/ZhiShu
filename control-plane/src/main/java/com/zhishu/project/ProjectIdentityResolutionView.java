package com.zhishu.project;

import java.util.List;

public record ProjectIdentityResolutionView(
        String schemaVersion,
        String resolution,
        ProjectIdentityView project,
        WorkspaceBindingView binding,
        List<ProjectIdentityCandidateView> candidates,
        List<String> ambiguityReasons,
        WorkspaceBindingProposalView proposal,
        ProjectRegistration executionRegistration
) {
}
