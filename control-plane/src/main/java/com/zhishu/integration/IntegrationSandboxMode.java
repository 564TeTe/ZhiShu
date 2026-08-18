package com.zhishu.integration;

/** Declares whether Integration build/test may run without an OS-level sandbox. */
public enum IntegrationSandboxMode {
    /** Run with the Java-level restrictions, while deployment supplies stronger isolation when required. */
    BEST_EFFORT,
    /** Refuse execution unless CPU, memory, disk and network isolation are available. */
    REQUIRED
}
