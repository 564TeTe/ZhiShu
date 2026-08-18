package com.zhishu.project;

import java.util.List;

public record ProjectIdentityCandidateView(
        ProjectIdentityView project,
        List<String> matchedBy,
        String confidence
) {
}
