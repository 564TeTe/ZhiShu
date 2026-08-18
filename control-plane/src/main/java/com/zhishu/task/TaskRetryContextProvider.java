package com.zhishu.task;

import java.util.Map;

/** Adds durable feature-owned context and validation to a Task retry transaction. */
public interface TaskRetryContextProvider {

    Map<String, Object> prepareRetry(TaskView task);
}
