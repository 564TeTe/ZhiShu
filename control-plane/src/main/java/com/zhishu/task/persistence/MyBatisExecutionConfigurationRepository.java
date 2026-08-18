package com.zhishu.task.persistence;

import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import org.springframework.stereotype.Repository;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zhishu.profile.AgentProfileSnapshot;
import com.zhishu.profile.Capability;
import com.zhishu.profile.ExecutorType;
import com.zhishu.task.ExecutionConfiguration;
import com.zhishu.task.ExecutionConfigurationRepository;

@Repository
public class MyBatisExecutionConfigurationRepository implements ExecutionConfigurationRepository {

    private static final TypeReference<Set<Capability>> CAPABILITIES_TYPE = new TypeReference<>() { };
    private static final TypeReference<Map<String, Set<Capability>>> POLICY_TYPE = new TypeReference<>() { };

    private final ExecutionConfigurationMapper mapper;
    private final ObjectMapper objectMapper;

    public MyBatisExecutionConfigurationRepository(
            ExecutionConfigurationMapper mapper,
            ObjectMapper objectMapper
    ) {
        this.mapper = mapper;
        this.objectMapper = objectMapper;
    }

    @Override
    public Optional<ExecutionConfiguration> findEnabled(UUID projectId, UUID profileId) {
        return Optional.ofNullable(mapper.findEnabled(projectId, profileId)).map(this::toDomain);
    }

    private ExecutionConfiguration toDomain(ExecutionConfigurationRow row) {
        try {
            Set<Capability> capabilities = objectMapper.readValue(
                    row.getCapabilitiesJson(),
                    CAPABILITIES_TYPE
            );
            Map<String, Set<Capability>> policy = objectMapper.readValue(
                    row.getPermissionPolicyJson(),
                    POLICY_TYPE
            );
            AgentProfileSnapshot snapshot = new AgentProfileSnapshot(
                    ExecutorType.fromWireValue(row.getExecutor()),
                    row.getConnectionRef(),
                    row.getModelAlias(),
                    capabilities,
                    policy.getOrDefault("requireApprovalFor", Set.of()),
                    row.getTimeoutSeconds(),
                    row.getPromptVersion()
            );
            return new ExecutionConfiguration(
                    row.getProjectId(),
                    row.getProfileId(),
                    row.getProjectRef(),
                    snapshot
            );
        } catch (JsonProcessingException error) {
            throw new IllegalStateException("Stored Agent Profile JSON is invalid", error);
        }
    }
}
