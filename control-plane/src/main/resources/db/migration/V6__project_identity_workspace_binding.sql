ALTER TABLE project
    ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN repository_identity TEXT,
    ADD COLUMN identity_version BIGINT NOT NULL DEFAULT 1;

ALTER TABLE project
    ADD CONSTRAINT chk_project_status
    CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    ADD CONSTRAINT chk_project_identity_version
    CHECK (identity_version >= 1);

CREATE TABLE workspace_binding (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    machine_id TEXT NOT NULL,
    local_project_id TEXT,
    workspace_path TEXT NOT NULL,
    normalized_workspace_path TEXT NOT NULL,
    repository_url TEXT,
    remote_fingerprint TEXT,
    branch TEXT,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_workspace_binding_machine
        CHECK (btrim(machine_id) <> ''),
    CONSTRAINT chk_workspace_binding_path
        CHECK (btrim(workspace_path) <> '' AND btrim(normalized_workspace_path) <> ''),
    CONSTRAINT chk_workspace_binding_status
        CHECK (status IN ('ACTIVE', 'MOVED', 'DETACHED', 'STALE')),
    UNIQUE (machine_id, normalized_workspace_path)
);

CREATE UNIQUE INDEX uq_workspace_binding_machine_local_project
    ON workspace_binding(machine_id, local_project_id)
    WHERE local_project_id IS NOT NULL;

CREATE UNIQUE INDEX uq_workspace_binding_primary_project
    ON workspace_binding(project_id)
    WHERE is_primary = TRUE AND status = 'ACTIVE';

CREATE INDEX idx_workspace_binding_project_status
    ON workspace_binding(project_id, status, updated_at DESC);

CREATE INDEX idx_workspace_binding_remote_fingerprint
    ON workspace_binding(remote_fingerprint)
    WHERE remote_fingerprint IS NOT NULL;

-- Existing projects predate machine and local-project identity. Preserve their
-- exact runtime path under a reserved compatibility machine until a trusted
-- Node client explicitly rebinds them in the next rollout batch.
INSERT INTO workspace_binding (
    id,
    project_id,
    machine_id,
    local_project_id,
    workspace_path,
    normalized_workspace_path,
    repository_url,
    remote_fingerprint,
    branch,
    is_primary,
    status,
    last_seen_at,
    created_at,
    updated_at
)
SELECT
    p.id,
    p.id,
    'legacy-unscoped',
    NULL,
    p.runtime_project_ref,
    p.runtime_project_ref,
    p.repository_url,
    NULL,
    NULL,
    TRUE,
    'ACTIVE',
    p.updated_at,
    p.created_at,
    p.updated_at
FROM project p
WHERE btrim(p.runtime_project_ref) <> '';

COMMENT ON COLUMN project.runtime_project_ref IS
    'Compatibility runtime path retained for control-v1 execution until workspace binding resolution is fully adopted.';
COMMENT ON COLUMN project.display_root_path IS
    'Compatibility display path retained during the workspace binding rollout.';
COMMENT ON TABLE workspace_binding IS
    'Machine-scoped workspace mounts linked to a stable project identity; paths are client-normalized and are not project identities.';
COMMENT ON COLUMN workspace_binding.local_project_id IS
    'Optional Node-local project locator. It is scoped by machine_id and is never the authoritative Control Plane project id.';
