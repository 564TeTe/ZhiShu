CREATE TABLE project_approval_policy (
    project_id UUID PRIMARY KEY REFERENCES project(id) ON DELETE CASCADE,
    mode TEXT NOT NULL DEFAULT 'MANUAL',
    allowed_directories JSONB NOT NULL DEFAULT '["."]'::jsonb,
    trusted_commands JSONB NOT NULL DEFAULT '[]'::jsonb,
    approval_timeout_seconds INTEGER NOT NULL DEFAULT 45,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO project_approval_policy (project_id)
SELECT id FROM project
ON CONFLICT (project_id) DO NOTHING;

ALTER TABLE task_attempt
    ADD COLUMN approval_policy_snapshot JSONB NOT NULL DEFAULT '{
      "mode":"MANUAL",
      "projectRoot":"",
      "allowedDirectories":["."],
      "trustedCommands":[],
      "approvalTimeoutSeconds":45
    }'::jsonb;

UPDATE task_attempt ta
SET approval_policy_snapshot = jsonb_build_object(
    'mode', 'MANUAL',
    'projectRoot', p.runtime_project_ref,
    'allowedDirectories', jsonb_build_array('.'),
    'trustedCommands', '[]'::jsonb,
    'approvalTimeoutSeconds', 45
)
FROM agent_task t
JOIN project p ON p.id = t.project_id
WHERE t.id = ta.task_id
  AND ta.approval_policy_snapshot ->> 'projectRoot' = '';

ALTER TABLE approval_request
    ADD COLUMN decision_source TEXT,
    ADD COLUMN policy TEXT,
    ADD COLUMN rule TEXT,
    ADD COLUMN reason TEXT;

CREATE TABLE approval_audit (
    id UUID PRIMARY KEY,
    approval_id UUID NOT NULL REFERENCES approval_request(id) ON DELETE CASCADE,
    task_id UUID NOT NULL REFERENCES agent_task(id) ON DELETE CASCADE,
    attempt_id UUID NOT NULL REFERENCES task_attempt(id) ON DELETE CASCADE,
    actor TEXT NOT NULL,
    decision TEXT NOT NULL,
    policy TEXT NOT NULL,
    rule TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (approval_id, decision)
);

CREATE INDEX idx_approval_request_pending_expiry
    ON approval_request(expires_at)
    WHERE status IN ('PENDING', 'APPROVING', 'DENYING', 'AUTO_APPROVING', 'EXPIRING');
CREATE INDEX idx_approval_audit_task_created
    ON approval_audit(task_id, created_at DESC);
