CREATE TABLE parallel_schedule_proposal (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
    plan_id UUID NOT NULL REFERENCES project_plan(id) ON DELETE RESTRICT,
    plan_version_id UUID NOT NULL REFERENCES plan_version(id) ON DELETE RESTRICT,
    schema_version TEXT NOT NULL DEFAULT '1.0' CHECK (schema_version = '1.0'),
    status TEXT NOT NULL CHECK (status IN ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'STALE')),
    base_state_revision BIGINT NOT NULL CHECK (base_state_revision >= 0),
    base_plan_version BIGINT NOT NULL CHECK (base_plan_version >= 1),
    max_workers INTEGER NOT NULL DEFAULT 2 CHECK (max_workers = 2),
    conflict_assessment JSONB NOT NULL,
    client_request_id TEXT NOT NULL CHECK (btrim(client_request_id) <> ''),
    request_hash TEXT NOT NULL CHECK (btrim(request_hash) <> ''),
    created_by TEXT NOT NULL CHECK (btrim(created_by) <> ''),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_by TEXT,
    decided_at TIMESTAMPTZ,
    decision_request_id TEXT,
    decision_hash TEXT,
    decision_reason TEXT,
    UNIQUE (project_id, created_by, client_request_id)
);

CREATE TABLE parallel_schedule_assignment (
    id UUID PRIMARY KEY,
    schedule_id UUID NOT NULL REFERENCES parallel_schedule_proposal(id) ON DELETE RESTRICT,
    project_id UUID NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
    plan_id UUID NOT NULL REFERENCES project_plan(id) ON DELETE RESTRICT,
    plan_version_id UUID NOT NULL REFERENCES plan_version(id) ON DELETE RESTRICT,
    node_key TEXT NOT NULL,
    worker_slot INTEGER NOT NULL CHECK (worker_slot IN (1, 2)),
    profile_id UUID NOT NULL REFERENCES agent_profile(id) ON DELETE RESTRICT,
    status TEXT NOT NULL CHECK (status IN (
        'PROPOSED', 'READY_FOR_PROVISIONING', 'PROVISIONED', 'RUNNING',
        'VERIFIED', 'FAILED', 'CANCELLED'
    )),
    scope JSONB NOT NULL,
    required_capabilities JSONB NOT NULL,
    profile_capabilities JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (schedule_id, node_key),
    UNIQUE (schedule_id, worker_slot),
    FOREIGN KEY (plan_version_id, node_key)
        REFERENCES plan_node_definition(plan_version_id, node_key) ON DELETE RESTRICT
);

CREATE TABLE workspace_lease (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
    schedule_id UUID NOT NULL REFERENCES parallel_schedule_proposal(id) ON DELETE RESTRICT,
    assignment_id UUID NOT NULL UNIQUE REFERENCES parallel_schedule_assignment(id) ON DELETE RESTRICT,
    workspace_mode TEXT NOT NULL CHECK (workspace_mode = 'ISOLATED_WORKTREE'),
    workspace_ref TEXT NOT NULL CHECK (btrim(workspace_ref) <> ''),
    branch_ref TEXT NOT NULL CHECK (btrim(branch_ref) <> ''),
    status TEXT NOT NULL CHECK (status IN ('RESERVED', 'PROVISIONED', 'RELEASED', 'EXPIRED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    released_at TIMESTAMPTZ
);

CREATE TABLE parallel_schedule_event (
    id BIGSERIAL PRIMARY KEY,
    schedule_id UUID NOT NULL REFERENCES parallel_schedule_proposal(id) ON DELETE RESTRICT,
    event_type TEXT NOT NULL CHECK (btrim(event_type) <> ''),
    actor TEXT NOT NULL CHECK (btrim(actor) <> ''),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_parallel_schedule_decision_request
    ON parallel_schedule_proposal(project_id, decided_by, decision_request_id)
    WHERE decision_request_id IS NOT NULL;

CREATE UNIQUE INDEX uq_active_parallel_node
    ON parallel_schedule_assignment(plan_id, node_key)
    WHERE status IN ('PROPOSED', 'READY_FOR_PROVISIONING', 'PROVISIONED', 'RUNNING');

CREATE UNIQUE INDEX uq_active_workspace_ref
    ON workspace_lease(project_id, workspace_ref)
    WHERE status IN ('RESERVED', 'PROVISIONED');

CREATE INDEX idx_parallel_schedule_project_created
    ON parallel_schedule_proposal(project_id, created_at DESC);
CREATE INDEX idx_parallel_schedule_assignment_schedule
    ON parallel_schedule_assignment(schedule_id, worker_slot);
CREATE INDEX idx_parallel_schedule_event_schedule
    ON parallel_schedule_event(schedule_id, id);

COMMENT ON TABLE parallel_schedule_proposal IS
    'Proposal-first two-worker schedule; approval does not create Work Orders or run Agents.';
COMMENT ON TABLE workspace_lease IS
    'Logical reservation for a future isolated worktree. RESERVED is not proof that a filesystem path exists.';

CREATE FUNCTION reject_parallel_schedule_event_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Parallel Schedule events are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_parallel_schedule_event_immutable
    BEFORE UPDATE OR DELETE ON parallel_schedule_event
    FOR EACH ROW EXECUTE FUNCTION reject_parallel_schedule_event_mutation();
