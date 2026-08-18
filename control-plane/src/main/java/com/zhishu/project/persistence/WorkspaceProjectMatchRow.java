package com.zhishu.project.persistence;

import java.time.Instant;

final class WorkspaceProjectMatchRow {

    private String projectId;
    private String displayName;
    private String repositoryIdentity;
    private String projectStatus;
    private long identityVersion;
    private String workspaceId;
    private String machineId;
    private String localProjectId;
    private String workspacePath;
    private String normalizedWorkspacePath;
    private String repositoryUrl;
    private String remoteFingerprint;
    private String branch;
    private boolean primary;
    private String bindingStatus;
    private Instant lastSeenAt;
    private String profileId;
    private String projectRef;
    private String profileName;

    public String getProjectId() { return projectId; }
    public void setProjectId(String projectId) { this.projectId = projectId; }
    public String getDisplayName() { return displayName; }
    public void setDisplayName(String displayName) { this.displayName = displayName; }
    public String getRepositoryIdentity() { return repositoryIdentity; }
    public void setRepositoryIdentity(String repositoryIdentity) { this.repositoryIdentity = repositoryIdentity; }
    public String getProjectStatus() { return projectStatus; }
    public void setProjectStatus(String projectStatus) { this.projectStatus = projectStatus; }
    public long getIdentityVersion() { return identityVersion; }
    public void setIdentityVersion(long identityVersion) { this.identityVersion = identityVersion; }
    public String getWorkspaceId() { return workspaceId; }
    public void setWorkspaceId(String workspaceId) { this.workspaceId = workspaceId; }
    public String getMachineId() { return machineId; }
    public void setMachineId(String machineId) { this.machineId = machineId; }
    public String getLocalProjectId() { return localProjectId; }
    public void setLocalProjectId(String localProjectId) { this.localProjectId = localProjectId; }
    public String getWorkspacePath() { return workspacePath; }
    public void setWorkspacePath(String workspacePath) { this.workspacePath = workspacePath; }
    public String getNormalizedWorkspacePath() { return normalizedWorkspacePath; }
    public void setNormalizedWorkspacePath(String normalizedWorkspacePath) { this.normalizedWorkspacePath = normalizedWorkspacePath; }
    public String getRepositoryUrl() { return repositoryUrl; }
    public void setRepositoryUrl(String repositoryUrl) { this.repositoryUrl = repositoryUrl; }
    public String getRemoteFingerprint() { return remoteFingerprint; }
    public void setRemoteFingerprint(String remoteFingerprint) { this.remoteFingerprint = remoteFingerprint; }
    public String getBranch() { return branch; }
    public void setBranch(String branch) { this.branch = branch; }
    public boolean isPrimary() { return primary; }
    public void setPrimary(boolean primary) { this.primary = primary; }
    public String getBindingStatus() { return bindingStatus; }
    public void setBindingStatus(String bindingStatus) { this.bindingStatus = bindingStatus; }
    public Instant getLastSeenAt() { return lastSeenAt; }
    public void setLastSeenAt(Instant lastSeenAt) { this.lastSeenAt = lastSeenAt; }
    public String getProfileId() { return profileId; }
    public void setProfileId(String profileId) { this.profileId = profileId; }
    public String getProjectRef() { return projectRef; }
    public void setProjectRef(String projectRef) { this.projectRef = projectRef; }
    public String getProfileName() { return profileName; }
    public void setProfileName(String profileName) { this.profileName = profileName; }
}
