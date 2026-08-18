CREATE TABLE project_activity_event (
    cursor BIGSERIAL PRIMARY KEY,
    event_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    project_id UUID NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
    change_type TEXT NOT NULL CHECK (btrim(change_type) <> ''),
    resource_type TEXT NOT NULL CHECK (btrim(resource_type) <> ''),
    resource_id TEXT NOT NULL CHECK (btrim(resource_id) <> ''),
    task_id UUID,
    attempt_id UUID,
    source_event_id TEXT,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_project_activity_project_cursor
    ON project_activity_event(project_id, cursor);
CREATE INDEX idx_project_activity_project_occurred
    ON project_activity_event(project_id, occurred_at DESC);

COMMENT ON TABLE project_activity_event IS
    'Durable project-scoped at-least-once activity feed. Payloads remain in authoritative read models.';
COMMENT ON COLUMN project_activity_event.cursor IS
    'Monotonic durable cursor. It is independent of Runtime sequence numbers and may have gaps per project.';

CREATE OR REPLACE FUNCTION append_project_activity_event(
    p_project_id UUID,
    p_change_type TEXT,
    p_resource_type TEXT,
    p_resource_id TEXT,
    p_task_id UUID DEFAULT NULL,
    p_attempt_id UUID DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
    IF p_project_id IS NULL OR p_resource_id IS NULL OR btrim(p_resource_id) = '' THEN
        RETURN;
    END IF;
    INSERT INTO project_activity_event (
        project_id, change_type, resource_type, resource_id, task_id, attempt_id
    ) VALUES (
        p_project_id, p_change_type, p_resource_type, p_resource_id, p_task_id, p_attempt_id
    );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION record_direct_project_activity() RETURNS trigger AS $$
DECLARE
    row_json JSONB := to_jsonb(NEW);
    old_json JSONB := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END;
    project_key UUID;
    resource_key TEXT;
BEGIN
    IF TG_OP = 'UPDATE' AND (row_json - 'updated_at') IS NOT DISTINCT FROM (old_json - 'updated_at') THEN
        RETURN NEW;
    END IF;
    project_key := NULLIF(row_json ->> 'project_id', '')::UUID;
    resource_key := COALESCE(NULLIF(row_json ->> 'id', ''), row_json ->> 'project_id');
    PERFORM append_project_activity_event(
        project_key,
        CASE WHEN TG_OP = 'INSERT' THEN TG_ARGV[0] ELSE TG_ARGV[1] END,
        TG_ARGV[2],
        resource_key
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION record_task_activity() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'UPDATE'
       AND NEW.title IS NOT DISTINCT FROM OLD.title
       AND NEW.objective IS NOT DISTINCT FROM OLD.objective
       AND NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.current_attempt_id IS NOT DISTINCT FROM OLD.current_attempt_id
       AND NEW.resolution_status IS NOT DISTINCT FROM OLD.resolution_status
       AND NEW.archived_at IS NOT DISTINCT FROM OLD.archived_at THEN
        RETURN NEW;
    END IF;
    PERFORM append_project_activity_event(
        NEW.project_id,
        CASE WHEN TG_OP = 'INSERT' THEN 'TASK_CREATED' ELSE 'TASK_UPDATED' END,
        'TASK',
        NEW.id::TEXT,
        NEW.id,
        NEW.current_attempt_id
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION record_attempt_activity() RETURNS trigger AS $$
DECLARE
    task_project_id UUID;
BEGIN
    IF TG_OP = 'UPDATE'
       AND NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.runtime_health_status IS NOT DISTINCT FROM OLD.runtime_health_status
       AND NEW.started_at IS NOT DISTINCT FROM OLD.started_at
       AND NEW.completed_at IS NOT DISTINCT FROM OLD.completed_at
       AND NEW.error_code IS NOT DISTINCT FROM OLD.error_code
       AND NEW.error_message IS NOT DISTINCT FROM OLD.error_message THEN
        RETURN NEW;
    END IF;
    SELECT project_id INTO task_project_id FROM agent_task WHERE id = NEW.task_id;
    PERFORM append_project_activity_event(
        task_project_id,
        CASE WHEN TG_OP = 'INSERT' THEN 'ATTEMPT_CREATED' ELSE 'ATTEMPT_UPDATED' END,
        'ATTEMPT',
        NEW.id::TEXT,
        NEW.task_id,
        NEW.id
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION record_approval_activity() RETURNS trigger AS $$
DECLARE
    task_project_id UUID;
BEGIN
    IF TG_OP = 'UPDATE'
       AND NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.decided_at IS NOT DISTINCT FROM OLD.decided_at
       AND NEW.decision_source IS NOT DISTINCT FROM OLD.decision_source
       AND NEW.reason IS NOT DISTINCT FROM OLD.reason THEN
        RETURN NEW;
    END IF;
    SELECT project_id INTO task_project_id FROM agent_task WHERE id = NEW.task_id;
    PERFORM append_project_activity_event(
        task_project_id,
        CASE WHEN TG_OP = 'INSERT' THEN 'APPROVAL_CREATED' ELSE 'APPROVAL_UPDATED' END,
        'APPROVAL',
        NEW.id::TEXT,
        NEW.task_id,
        NEW.attempt_id
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION record_task_child_activity() RETURNS trigger AS $$
DECLARE
    task_project_id UUID;
    row_json JSONB := to_jsonb(NEW);
    task_key UUID := NULLIF(row_json ->> 'task_id', '')::UUID;
    attempt_key UUID := NULLIF(row_json ->> 'attempt_id', '')::UUID;
    resource_key TEXT := NULLIF(row_json ->> 'id', '');
BEGIN
    SELECT project_id INTO task_project_id FROM agent_task WHERE id = task_key;
    PERFORM append_project_activity_event(
        task_project_id,
        TG_ARGV[0],
        TG_ARGV[1],
        resource_key,
        task_key,
        attempt_key
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION record_brain_activity() RETURNS trigger AS $$
DECLARE
    project_key UUID;
    thread_key UUID;
    row_json JSONB := to_jsonb(NEW);
BEGIN
    IF TG_TABLE_NAME = 'brain_thread' THEN
        project_key := NULLIF(row_json ->> 'project_id', '')::UUID;
        PERFORM append_project_activity_event(
            project_key,
            CASE WHEN TG_OP = 'INSERT' THEN 'BRAIN_THREAD_CREATED' ELSE 'BRAIN_THREAD_UPDATED' END,
            'BRAIN_THREAD',
            NEW.id::TEXT
        );
    ELSE
        thread_key := NULLIF(row_json ->> 'thread_id', '')::UUID;
        SELECT project_id INTO project_key FROM brain_thread WHERE id = thread_key;
        PERFORM append_project_activity_event(
            project_key,
            CASE WHEN TG_TABLE_NAME = 'brain_message' THEN 'BRAIN_MESSAGE_CREATED'
                 WHEN TG_OP = 'INSERT' THEN 'BRAIN_RUN_CREATED' ELSE 'BRAIN_RUN_UPDATED' END,
            CASE WHEN TG_TABLE_NAME = 'brain_message' THEN 'BRAIN_MESSAGE' ELSE 'BRAIN_RUN' END,
            NEW.id::TEXT
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION record_plan_execution_activity() RETURNS trigger AS $$
DECLARE
    project_key UUID;
BEGIN
    IF TG_OP = 'UPDATE'
       AND NEW.state IS NOT DISTINCT FROM OLD.state
       AND NEW.task_id IS NOT DISTINCT FROM OLD.task_id THEN
        RETURN NEW;
    END IF;
    SELECT project_id INTO project_key FROM project_plan WHERE id = NEW.plan_id;
    PERFORM append_project_activity_event(
        project_key,
        CASE WHEN TG_OP = 'INSERT' THEN 'PLAN_EXECUTION_CREATED' ELSE 'PLAN_EXECUTION_UPDATED' END,
        'PLAN_EXECUTION',
        NEW.plan_id::TEXT || ':' || NEW.node_key,
        NEW.task_id,
        NULL
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION record_work_order_activity() RETURNS trigger AS $$
DECLARE
    project_key UUID;
    work_order_key UUID;
    task_key UUID;
    attempt_key UUID;
    row_json JSONB := to_jsonb(NEW);
    old_json JSONB := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END;
BEGIN
    IF TG_TABLE_NAME = 'work_order' THEN
        project_key := NULLIF(row_json ->> 'project_id', '')::UUID;
        work_order_key := NULLIF(row_json ->> 'id', '')::UUID;
    ELSIF TG_TABLE_NAME = 'execution_verification' THEN
        SELECT er.work_order_id, w.project_id, er.task_id, er.attempt_id
        INTO work_order_key, project_key, task_key, attempt_key
        FROM execution_report er
        JOIN work_order w ON w.id = er.work_order_id
        WHERE er.id = NULLIF(row_json ->> 'report_id', '')::UUID;
    ELSE
        work_order_key := NULLIF(row_json ->> 'work_order_id', '')::UUID;
        SELECT project_id INTO project_key FROM work_order WHERE id = work_order_key;
        IF TG_TABLE_NAME = 'execution_report' THEN
            task_key := NULLIF(row_json ->> 'task_id', '')::UUID;
            attempt_key := NULLIF(row_json ->> 'attempt_id', '')::UUID;
        END IF;
    END IF;
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'work_order_execution'
       AND (row_json ->> 'status') IS NOT DISTINCT FROM (old_json ->> 'status')
       AND (row_json ->> 'status_reason') IS NOT DISTINCT FROM (old_json ->> 'status_reason') THEN
        RETURN NEW;
    END IF;
    PERFORM append_project_activity_event(
        project_key,
        CASE
            WHEN TG_TABLE_NAME = 'work_order' AND TG_OP = 'INSERT' THEN 'WORK_ORDER_CREATED'
            WHEN TG_TABLE_NAME = 'work_order_execution' AND TG_OP = 'INSERT' THEN 'WORK_ORDER_EXECUTION_CREATED'
            WHEN TG_TABLE_NAME = 'work_order_execution' THEN 'WORK_ORDER_EXECUTION_UPDATED'
            WHEN TG_TABLE_NAME = 'execution_report' THEN 'EXECUTION_REPORT_CREATED'
            ELSE 'WORK_ORDER_VERIFICATION_RECORDED'
        END,
        CASE
            WHEN TG_TABLE_NAME = 'work_order' THEN 'WORK_ORDER'
            WHEN TG_TABLE_NAME = 'work_order_execution' THEN 'WORK_ORDER_EXECUTION'
            WHEN TG_TABLE_NAME = 'execution_report' THEN 'EXECUTION_REPORT'
            ELSE 'EXECUTION_VERIFICATION'
        END,
        COALESCE(NULLIF(row_json ->> 'id', ''), work_order_key::TEXT),
        task_key,
        attempt_key
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_project_activity_task
    AFTER INSERT OR UPDATE ON agent_task
    FOR EACH ROW EXECUTE FUNCTION record_task_activity();
CREATE TRIGGER trg_project_activity_attempt
    AFTER INSERT OR UPDATE ON task_attempt
    FOR EACH ROW EXECUTE FUNCTION record_attempt_activity();
CREATE TRIGGER trg_project_activity_approval
    AFTER INSERT OR UPDATE ON approval_request
    FOR EACH ROW EXECUTE FUNCTION record_approval_activity();
CREATE TRIGGER trg_project_activity_artifact
    AFTER INSERT ON task_artifact
    FOR EACH ROW EXECUTE FUNCTION record_task_child_activity('ARTIFACT_PUBLISHED', 'ARTIFACT');
CREATE TRIGGER trg_project_activity_acceptance
    AFTER INSERT ON task_acceptance_audit
    FOR EACH ROW EXECUTE FUNCTION record_task_child_activity('ACCEPTANCE_RECORDED', 'ACCEPTANCE');
CREATE TRIGGER trg_project_activity_follow_up
    AFTER INSERT ON task_follow_up
    FOR EACH ROW EXECUTE FUNCTION record_task_child_activity('FOLLOW_UP_CREATED', 'FOLLOW_UP');

CREATE TRIGGER trg_project_activity_state_snapshot
    AFTER INSERT OR UPDATE ON project_state_snapshot
    FOR EACH ROW EXECUTE FUNCTION record_direct_project_activity('STATE_SNAPSHOT_CREATED', 'STATE_UPDATED', 'PROJECT_STATE');
CREATE TRIGGER trg_project_activity_approval_policy
    AFTER INSERT OR UPDATE ON project_approval_policy
    FOR EACH ROW EXECUTE FUNCTION record_direct_project_activity('APPROVAL_POLICY_CREATED', 'APPROVAL_POLICY_UPDATED', 'APPROVAL_POLICY');
CREATE TRIGGER trg_project_activity_state_proposal
    AFTER INSERT OR UPDATE ON project_state_proposal
    FOR EACH ROW EXECUTE FUNCTION record_direct_project_activity('STATE_PROPOSAL_CREATED', 'STATE_PROPOSAL_UPDATED', 'STATE_PROPOSAL');
CREATE TRIGGER trg_project_activity_plan
    AFTER INSERT OR UPDATE ON project_plan
    FOR EACH ROW EXECUTE FUNCTION record_direct_project_activity('PLAN_CREATED', 'PLAN_UPDATED', 'PLAN');
CREATE TRIGGER trg_project_activity_plan_proposal
    AFTER INSERT OR UPDATE ON plan_proposal
    FOR EACH ROW EXECUTE FUNCTION record_direct_project_activity('PLAN_PROPOSAL_CREATED', 'PLAN_PROPOSAL_UPDATED', 'PLAN_PROPOSAL');
CREATE TRIGGER trg_project_activity_plan_execution
    AFTER INSERT OR UPDATE ON plan_execution_state
    FOR EACH ROW EXECUTE FUNCTION record_plan_execution_activity();
CREATE TRIGGER trg_project_activity_brain_thread
    AFTER INSERT OR UPDATE ON brain_thread
    FOR EACH ROW EXECUTE FUNCTION record_brain_activity();
CREATE TRIGGER trg_project_activity_brain_run
    AFTER INSERT OR UPDATE ON brain_run
    FOR EACH ROW EXECUTE FUNCTION record_brain_activity();
CREATE TRIGGER trg_project_activity_brain_message
    AFTER INSERT ON brain_message
    FOR EACH ROW EXECUTE FUNCTION record_brain_activity();
CREATE TRIGGER trg_project_activity_work_order
    AFTER INSERT ON work_order
    FOR EACH ROW EXECUTE FUNCTION record_work_order_activity();
CREATE TRIGGER trg_project_activity_work_order_execution
    AFTER INSERT OR UPDATE ON work_order_execution
    FOR EACH ROW EXECUTE FUNCTION record_work_order_activity();
CREATE TRIGGER trg_project_activity_execution_report
    AFTER INSERT ON execution_report
    FOR EACH ROW EXECUTE FUNCTION record_work_order_activity();
CREATE TRIGGER trg_project_activity_execution_verification
    AFTER INSERT ON execution_verification
    FOR EACH ROW EXECUTE FUNCTION record_work_order_activity();

INSERT INTO project_activity_event (project_id, change_type, resource_type, resource_id)
SELECT id, 'PROJECT_SNAPSHOT_INVALIDATED', 'PROJECT', id::TEXT
FROM project;
