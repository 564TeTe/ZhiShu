ALTER TABLE agent_task
    ADD COLUMN archived_at TIMESTAMPTZ,
    ADD COLUMN archived_by TEXT,
    ADD COLUMN archive_reason TEXT;

ALTER TABLE agent_task
    ADD CONSTRAINT chk_agent_task_archive_actor
    CHECK (
        (archived_at IS NULL AND archived_by IS NULL)
        OR (archived_at IS NOT NULL AND btrim(archived_by) <> '')
    );

CREATE INDEX idx_agent_task_project_active_created
    ON agent_task(project_id, created_at DESC)
    WHERE archived_at IS NULL;

CREATE TABLE evidence_reference (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
    artifact_id UUID NOT NULL REFERENCES task_artifact(id) ON DELETE RESTRICT,
    source_type TEXT NOT NULL,
    source_id UUID NOT NULL,
    purpose TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_evidence_reference_text
        CHECK (btrim(source_type) <> '' AND btrim(purpose) <> '' AND btrim(created_by) <> ''),
    UNIQUE (source_type, source_id, artifact_id)
);

CREATE INDEX idx_evidence_reference_artifact
    ON evidence_reference(artifact_id, created_at DESC);
CREATE INDEX idx_evidence_reference_source
    ON evidence_reference(source_type, source_id, created_at DESC);

COMMENT ON COLUMN agent_task.archived_at IS
    'Business archive marker. Archived tasks and their execution evidence remain physically present.';
COMMENT ON TABLE evidence_reference IS
    'Durable references from future Decision/Plan/Report/Verification records to existing task artifacts.';
