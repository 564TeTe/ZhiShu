package com.zhishu.approval;

public record ApprovalPolicyEvaluation(Outcome outcome, String rule, String reason) {
    public enum Outcome { AUTO_APPROVE, MANUAL, DENY }
}
