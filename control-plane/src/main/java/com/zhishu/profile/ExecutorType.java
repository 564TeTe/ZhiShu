package com.zhishu.profile;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

public enum ExecutorType {
    CLAUDE("claude"),
    CODEX("codex"),
    OPENCODE("opencode");

    private final String wireValue;

    ExecutorType(String wireValue) {
        this.wireValue = wireValue;
    }

    @JsonValue
    public String wireValue() {
        return wireValue;
    }

    @JsonCreator
    public static ExecutorType fromWireValue(String value) {
        for (ExecutorType type : values()) {
            if (type.wireValue.equalsIgnoreCase(value)) {
                return type;
            }
        }
        throw new IllegalArgumentException("Unsupported executor: " + value);
    }
}
