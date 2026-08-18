package com.zhishu.task;

import java.util.UUID;

/** Replays already persisted Runtime events after an attempt crosses the HTTP acceptance boundary. */
public interface AttemptEventReconciler {

    void reconcile(UUID attemptId);
}
