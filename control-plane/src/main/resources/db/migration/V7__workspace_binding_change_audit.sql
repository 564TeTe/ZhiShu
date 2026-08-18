CREATE TABLE workspace_binding_change (
    id UUID PRIMARY KEY,
    proposal_id UUID NOT NULL,
    project_id UUID NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
    workspace_id UUID NOT NULL REFERENCES workspace_binding(id) ON DELETE RESTRICT,
    resulting_workspace_id UUID NOT NULL REFERENCES workspace_binding(id) ON DELETE RESTRICT,
    action TEXT NOT NULL,
    actor TEXT NOT NULL,
    client_request_id TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    base_identity_version BIGINT NOT NULL,
    resulting_identity_version BIGINT NOT NULL,
    before_snapshot JSONB NOT NULL,
    after_snapshot JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_workspace_binding_change_action
        CHECK (action IN ('MOVE_WORKSPACE', 'REBIND_LOCAL_PROJECT')),
    CONSTRAINT chk_workspace_binding_change_actor
        CHECK (btrim(actor) <> '' AND btrim(client_request_id) <> ''),
    UNIQUE (actor, client_request_id)
);

CREATE INDEX idx_workspace_binding_change_project_created
    ON workspace_binding_change(project_id, created_at DESC);

COMMENT ON TABLE workspace_binding_change IS
    'Immutable actor/idempotency audit for explicitly confirmed workspace move and local-id rebind commands.';
