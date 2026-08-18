package com.zhishu.runtime;

public interface RuntimeClient {

    RuntimeAccepted start(RuntimeStartCommand command);

    default RuntimeCancelResult cancel(String runtimeRunId, RuntimeCancelCommand command) {
        throw new UnsupportedOperationException("Cancel is not implemented by this RuntimeClient");
    }

    default RuntimeApprovalDecisionResult decideApproval(
            String runtimeRunId,
            String runtimeApprovalId,
            RuntimeApprovalDecisionCommand command
    ) {
        throw new UnsupportedOperationException("Approval is not implemented by this RuntimeClient");
    }
}
