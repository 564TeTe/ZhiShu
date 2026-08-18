ALTER TABLE agent_task
    ADD COLUMN IF NOT EXISTS resolution_status TEXT NOT NULL DEFAULT 'OPEN',
    ADD COLUMN IF NOT EXISTS resolution_version BIGINT NOT NULL DEFAULT 0;

UPDATE agent_task
SET resolution_status = CASE status
    WHEN 'SUCCEEDED' THEN 'WAITING_ACCEPTANCE'
    WHEN 'FAILED' THEN 'NEEDS_FOLLOW_UP'
    WHEN 'ABORTED' THEN 'NEEDS_FOLLOW_UP'
    ELSE 'IN_PROGRESS'
END
WHERE resolution_status = 'OPEN';

CREATE TABLE task_acceptance_audit (
    id UUID PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES agent_task(id) ON DELETE CASCADE,
    attempt_id UUID NOT NULL REFERENCES task_attempt(id) ON DELETE CASCADE,
    client_request_id TEXT NOT NULL,
    actor TEXT NOT NULL,
    decision TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (task_id, client_request_id)
);

CREATE TABLE task_follow_up (
    id UUID PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES agent_task(id) ON DELETE CASCADE,
    parent_attempt_id UUID NOT NULL REFERENCES task_attempt(id) ON DELETE RESTRICT,
    attempt_id UUID NOT NULL REFERENCES task_attempt(id) ON DELETE CASCADE,
    client_request_id TEXT NOT NULL,
    actor TEXT NOT NULL,
    feedback TEXT NOT NULL,
    requested_acceptance TEXT NOT NULL,
    additional_context JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (task_id, client_request_id),
    UNIQUE (attempt_id)
);

CREATE INDEX idx_agent_task_resolution_status
    ON agent_task(project_id, resolution_status, updated_at DESC);
CREATE INDEX idx_task_acceptance_audit_task_created
    ON task_acceptance_audit(task_id, created_at DESC);
CREATE INDEX idx_task_follow_up_task_created
    ON task_follow_up(task_id, created_at DESC);
