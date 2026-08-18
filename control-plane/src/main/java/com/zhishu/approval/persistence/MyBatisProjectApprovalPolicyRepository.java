package com.zhishu.approval.persistence;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.stereotype.Repository;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zhishu.approval.ApprovalMode;
import com.zhishu.approval.ProjectApprovalPolicyRepository;
import com.zhishu.approval.ProjectApprovalPolicyView;

@Repository
public class MyBatisProjectApprovalPolicyRepository implements ProjectApprovalPolicyRepository {
    private static final TypeReference<List<String>> DIRECTORIES = new TypeReference<>() { };
    private static final TypeReference<List<List<String>>> COMMANDS = new TypeReference<>() { };

    private final ProjectApprovalPolicyMapper mapper;
    private final ObjectMapper objectMapper;

    public MyBatisProjectApprovalPolicyRepository(ProjectApprovalPolicyMapper mapper, ObjectMapper objectMapper) {
        this.mapper = mapper;
        this.objectMapper = objectMapper;
    }

    @Override
    public Optional<ProjectApprovalPolicyView> findByProjectId(UUID projectId) {
        return Optional.ofNullable(mapper.findByProjectId(projectId)).map(this::toView);
    }

    @Override
    public ProjectApprovalPolicyView save(ProjectApprovalPolicyView policy) {
        try {
            mapper.save(policy.projectId(), policy.mode().name(),
                    objectMapper.writeValueAsString(policy.allowedDirectories()),
                    objectMapper.writeValueAsString(policy.trustedCommands()),
                    policy.approvalTimeoutSeconds(), policy.updatedAt());
            return findByProjectId(policy.projectId()).orElseThrow();
        } catch (JsonProcessingException error) {
            throw new IllegalArgumentException("Approval policy cannot be serialized", error);
        }
    }

    private ProjectApprovalPolicyView toView(ProjectApprovalPolicyRow row) {
        try {
            return new ProjectApprovalPolicyView(
                    UUID.fromString(row.getProjectId()), row.getProjectRoot(), ApprovalMode.valueOf(row.getMode()),
                    objectMapper.readValue(row.getAllowedDirectoriesJson(), DIRECTORIES),
                    objectMapper.readValue(row.getTrustedCommandsJson(), COMMANDS),
                    row.getApprovalTimeoutSeconds(), row.getUpdatedAt()
            );
        } catch (JsonProcessingException error) {
            throw new IllegalStateException("Stored approval policy is invalid", error);
        }
    }
}
