CREATE TABLE project_state_snapshot (
    project_id UUID PRIMARY KEY REFERENCES project(id) ON DELETE RESTRICT,
    state_revision BIGINT NOT NULL DEFAULT 0 CHECK (state_revision >= 0),
    goal_entry_id UUID,
    stage_entry_id UUID,
    summary TEXT,
    blocker TEXT,
    current_plan_id UUID,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE project_state_entry (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
    entry_type TEXT NOT NULL CHECK (entry_type IN (
        'GOAL', 'STAGE', 'FACT', 'DECISION', 'CONSTRAINT', 'DISCOVERY', 'RISK', 'ASSUMPTION'
    )),
    title TEXT NOT NULL CHECK (btrim(title) <> ''),
    content TEXT NOT NULL CHECK (btrim(content) <> ''),
    authority_level TEXT NOT NULL CHECK (authority_level IN (
        'SYSTEM_VERIFIED', 'USER_CONFIRMED', 'AGENT_OBSERVED', 'AGENT_INFERRED'
    )),
    source_type TEXT NOT NULL CHECK (btrim(source_type) <> ''),
    source_id TEXT NOT NULL CHECK (btrim(source_id) <> ''),
    created_by TEXT NOT NULL CHECK (btrim(created_by) <> ''),
    rationale TEXT,
    observed_at TIMESTAMPTZ,
    confirmed_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN (
        'ACTIVE', 'SUPERSEDED', 'STALE', 'DISMISSED'
    )),
    supersedes_id UUID REFERENCES project_state_entry(id) ON DELETE RESTRICT,
    created_revision BIGINT NOT NULL CHECK (created_revision >= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE project_state_snapshot
    ADD CONSTRAINT fk_project_state_snapshot_goal
    FOREIGN KEY (goal_entry_id) REFERENCES project_state_entry(id) ON DELETE RESTRICT,
    ADD CONSTRAINT fk_project_state_snapshot_stage
    FOREIGN KEY (stage_entry_id) REFERENCES project_state_entry(id) ON DELETE RESTRICT;

CREATE TABLE project_state_entry_evidence (
    entry_id UUID NOT NULL REFERENCES project_state_entry(id) ON DELETE RESTRICT,
    evidence_reference_id UUID NOT NULL REFERENCES evidence_reference(id) ON DELETE RESTRICT,
    PRIMARY KEY (entry_id, evidence_reference_id)
);

CREATE TABLE project_state_proposal (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
    schema_version TEXT NOT NULL DEFAULT '1.0',
    proposal_type TEXT NOT NULL CHECK (proposal_type IN ('INITIAL_STATE', 'STATE_CHANGE')),
    status TEXT NOT NULL CHECK (status IN (
        'DRAFT', 'PENDING_VALIDATION', 'PENDING_APPROVAL', 'APPROVED',
        'REJECTED', 'STALE', 'APPLIED', 'FAILED'
    )),
    base_state_revision BIGINT NOT NULL CHECK (base_state_revision >= 0),
    payload JSONB NOT NULL,
    validation_result JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_type TEXT NOT NULL CHECK (btrim(source_type) <> ''),
    source_id TEXT NOT NULL CHECK (btrim(source_id) <> ''),
    created_by TEXT NOT NULL CHECK (btrim(created_by) <> ''),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_by TEXT,
    decided_at TIMESTAMPTZ,
    applied_revision BIGINT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE project_change_log (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
    change_type TEXT NOT NULL CHECK (btrim(change_type) <> ''),
    actor TEXT NOT NULL CHECK (btrim(actor) <> ''),
    source_type TEXT NOT NULL CHECK (btrim(source_type) <> ''),
    source_id TEXT NOT NULL CHECK (btrim(source_id) <> ''),
    client_request_id TEXT NOT NULL CHECK (btrim(client_request_id) <> ''),
    request_hash TEXT NOT NULL CHECK (btrim(request_hash) <> ''),
    before_revision BIGINT NOT NULL CHECK (before_revision >= 0),
    after_revision BIGINT NOT NULL CHECK (after_revision >= before_revision),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, actor, client_request_id)
);

CREATE TABLE project_context_package_archive (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
    package_type TEXT NOT NULL CHECK (package_type IN ('BRAIN', 'PLANNER')),
    context_package_version TEXT NOT NULL DEFAULT '1.0',
    state_revision BIGINT NOT NULL CHECK (state_revision >= 0),
    plan_version BIGINT,
    execution_watermark BIGINT NOT NULL CHECK (execution_watermark >= 0),
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    payload JSONB NOT NULL,
    truncation JSONB NOT NULL DEFAULT '{}'::jsonb
);

INSERT INTO project_state_snapshot (project_id)
SELECT id FROM project
ON CONFLICT (project_id) DO NOTHING;

CREATE INDEX idx_project_state_entry_active
    ON project_state_entry(project_id, entry_type, created_revision DESC)
    WHERE status = 'ACTIVE';
CREATE INDEX idx_project_state_proposal_status
    ON project_state_proposal(project_id, status, created_at DESC);
CREATE INDEX idx_project_change_revision
    ON project_change_log(project_id, after_revision DESC, occurred_at DESC);
CREATE INDEX idx_context_package_project_generated
    ON project_context_package_archive(project_id, package_type, generated_at DESC);

COMMENT ON TABLE project_state_snapshot IS
    'Rebuildable current Project State read model; state_revision changes only for semantic state transitions.';
COMMENT ON TABLE project_change_log IS
    'Idempotent semantic project change audit, not a full event-sourcing log.';
