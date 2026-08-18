package com.zhishu.approval;

public enum ApprovalMode {
    MANUAL(0),
    AUTO_SAFE(1),
    AUTO_TRUSTED(2);

    private final int permissiveness;

    ApprovalMode(int permissiveness) {
        this.permissiveness = permissiveness;
    }

    public static ApprovalMode stricter(ApprovalMode first, ApprovalMode second) {
        return first.permissiveness <= second.permissiveness ? first : second;
    }
}
