CREATE TABLE project_plan (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
    name TEXT NOT NULL CHECK (btrim(name) <> ''),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    current_version_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE plan_proposal (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
    plan_id UUID REFERENCES project_plan(id) ON DELETE RESTRICT,
    proposal_type TEXT NOT NULL CHECK (proposal_type IN ('PLAN_PROPOSAL_V1', 'PLAN_PATCH_PROPOSAL_V1')),
    status TEXT NOT NULL CHECK (status IN ('PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'STALE')),
    base_state_revision BIGINT NOT NULL CHECK (base_state_revision >= 0),
    base_plan_version BIGINT,
    payload JSONB NOT NULL,
    context_package_id UUID NOT NULL REFERENCES project_context_package_archive(id) ON DELETE RESTRICT,
    source_role_version TEXT NOT NULL DEFAULT 'project-planner:v1',
    prompt_version TEXT NOT NULL DEFAULT 'project-planner-prompt:v1',
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    permissions JSONB NOT NULL,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_by TEXT,
    decided_at TIMESTAMPTZ,
    published_version_id UUID,
    rejection_reason TEXT
);

CREATE TABLE plan_version (
    id UUID PRIMARY KEY,
    plan_id UUID NOT NULL REFERENCES project_plan(id) ON DELETE RESTRICT,
    version_number BIGINT NOT NULL CHECK (version_number >= 1),
    objective TEXT NOT NULL CHECK (btrim(objective) <> ''),
    creation_reason TEXT NOT NULL CHECK (btrim(creation_reason) <> ''),
    base_state_revision BIGINT NOT NULL CHECK (base_state_revision >= 0),
    source_proposal_id UUID NOT NULL UNIQUE REFERENCES plan_proposal(id) ON DELETE RESTRICT,
    previous_version_id UUID REFERENCES plan_version(id) ON DELETE RESTRICT,
    approved_by TEXT NOT NULL,
    published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (plan_id, version_number)
);

ALTER TABLE project_plan
    ADD CONSTRAINT fk_project_plan_current_version
    FOREIGN KEY (current_version_id) REFERENCES plan_version(id) ON DELETE RESTRICT;
ALTER TABLE plan_proposal
    ADD CONSTRAINT fk_plan_proposal_published_version
    FOREIGN KEY (published_version_id) REFERENCES plan_version(id) ON DELETE RESTRICT;

CREATE TABLE plan_node_definition (
    id UUID PRIMARY KEY,
    plan_version_id UUID NOT NULL REFERENCES plan_version(id) ON DELETE RESTRICT,
    node_key TEXT NOT NULL CHECK (btrim(node_key) <> ''),
    title TEXT NOT NULL CHECK (btrim(title) <> ''),
    objective TEXT NOT NULL CHECK (btrim(objective) <> ''),
    scope JSONB NOT NULL DEFAULT '[]'::jsonb,
    acceptance_criteria JSONB NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    required_capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
    requires_human_approval BOOLEAN NOT NULL DEFAULT FALSE,
    executable BOOLEAN NOT NULL DEFAULT TRUE,
    capability_warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
    UNIQUE (plan_version_id, node_key)
);

CREATE TABLE plan_node_dependency (
    plan_version_id UUID NOT NULL REFERENCES plan_version(id) ON DELETE RESTRICT,
    node_key TEXT NOT NULL,
    depends_on_node_key TEXT NOT NULL,
    PRIMARY KEY (plan_version_id, node_key, depends_on_node_key),
    FOREIGN KEY (plan_version_id, node_key)
        REFERENCES plan_node_definition(plan_version_id, node_key) ON DELETE RESTRICT,
    FOREIGN KEY (plan_version_id, depends_on_node_key)
        REFERENCES plan_node_definition(plan_version_id, node_key) ON DELETE RESTRICT,
    CHECK (node_key <> depends_on_node_key)
);

CREATE TABLE plan_node_version_relation (
    id UUID PRIMARY KEY,
    plan_version_id UUID NOT NULL REFERENCES plan_version(id) ON DELETE RESTRICT,
    node_key TEXT NOT NULL,
    previous_node_key TEXT,
    relation_type TEXT NOT NULL CHECK (relation_type IN ('INHERITED', 'SUPERSEDED', 'CANCELLED', 'NEW')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE plan_execution_state (
    plan_id UUID NOT NULL REFERENCES project_plan(id) ON DELETE RESTRICT,
    node_key TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN (
        'NOT_READY', 'READY', 'APPROVED_FOR_EXECUTION', 'DISPATCHING', 'RUNNING',
        'WAITING_APPROVAL', 'VERIFYING', 'BLOCKED', 'COMPLETED', 'FAILED', 'CANCELLED', 'SUPERSEDED'
    )),
    task_id UUID REFERENCES agent_task(id) ON DELETE RESTRICT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (plan_id, node_key)
);

CREATE INDEX idx_plan_project_updated ON project_plan(project_id, updated_at DESC);
CREATE INDEX idx_plan_proposal_project_status ON plan_proposal(project_id, status, created_at DESC);
CREATE INDEX idx_plan_node_version_priority ON plan_node_definition(plan_version_id, priority DESC, node_key);

COMMENT ON TABLE plan_version IS 'Immutable approved Plan Definition version.';
COMMENT ON TABLE plan_execution_state IS 'Mutable execution projection separated from immutable Plan Definition.';

CREATE FUNCTION reject_plan_definition_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Published Plan Definition rows are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_plan_version_immutable
    BEFORE UPDATE OR DELETE ON plan_version
    FOR EACH ROW EXECUTE FUNCTION reject_plan_definition_mutation();
CREATE TRIGGER trg_plan_node_definition_immutable
    BEFORE UPDATE OR DELETE ON plan_node_definition
    FOR EACH ROW EXECUTE FUNCTION reject_plan_definition_mutation();
CREATE TRIGGER trg_plan_node_dependency_immutable
    BEFORE UPDATE OR DELETE ON plan_node_dependency
    FOR EACH ROW EXECUTE FUNCTION reject_plan_definition_mutation();
CREATE TRIGGER trg_plan_node_relation_immutable
    BEFORE UPDATE OR DELETE ON plan_node_version_relation
    FOR EACH ROW EXECUTE FUNCTION reject_plan_definition_mutation();
