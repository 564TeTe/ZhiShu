package com.zhishu.runtime;

public class RuntimeClientException extends RuntimeException {

    private final String code;

    public RuntimeClientException(String code, String message) {
        super(message);
        this.code = code;
    }

    public RuntimeClientException(String code, String message, Throwable cause) {
        super(message, cause);
        this.code = code;
    }

    public String code() {
        return code;
    }
}
