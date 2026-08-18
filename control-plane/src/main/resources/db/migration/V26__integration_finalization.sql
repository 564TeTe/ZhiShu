ALTER TABLE integration_execution_run
    ADD COLUMN finalization_state TEXT NOT NULL DEFAULT 'NOT_REQUESTED'
        CHECK (finalization_state IN (
            'NOT_REQUESTED', 'APPLYING', 'APPLIED', 'APPLY_FAILED', 'CLEANUP_PENDING', 'CLEANED'
        )),
    ADD COLUMN finalization_client_request_id TEXT,
    ADD COLUMN finalization_request_hash TEXT,
    ADD COLUMN finalized_by TEXT,
    ADD COLUMN finalized_target_ref TEXT,
    ADD COLUMN finalized_at TIMESTAMPTZ,
    ADD COLUMN finalization_failure_message TEXT;

ALTER TABLE integration_execution_run
    ADD CONSTRAINT chk_integration_finalization_request CHECK (
        (finalization_state = 'NOT_REQUESTED'
            AND finalization_client_request_id IS NULL
            AND finalization_request_hash IS NULL
            AND finalized_by IS NULL)
        OR
        (finalization_state <> 'NOT_REQUESTED'
            AND finalization_client_request_id IS NOT NULL
            AND btrim(finalization_client_request_id) <> ''
            AND finalization_request_hash IS NOT NULL
            AND btrim(finalization_request_hash) <> ''
            AND finalized_by IS NOT NULL
            AND btrim(finalized_by) <> ''
            AND candidate_commit IS NOT NULL)
    ),
    ADD CONSTRAINT chk_integration_finalization_result CHECK (
        (finalization_state IN ('NOT_REQUESTED', 'APPLYING', 'APPLY_FAILED')
            AND finalized_at IS NULL)
        OR
        (finalization_state IN ('APPLIED', 'CLEANUP_PENDING', 'CLEANED')
            AND finalized_at IS NOT NULL
            AND finalized_target_ref IS NOT NULL
            AND btrim(finalized_target_ref) <> '')
    ),
    ADD CONSTRAINT chk_integration_finalization_workspace CHECK (
        (finalization_state IN ('NOT_REQUESTED', 'APPLYING', 'APPLIED', 'APPLY_FAILED')
            AND workspace_state = 'RETAINED')
        OR (finalization_state = 'CLEANUP_PENDING' AND workspace_state = 'CLEANUP_PENDING')
        OR (finalization_state = 'CLEANED' AND workspace_state = 'CLEANED')
    ),
    ADD CONSTRAINT chk_integration_success_candidate CHECK (
        status <> 'SUCCEEDED' OR candidate_commit IS NOT NULL
    );

CREATE UNIQUE INDEX uq_integration_finalization_request
    ON integration_execution_run(project_id, finalized_by, finalization_client_request_id)
    WHERE finalization_client_request_id IS NOT NULL;

COMMENT ON COLUMN integration_execution_run.finalization_state IS
    'Explicit fast-forward adoption and ownership-checked cleanup state for a successful candidate commit.';
COMMENT ON COLUMN integration_execution_run.finalized_target_ref IS
    'Local primary Worktree branch fast-forwarded to candidate_commit; no remote operation is performed.';

CREATE FUNCTION enforce_integration_finalization_transition() RETURNS trigger AS $$
BEGIN
    IF OLD.finalization_state = NEW.finalization_state THEN
        IF OLD.finalization_state = 'CLEANED' AND (
            NEW.finalization_client_request_id IS DISTINCT FROM OLD.finalization_client_request_id
            OR NEW.finalized_by IS DISTINCT FROM OLD.finalized_by
            OR NEW.finalization_failure_message IS DISTINCT FROM OLD.finalization_failure_message
        ) THEN
            RAISE EXCEPTION 'Cleaned Integration finalization is immutable';
        END IF;
    ELSIF NOT (
        (OLD.finalization_state = 'NOT_REQUESTED' AND NEW.finalization_state = 'APPLYING')
        OR (OLD.finalization_state = 'APPLYING'
            AND NEW.finalization_state IN ('APPLIED', 'APPLY_FAILED', 'CLEANUP_PENDING'))
        OR (OLD.finalization_state = 'APPLY_FAILED' AND NEW.finalization_state = 'APPLYING')
        OR (OLD.finalization_state = 'APPLIED' AND NEW.finalization_state = 'CLEANUP_PENDING')
        OR (OLD.finalization_state = 'CLEANUP_PENDING' AND NEW.finalization_state = 'CLEANED')
    ) THEN
        RAISE EXCEPTION 'Integration finalization state transition is not allowed';
    END IF;

    IF OLD.finalization_request_hash IS NOT NULL
        AND NEW.finalization_request_hash IS DISTINCT FROM OLD.finalization_request_hash THEN
        RAISE EXCEPTION 'Integration finalization content is immutable across retries';
    END IF;
    IF OLD.finalized_target_ref IS NOT NULL
        AND NEW.finalized_target_ref IS DISTINCT FROM OLD.finalized_target_ref THEN
        RAISE EXCEPTION 'Integration finalization target is immutable';
    END IF;
    IF OLD.finalized_at IS NOT NULL AND NEW.finalized_at IS DISTINCT FROM OLD.finalized_at THEN
        RAISE EXCEPTION 'Integration finalization timestamp is immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_integration_finalization_transition
    BEFORE UPDATE ON integration_execution_run
    FOR EACH ROW EXECUTE FUNCTION enforce_integration_finalization_transition();
