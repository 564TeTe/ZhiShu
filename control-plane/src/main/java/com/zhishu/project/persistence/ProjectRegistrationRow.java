package com.zhishu.project.persistence;

final class ProjectRegistrationRow {

    private String projectId;
    private String profileId;
    private String projectRef;
    private String profileName;

    public String getProjectId() { return projectId; }
    public void setProjectId(String projectId) { this.projectId = projectId; }
    public String getProfileId() { return profileId; }
    public void setProfileId(String profileId) { this.profileId = profileId; }
    public String getProjectRef() { return projectRef; }
    public void setProjectRef(String projectRef) { this.projectRef = projectRef; }
    public String getProfileName() { return profileName; }
    public void setProfileName(String profileName) { this.profileName = profileName; }
}
