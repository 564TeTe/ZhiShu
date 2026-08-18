package com.zhishu.runtime;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public interface AttemptRuntimeHealthRepository {

    boolean observe(UUID attemptId, Instant observedAt, Instant leaseExpiresAt);

    int markExpiredUnknown(Instant leaseDeadline, Instant unobservedCutoff, Instant unknownSince);

    List<RuntimeLeaseCandidate> findLostCandidates(Instant unknownCutoff);

    boolean markLost(UUID attemptId, Instant unknownCutoff, Instant lostAt, String reason);
}
