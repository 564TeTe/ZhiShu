package com.zhishu.task;

import java.util.List;

public record TaskSearchResult(
        List<TaskView> items,
        String nextCursor,
        boolean hasMore
) {
    public TaskSearchResult {
        items = List.copyOf(items);
    }
}
