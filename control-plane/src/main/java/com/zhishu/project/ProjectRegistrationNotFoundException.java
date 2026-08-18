package com.zhishu.project;

public class ProjectRegistrationNotFoundException extends RuntimeException {

    public ProjectRegistrationNotFoundException(String projectRef) {
        super("Project registration was not found for projectRef: " + projectRef);
    }
}
