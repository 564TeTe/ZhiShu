ALTER TABLE workspace_lease
    ADD COLUMN provisioning_state TEXT NOT NULL DEFAULT 'NOT_STARTED'
        CHECK (provisioning_state IN (
            'NOT_STARTED', 'PROVISIONING', 'PROVISIONED', 'FAILED',
            'CLEANUP_PENDING', 'CLEANED'
        )),
    ADD COLUMN provisioning_request_id TEXT,
    ADD COLUMN workspace_path TEXT,
    ADD COLUMN ownership_token TEXT,
    ADD COLUMN lease_expires_at TIMESTAMPTZ,
    ADD COLUMN provisioning_started_at TIMESTAMPTZ,
    ADD COLUMN provisioned_at TIMESTAMPTZ,
    ADD COLUMN failed_at TIMESTAMPTZ,
    ADD COLUMN failure_code TEXT,
    ADD COLUMN failure_message TEXT,
    ADD COLUMN cleanup_started_at TIMESTAMPTZ,
    ADD COLUMN cleaned_at TIMESTAMPTZ,
    ADD COLUMN last_reconciled_at TIMESTAMPTZ;

UPDATE workspace_lease
SET provisioning_state = 'CLEANED'
WHERE status = 'RELEASED';

CREATE UNIQUE INDEX uq_workspace_lease_ownership_token
    ON workspace_lease(ownership_token)
    WHERE ownership_token IS NOT NULL;

CREATE UNIQUE INDEX uq_workspace_lease_workspace_path
    ON workspace_lease(workspace_path)
    WHERE workspace_path IS NOT NULL
      AND provisioning_state IN ('PROVISIONING', 'PROVISIONED', 'CLEANUP_PENDING');

CREATE INDEX idx_workspace_lease_provisioning_sweep
    ON workspace_lease(provisioning_state, provisioning_started_at, lease_expires_at);

CREATE TABLE workspace_lease_event (
    id BIGSERIAL PRIMARY KEY,
    lease_id UUID NOT NULL REFERENCES workspace_lease(id) ON DELETE RESTRICT,
    event_type TEXT NOT NULL CHECK (btrim(event_type) <> ''),
    actor TEXT NOT NULL CHECK (btrim(actor) <> ''),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_workspace_lease_event_lease
    ON workspace_lease_event(lease_id, id);

COMMENT ON COLUMN workspace_lease.workspace_path IS
    'Control Plane-owned directory path. It is not a Git Worktree until a later adapter is authorized.';
COMMENT ON COLUMN workspace_lease.ownership_token IS
    'Opaque marker token required before any cleanup can remove a provisioned directory.';
COMMENT ON COLUMN workspace_lease.provisioning_state IS
    'Recoverable physical-directory provisioning state, independent from the logical Lease status.';

CREATE FUNCTION reject_workspace_lease_event_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Workspace Lease events are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_workspace_lease_event_immutable
    BEFORE UPDATE OR DELETE ON workspace_lease_event
    FOR EACH ROW EXECUTE FUNCTION reject_workspace_lease_event_mutation();
