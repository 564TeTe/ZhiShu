package com.zhishu.artifact;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

public record TaskArtifactView(
        UUID id,
        UUID taskId,
        UUID attemptId,
        ArtifactType artifactType,
        String producer,
        String contentPlain,
        String storagePath,
        String mimeType,
        Long sizeBytes,
        String hash,
        Map<String, Object> metadata,
        Instant createdAt
) {
}
