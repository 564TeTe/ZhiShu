package com.zhishu.runtime.persistence;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.springframework.stereotype.Repository;

import com.zhishu.runtime.AttemptRuntimeHealthRepository;
import com.zhishu.runtime.RuntimeLeaseCandidate;
import com.zhishu.task.AttemptStatus;

@Repository
public class MyBatisAttemptRuntimeHealthRepository implements AttemptRuntimeHealthRepository {

    private final RuntimeLeaseMapper mapper;

    public MyBatisAttemptRuntimeHealthRepository(RuntimeLeaseMapper mapper) {
        this.mapper = mapper;
    }

    @Override
    public boolean observe(UUID attemptId, Instant observedAt, Instant leaseExpiresAt) {
        return mapper.observe(attemptId, observedAt, leaseExpiresAt) == 1;
    }

    @Override
    public int markExpiredUnknown(Instant leaseDeadline, Instant unobservedCutoff, Instant unknownSince) {
        return mapper.markExpiredUnknown(leaseDeadline, unobservedCutoff, unknownSince);
    }

    @Override
    public List<RuntimeLeaseCandidate> findLostCandidates(Instant unknownCutoff) {
        return mapper.findLostCandidates(unknownCutoff).stream().map(row -> new RuntimeLeaseCandidate(
                UUID.fromString(row.getAttemptId()),
                UUID.fromString(row.getTaskId()),
                AttemptStatus.valueOf(row.getAttemptStatus())
        )).toList();
    }

    @Override
    public boolean markLost(UUID attemptId, Instant unknownCutoff, Instant lostAt, String reason) {
        return mapper.markLost(attemptId, unknownCutoff, lostAt, reason) == 1;
    }
}
