CREATE TABLE brain_thread (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
    title TEXT NOT NULL CHECK (btrim(title) <> ''),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    created_by TEXT NOT NULL CHECK (btrim(created_by) <> ''),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE brain_run (
    id UUID PRIMARY KEY,
    thread_id UUID NOT NULL REFERENCES brain_thread(id) ON DELETE RESTRICT,
    context_package_id UUID NOT NULL REFERENCES project_context_package_archive(id) ON DELETE RESTRICT,
    role_version TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    output_schema_version TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    permissions JSONB NOT NULL,
    composite_context_version JSONB NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED')),
    input_tokens BIGINT NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
    output_tokens BIGINT NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
    generated_proposal JSONB,
    error_code TEXT,
    error_message TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);

CREATE TABLE brain_message (
    id UUID PRIMARY KEY,
    thread_id UUID NOT NULL REFERENCES brain_thread(id) ON DELETE RESTRICT,
    run_id UUID REFERENCES brain_run(id) ON DELETE RESTRICT,
    role TEXT NOT NULL CHECK (role IN ('USER', 'BRAIN')),
    content TEXT NOT NULL CHECK (btrim(content) <> ''),
    context_package_id UUID REFERENCES project_context_package_archive(id) ON DELETE RESTRICT,
    citations JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_brain_thread_project_updated
    ON brain_thread(project_id, updated_at DESC);
CREATE INDEX idx_brain_message_thread_created
    ON brain_message(thread_id, created_at);
CREATE INDEX idx_brain_run_thread_started
    ON brain_run(thread_id, started_at DESC);

COMMENT ON TABLE brain_run IS
    'Audited no-tool Project Brain run pinned to one archived Context Package and versioned role contract.';
COMMENT ON COLUMN brain_run.generated_proposal IS
    'Non-authoritative typed suggestion; it never mutates Project State or Plan directly.';
