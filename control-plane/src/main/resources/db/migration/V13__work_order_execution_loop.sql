CREATE TABLE work_order (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
    plan_id UUID NOT NULL REFERENCES project_plan(id) ON DELETE RESTRICT,
    plan_version_id UUID NOT NULL REFERENCES plan_version(id) ON DELETE RESTRICT,
    node_key TEXT NOT NULL CHECK (btrim(node_key) <> ''),
    schema_version TEXT NOT NULL DEFAULT '1.0' CHECK (schema_version = '1.0'),
    client_request_id TEXT NOT NULL CHECK (btrim(client_request_id) <> ''),
    request_hash TEXT NOT NULL CHECK (btrim(request_hash) <> ''),
    profile_id UUID NOT NULL REFERENCES agent_profile(id) ON DELETE RESTRICT,
    title TEXT NOT NULL CHECK (btrim(title) <> ''),
    objective TEXT NOT NULL CHECK (btrim(objective) <> ''),
    acceptance_criteria JSONB NOT NULL,
    required_capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
    context_version JSONB NOT NULL,
    created_by TEXT NOT NULL CHECK (btrim(created_by) <> ''),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, client_request_id),
    FOREIGN KEY (plan_version_id, node_key)
        REFERENCES plan_node_definition(plan_version_id, node_key) ON DELETE RESTRICT
);

CREATE TABLE work_order_execution (
    work_order_id UUID PRIMARY KEY REFERENCES work_order(id) ON DELETE RESTRICT,
    status TEXT NOT NULL CHECK (status IN (
        'CLAIMED', 'DISPATCHING', 'DISPATCHED', 'RUNNING', 'WAITING_APPROVAL',
        'AWAITING_VERIFICATION', 'VERIFIED', 'REJECTED', 'FAILED', 'LOST', 'ABORTED'
    )),
    status_reason TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE work_order_execution_binding (
    id UUID PRIMARY KEY,
    work_order_id UUID NOT NULL UNIQUE REFERENCES work_order(id) ON DELETE RESTRICT,
    task_id UUID NOT NULL UNIQUE REFERENCES agent_task(id) ON DELETE RESTRICT,
    initial_attempt_id UUID NOT NULL UNIQUE REFERENCES task_attempt(id) ON DELETE RESTRICT,
    bound_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE execution_report (
    id UUID PRIMARY KEY,
    work_order_id UUID NOT NULL REFERENCES work_order(id) ON DELETE RESTRICT,
    task_id UUID NOT NULL REFERENCES agent_task(id) ON DELETE RESTRICT,
    attempt_id UUID NOT NULL UNIQUE REFERENCES task_attempt(id) ON DELETE RESTRICT,
    schema_version TEXT NOT NULL DEFAULT '1.0' CHECK (schema_version = '1.0'),
    attempt_status TEXT NOT NULL CHECK (attempt_status IN ('SUCCEEDED', 'FAILED', 'LOST', 'ABORTED')),
    agent_claims JSONB NOT NULL DEFAULT '[]'::jsonb,
    system_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (work_order_id, attempt_id)
);

CREATE TABLE execution_verification (
    id UUID PRIMARY KEY,
    report_id UUID NOT NULL UNIQUE REFERENCES execution_report(id) ON DELETE RESTRICT,
    decision TEXT NOT NULL CHECK (decision IN ('PASSED', 'FAILED')),
    reason TEXT NOT NULL CHECK (btrim(reason) <> ''),
    verified_by TEXT NOT NULL CHECK (btrim(verified_by) <> ''),
    system_evidence_count INTEGER NOT NULL CHECK (system_evidence_count >= 0),
    state_entry_id UUID REFERENCES project_state_entry(id) ON DELETE RESTRICT,
    brain_thread_id UUID REFERENCES brain_thread(id) ON DELETE RESTRICT,
    verified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE work_order_event (
    id BIGSERIAL PRIMARY KEY,
    work_order_id UUID NOT NULL REFERENCES work_order(id) ON DELETE RESTRICT,
    event_type TEXT NOT NULL CHECK (btrim(event_type) <> ''),
    actor TEXT NOT NULL CHECK (btrim(actor) <> ''),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE brain_run
    ADD COLUMN trigger_type TEXT,
    ADD COLUMN trigger_id UUID;

CREATE UNIQUE INDEX uq_brain_run_trigger
    ON brain_run(trigger_type, trigger_id)
    WHERE trigger_type IS NOT NULL AND trigger_id IS NOT NULL;
CREATE INDEX idx_work_order_plan_node
    ON work_order(plan_id, node_key, created_at DESC);
CREATE INDEX idx_work_order_project_created
    ON work_order(project_id, created_at DESC);
CREATE INDEX idx_work_order_event_order
    ON work_order_event(work_order_id, id);

COMMENT ON TABLE work_order IS
    'Immutable WorkOrderV1 definition pinned to one approved Plan Version and node.';
COMMENT ON TABLE work_order_execution_binding IS
    'Execution Bridge binding to the existing Agent Task / Attempt execution truth.';
COMMENT ON TABLE execution_report IS
    'Immutable ExecutionReportV1 separating Agent Claims from Runtime-observed System Evidence.';

CREATE FUNCTION reject_work_order_definition_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Work Order definition and execution evidence rows are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_work_order_immutable
    BEFORE UPDATE OR DELETE ON work_order
    FOR EACH ROW EXECUTE FUNCTION reject_work_order_definition_mutation();
CREATE TRIGGER trg_work_order_binding_immutable
    BEFORE UPDATE OR DELETE ON work_order_execution_binding
    FOR EACH ROW EXECUTE FUNCTION reject_work_order_definition_mutation();
CREATE TRIGGER trg_execution_report_immutable
    BEFORE UPDATE OR DELETE ON execution_report
    FOR EACH ROW EXECUTE FUNCTION reject_work_order_definition_mutation();
CREATE TRIGGER trg_execution_verification_immutable
    BEFORE UPDATE OR DELETE ON execution_verification
    FOR EACH ROW EXECUTE FUNCTION reject_work_order_definition_mutation();
CREATE TRIGGER trg_work_order_event_immutable
    BEFORE UPDATE OR DELETE ON work_order_event
    FOR EACH ROW EXECUTE FUNCTION reject_work_order_definition_mutation();
