package com.zhishu.event;

public interface ArtifactProjectionRepository {

    void publish(StoredTaskEvent event);
}
