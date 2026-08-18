package com.zhishu.event;

public interface ApprovalProjectionRepository {

    void open(StoredTaskEvent event);

    void resolve(StoredTaskEvent event);
}
