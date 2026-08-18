package com.zhishu.project;

public record WorkspaceProjectMatch(
        ProjectIdentityView project,
        WorkspaceBindingView binding,
        ProjectRegistration executionRegistration
) {
}
