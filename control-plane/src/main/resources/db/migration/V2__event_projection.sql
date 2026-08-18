ALTER TABLE task_event
    ADD COLUMN runtime_run_id TEXT,
    ADD COLUMN projected_at TIMESTAMPTZ;

CREATE INDEX idx_event_attempt_projection
    ON task_event(attempt_id, sequence_no)
    WHERE projected_at IS NULL;
