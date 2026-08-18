CREATE TABLE project (
    id UUID PRIMARY KEY,
    runtime_project_ref TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    repository_url TEXT,
    display_root_path TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE agent_profile (
    id UUID PRIMARY KEY,
    project_id UUID REFERENCES project(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    executor TEXT NOT NULL,
    model_alias TEXT,
    capabilities JSONB NOT NULL,
    permission_policy JSONB NOT NULL,
    timeout_seconds INTEGER NOT NULL,
    prompt_version TEXT NOT NULL DEFAULT 'task-v1',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE agent_task (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES project(id),
    profile_id UUID NOT NULL REFERENCES agent_profile(id),
    title TEXT NOT NULL,
    objective TEXT NOT NULL,
    status TEXT NOT NULL,
    current_attempt_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE task_attempt (
    id UUID PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES agent_task(id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL,
    runtime_run_id TEXT,
    status TEXT NOT NULL,
    profile_snapshot JSONB NOT NULL,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error_code TEXT,
    error_message TEXT,
    retry_reason TEXT,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (task_id, attempt_number)
);

ALTER TABLE agent_task
    ADD CONSTRAINT fk_agent_task_current_attempt
    FOREIGN KEY (current_attempt_id) REFERENCES task_attempt(id);

CREATE TABLE task_event (
    id BIGSERIAL PRIMARY KEY,
    event_id TEXT NOT NULL UNIQUE,
    task_id UUID NOT NULL REFERENCES agent_task(id) ON DELETE CASCADE,
    attempt_id UUID NOT NULL REFERENCES task_attempt(id) ON DELETE CASCADE,
    sequence_no BIGINT NOT NULL,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (attempt_id, sequence_no)
);

CREATE TABLE approval_request (
    id UUID PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES agent_task(id) ON DELETE CASCADE,
    attempt_id UUID NOT NULL REFERENCES task_attempt(id) ON DELETE CASCADE,
    runtime_approval_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    tool_input JSONB NOT NULL,
    risk_level TEXT NOT NULL,
    status TEXT NOT NULL,
    expires_at TIMESTAMPTZ,
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (attempt_id, runtime_approval_id)
);

CREATE TABLE task_artifact (
    id UUID PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES agent_task(id) ON DELETE CASCADE,
    attempt_id UUID NOT NULL REFERENCES task_attempt(id) ON DELETE CASCADE,
    artifact_type TEXT NOT NULL,
    producer TEXT NOT NULL,
    content_plain TEXT,
    storage_path TEXT,
    mime_type TEXT,
    size_bytes BIGINT,
    hash TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_task_project_status_created
    ON agent_task(project_id, status, created_at DESC);
CREATE INDEX idx_event_task_id
    ON task_event(task_id, id);
CREATE INDEX idx_approval_status_expires
    ON approval_request(status, expires_at);
CREATE INDEX idx_artifact_task_created
    ON task_artifact(task_id, created_at);
