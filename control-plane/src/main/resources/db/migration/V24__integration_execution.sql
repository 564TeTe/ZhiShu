ALTER TABLE integration_gate_proposal
    DROP CONSTRAINT IF EXISTS integration_gate_proposal_apply_state_check,
    ADD CONSTRAINT chk_integration_gate_apply_state CHECK (
        apply_state IN (
            'NOT_ATTEMPTED', 'PREPARING', 'APPLYING', 'BUILDING', 'TESTING',
            'SUCCEEDED', 'FAILED', 'CLEANUP_PENDING'
        )
    );

CREATE TABLE integration_execution_run (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
    plan_id UUID NOT NULL REFERENCES project_plan(id) ON DELETE RESTRICT,
    gate_id UUID NOT NULL REFERENCES integration_gate_proposal(id) ON DELETE RESTRICT,
    attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
    status TEXT NOT NULL CHECK (status IN (
        'PREPARING', 'APPLYING', 'BUILDING', 'TESTING', 'SUCCEEDED', 'FAILED',
        'CLEANUP_PENDING', 'CANCELLED'
    )),
    client_request_id TEXT NOT NULL CHECK (btrim(client_request_id) <> ''),
    request_hash TEXT NOT NULL CHECK (btrim(request_hash) <> ''),
    created_by TEXT NOT NULL CHECK (btrim(created_by) <> ''),
    repository_root TEXT NOT NULL CHECK (btrim(repository_root) <> ''),
    base_commit TEXT NOT NULL CHECK (base_commit ~ '^[0-9a-f]{40,64}$'),
    candidate_commit TEXT CHECK (candidate_commit IS NULL OR candidate_commit ~ '^[0-9a-f]{40,64}$'),
    integration_workspace_path TEXT NOT NULL CHECK (btrim(integration_workspace_path) <> ''),
    integration_branch_ref TEXT NOT NULL CHECK (btrim(integration_branch_ref) <> ''),
    ownership_token TEXT NOT NULL UNIQUE CHECK (btrim(ownership_token) <> ''),
    workspace_state TEXT NOT NULL DEFAULT 'RETAINED'
        CHECK (workspace_state IN ('RETAINED', 'CLEANUP_PENDING', 'CLEANED')),
    failure_code TEXT,
    failure_message TEXT,
    build_exit_code INTEGER,
    test_exit_code INTEGER,
    replan_proposal_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    UNIQUE (gate_id, attempt_number),
    UNIQUE (project_id, created_by, client_request_id)
);

CREATE TABLE integration_execution_step (
    id UUID PRIMARY KEY,
    run_id UUID NOT NULL REFERENCES integration_execution_run(id) ON DELETE RESTRICT,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    step_type TEXT NOT NULL CHECK (step_type IN ('APPLY_WORKER', 'CREATE_CANDIDATE', 'BUILD', 'TEST')),
    assignment_id UUID REFERENCES parallel_schedule_assignment(id) ON DELETE RESTRICT,
    status TEXT NOT NULL CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED')),
    command_summary TEXT NOT NULL CHECK (btrim(command_summary) <> ''),
    exit_code INTEGER,
    stdout_summary TEXT NOT NULL DEFAULT '',
    stderr_summary TEXT NOT NULL DEFAULT '',
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    CONSTRAINT chk_integration_step_completion CHECK (
        (status = 'RUNNING' AND completed_at IS NULL)
        OR (status IN ('SUCCEEDED', 'FAILED', 'SKIPPED') AND completed_at IS NOT NULL)
    ),
    UNIQUE (run_id, ordinal)
);

CREATE TABLE integration_agent_run (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
    gate_id UUID NOT NULL REFERENCES integration_gate_proposal(id) ON DELETE RESTRICT,
    integration_run_id UUID NOT NULL REFERENCES integration_execution_run(id) ON DELETE RESTRICT,
    profile_id UUID NOT NULL REFERENCES agent_profile(id) ON DELETE RESTRICT,
    task_id UUID UNIQUE REFERENCES agent_task(id) ON DELETE RESTRICT,
    attempt_id UUID UNIQUE REFERENCES task_attempt(id) ON DELETE RESTRICT,
    status TEXT NOT NULL CHECK (status IN ('PREPARING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
    client_request_id TEXT NOT NULL CHECK (btrim(client_request_id) <> ''),
    request_hash TEXT NOT NULL CHECK (btrim(request_hash) <> ''),
    created_by TEXT NOT NULL CHECK (btrim(created_by) <> ''),
    objective TEXT NOT NULL CHECK (btrim(objective) <> ''),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    failure_message TEXT,
    UNIQUE (project_id, created_by, client_request_id)
);

CREATE UNIQUE INDEX uq_integration_active_run
    ON integration_execution_run(gate_id)
    WHERE status IN ('PREPARING', 'APPLYING', 'BUILDING', 'TESTING');
CREATE UNIQUE INDEX uq_integration_active_agent
    ON integration_agent_run(integration_run_id)
    WHERE status IN ('PREPARING', 'RUNNING');
CREATE INDEX idx_integration_run_gate_created
    ON integration_execution_run(gate_id, created_at DESC);
CREATE INDEX idx_integration_step_run_order
    ON integration_execution_step(run_id, ordinal);
CREATE INDEX idx_integration_agent_project_created
    ON integration_agent_run(project_id, created_at DESC);

COMMENT ON TABLE integration_execution_run IS
    'Deterministic Integration apply/build/test run in an isolated Git Worktree; it never mutates the primary Worktree.';
COMMENT ON TABLE integration_execution_step IS
    'Bounded command and patch evidence for one Integration execution run.';
COMMENT ON TABLE integration_agent_run IS
    'Existing Runtime Agent execution explicitly attached to a failed Integration Worktree.';

CREATE FUNCTION enforce_integration_execution_step_transition() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Integration execution evidence is immutable';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.run_id IS DISTINCT FROM OLD.run_id
        OR NEW.ordinal IS DISTINCT FROM OLD.ordinal
        OR NEW.step_type IS DISTINCT FROM OLD.step_type
        OR NEW.assignment_id IS DISTINCT FROM OLD.assignment_id
        OR NEW.command_summary IS DISTINCT FROM OLD.command_summary
        OR NEW.started_at IS DISTINCT FROM OLD.started_at
        OR OLD.status <> 'RUNNING'
        OR NEW.status NOT IN ('SUCCEEDED', 'FAILED', 'SKIPPED')
        OR NEW.completed_at IS NULL THEN
        RAISE EXCEPTION 'Integration execution step transition is not allowed';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_integration_execution_step_immutable
    BEFORE UPDATE OR DELETE ON integration_execution_step
    FOR EACH ROW EXECUTE FUNCTION enforce_integration_execution_step_transition();

CREATE OR REPLACE FUNCTION enforce_integration_gate_proposal_transition() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Integration Gate proposals are immutable';
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.project_id IS DISTINCT FROM OLD.project_id
        OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
        OR NEW.plan_version_id IS DISTINCT FROM OLD.plan_version_id
        OR NEW.schedule_id IS DISTINCT FROM OLD.schedule_id
        OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
        OR NEW.gate_mode IS DISTINCT FROM OLD.gate_mode
        OR NEW.evidence_status IS DISTINCT FROM OLD.evidence_status
        OR NEW.evidence_count IS DISTINCT FROM OLD.evidence_count
        OR NEW.base_state_revision IS DISTINCT FROM OLD.base_state_revision
        OR NEW.base_plan_version IS DISTINCT FROM OLD.base_plan_version
        OR NEW.proposal_payload IS DISTINCT FROM OLD.proposal_payload
        OR NEW.conflict_assessment IS DISTINCT FROM OLD.conflict_assessment
        OR NEW.client_request_id IS DISTINCT FROM OLD.client_request_id
        OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
        OR NEW.created_by IS DISTINCT FROM OLD.created_by
        OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'Integration Gate proposal facts are immutable';
    END IF;

    IF OLD.status = 'PENDING_APPROVAL' THEN
        IF NEW.status NOT IN ('APPROVED', 'REJECTED', 'STALE')
            OR NEW.apply_state <> 'NOT_ATTEMPTED' THEN
            RAISE EXCEPTION 'Integration Gate proposal decision transition is not allowed';
        END IF;
        IF NEW.decided_by IS NULL OR btrim(NEW.decided_by) = '' OR NEW.decided_at IS NULL THEN
            RAISE EXCEPTION 'Integration Gate terminal status requires decision audit fields';
        END IF;
        IF NEW.status = 'APPROVED'
            AND (NEW.evidence_status <> 'PRESENT' OR NEW.evidence_count < 1) THEN
            RAISE EXCEPTION 'Integration Gate approval requires sealed evidence';
        END IF;
        IF NEW.status IN ('APPROVED', 'REJECTED')
            AND (NEW.decision_request_id IS NULL OR btrim(NEW.decision_request_id) = ''
                 OR NEW.decision_hash IS NULL OR btrim(NEW.decision_hash) = '') THEN
            RAISE EXCEPTION 'Integration Gate user decision requires an idempotency record';
        END IF;
        IF NEW.status IN ('REJECTED', 'STALE')
            AND (NEW.decision_reason IS NULL OR btrim(NEW.decision_reason) = '') THEN
            RAISE EXCEPTION 'Integration Gate rejection or stale transition requires a reason';
        END IF;
        RETURN NEW;
    END IF;

    IF OLD.status = 'APPROVED' AND NEW.status = 'APPROVED' THEN
        IF NEW.decided_by IS DISTINCT FROM OLD.decided_by
            OR NEW.decided_at IS DISTINCT FROM OLD.decided_at
            OR NEW.decision_request_id IS DISTINCT FROM OLD.decision_request_id
            OR NEW.decision_hash IS DISTINCT FROM OLD.decision_hash
            OR NEW.decision_reason IS DISTINCT FROM OLD.decision_reason THEN
            RAISE EXCEPTION 'Integration Gate decision audit is immutable';
        END IF;
        IF NEW.apply_state <> OLD.apply_state AND NOT (
            (OLD.apply_state = 'NOT_ATTEMPTED' AND NEW.apply_state = 'PREPARING') OR
            (OLD.apply_state = 'PREPARING' AND NEW.apply_state IN ('APPLYING', 'FAILED', 'CLEANUP_PENDING')) OR
            (OLD.apply_state = 'APPLYING' AND NEW.apply_state IN ('BUILDING', 'FAILED', 'CLEANUP_PENDING')) OR
            (OLD.apply_state = 'BUILDING' AND NEW.apply_state IN ('TESTING', 'FAILED', 'CLEANUP_PENDING')) OR
            (OLD.apply_state = 'TESTING' AND NEW.apply_state IN ('SUCCEEDED', 'FAILED', 'CLEANUP_PENDING')) OR
            (OLD.apply_state = 'FAILED' AND NEW.apply_state = 'PREPARING')
        ) THEN
            RAISE EXCEPTION 'Integration execution state transition is not allowed';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status OR NEW.apply_state IS DISTINCT FROM OLD.apply_state THEN
        RAISE EXCEPTION 'Integration Gate is already terminal';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
