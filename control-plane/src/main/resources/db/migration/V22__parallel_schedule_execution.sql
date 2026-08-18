CREATE TABLE parallel_schedule_dispatch (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
    plan_id UUID NOT NULL REFERENCES project_plan(id) ON DELETE RESTRICT,
    schedule_id UUID NOT NULL UNIQUE REFERENCES parallel_schedule_proposal(id) ON DELETE RESTRICT,
    client_request_id TEXT NOT NULL CHECK (btrim(client_request_id) <> ''),
    request_hash TEXT NOT NULL CHECK (btrim(request_hash) <> ''),
    created_by TEXT NOT NULL CHECK (btrim(created_by) <> ''),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, created_by, client_request_id)
);

ALTER TABLE work_order
    ADD COLUMN schedule_dispatch_id UUID REFERENCES parallel_schedule_dispatch(id) ON DELETE RESTRICT,
    ADD COLUMN schedule_id UUID REFERENCES parallel_schedule_proposal(id) ON DELETE RESTRICT,
    ADD COLUMN schedule_assignment_id UUID UNIQUE REFERENCES parallel_schedule_assignment(id) ON DELETE RESTRICT,
    ADD COLUMN workspace_lease_id UUID UNIQUE REFERENCES workspace_lease(id) ON DELETE RESTRICT,
    ADD COLUMN execution_workspace_path TEXT,
    ADD CONSTRAINT ck_work_order_schedule_execution_metadata CHECK (
        (schedule_dispatch_id IS NULL AND schedule_id IS NULL AND schedule_assignment_id IS NULL
            AND workspace_lease_id IS NULL AND execution_workspace_path IS NULL)
        OR
        (schedule_dispatch_id IS NOT NULL AND schedule_id IS NOT NULL AND schedule_assignment_id IS NOT NULL
            AND workspace_lease_id IS NOT NULL AND btrim(execution_workspace_path) <> '')
    );

CREATE INDEX idx_parallel_schedule_dispatch_project_created
    ON parallel_schedule_dispatch(project_id, created_at DESC);
CREATE INDEX idx_work_order_schedule
    ON work_order(schedule_id, created_at DESC)
    WHERE schedule_id IS NOT NULL;

COMMENT ON TABLE parallel_schedule_dispatch IS
    'Immutable idempotent claim of one approved, fully provisioned two-worker Schedule.';
COMMENT ON COLUMN work_order.execution_workspace_path IS
    'Frozen Control Plane-owned DIRECTORY_ONLY workspace used as Runtime cwd and approval root.';

CREATE TRIGGER trg_parallel_schedule_dispatch_immutable
    BEFORE UPDATE OR DELETE ON parallel_schedule_dispatch
    FOR EACH ROW EXECUTE FUNCTION reject_work_order_definition_mutation();
