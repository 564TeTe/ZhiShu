package com.zhishu.project;

import java.util.Optional;

public interface WorkspaceBindingCommandRepository {

    Optional<WorkspaceBindingChangeView> findReplay(String actor, String clientRequestId, String requestHash);

    WorkspaceBindingChangeView apply(WorkspaceBindingCommand command);
}
