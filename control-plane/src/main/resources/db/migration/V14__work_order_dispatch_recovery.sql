ALTER TABLE work_order_execution
    ADD COLUMN dispatch_lease_id UUID,
    ADD COLUMN dispatch_lease_expires_at TIMESTAMPTZ,
    ADD COLUMN dispatch_attempts INTEGER NOT NULL DEFAULT 0 CHECK (dispatch_attempts >= 0),
    ADD COLUMN last_dispatch_at TIMESTAMPTZ;

CREATE INDEX idx_work_order_dispatch_recovery
    ON work_order_execution(dispatch_lease_expires_at, updated_at)
    WHERE status = 'DISPATCHING';

COMMENT ON COLUMN work_order_execution.dispatch_lease_id IS
    'Short-lived owner token for recoverable post-commit Runtime dispatch.';
COMMENT ON COLUMN work_order_execution.dispatch_attempts IS
    'Number of durable dispatch leases acquired for this Work Order execution.';
