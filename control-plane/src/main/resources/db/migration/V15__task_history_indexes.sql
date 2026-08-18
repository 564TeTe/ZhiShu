CREATE INDEX idx_agent_task_project_history_created
    ON agent_task(project_id, created_at DESC, id DESC);

CREATE INDEX idx_agent_task_project_archived_created
    ON agent_task(project_id, created_at DESC, id DESC)
    WHERE archived_at IS NOT NULL;

COMMENT ON INDEX idx_agent_task_project_history_created IS
    'Supports stable project Task history keyset pagination across active and archived records.';
COMMENT ON INDEX idx_agent_task_project_archived_created IS
    'Supports archived-only Task history scans without removing execution evidence.';
