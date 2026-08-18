ALTER TABLE task_attempt
    ADD COLUMN runtime_health_status TEXT NOT NULL DEFAULT 'NOT_MONITORED',
    ADD COLUMN last_heartbeat_at TIMESTAMPTZ,
    ADD COLUMN lease_expires_at TIMESTAMPTZ,
    ADD COLUMN unknown_since TIMESTAMPTZ,
    ADD COLUMN lost_at TIMESTAMPTZ,
    ADD COLUMN lost_reason TEXT;

ALTER TABLE task_attempt
    ADD CONSTRAINT chk_task_attempt_runtime_health
    CHECK (runtime_health_status IN ('NOT_MONITORED', 'HEALTHY', 'UNKNOWN', 'LOST', 'TERMINATED'));

UPDATE task_attempt
SET runtime_health_status = 'TERMINATED'
WHERE status IN ('SUCCEEDED', 'FAILED', 'ABORTED');

CREATE INDEX idx_task_attempt_runtime_lease
    ON task_attempt(runtime_health_status, lease_expires_at, unknown_since)
    WHERE status IN ('STARTING', 'RUNNING', 'WAITING_APPROVAL', 'CANCELLING');
