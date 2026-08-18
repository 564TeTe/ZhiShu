CREATE TABLE integration_gate_proposal (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
    plan_id UUID NOT NULL REFERENCES project_plan(id) ON DELETE RESTRICT,
    plan_version_id UUID NOT NULL REFERENCES plan_version(id) ON DELETE RESTRICT,
    schedule_id UUID NOT NULL REFERENCES parallel_schedule_proposal(id) ON DELETE RESTRICT,
    schema_version TEXT NOT NULL DEFAULT '1.0' CHECK (schema_version = '1.0'),
    status TEXT NOT NULL CHECK (status IN ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'STALE')),
    gate_mode TEXT NOT NULL DEFAULT 'EVIDENCE_ONLY' CHECK (gate_mode = 'EVIDENCE_ONLY'),
    apply_state TEXT NOT NULL DEFAULT 'NOT_ATTEMPTED' CHECK (apply_state = 'NOT_ATTEMPTED'),
    evidence_status TEXT NOT NULL CHECK (evidence_status IN ('MISSING', 'PRESENT')),
    base_state_revision BIGINT NOT NULL CHECK (base_state_revision >= 0),
    base_plan_version BIGINT NOT NULL CHECK (base_plan_version >= 1),
    proposal_payload JSONB NOT NULL,
    conflict_assessment JSONB NOT NULL,
    client_request_id TEXT NOT NULL CHECK (btrim(client_request_id) <> ''),
    request_hash TEXT NOT NULL CHECK (btrim(request_hash) <> ''),
    created_by TEXT NOT NULL CHECK (btrim(created_by) <> ''),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_by TEXT,
    decided_at TIMESTAMPTZ,
    decision_request_id TEXT,
    decision_hash TEXT,
    decision_reason TEXT,
    UNIQUE (project_id, created_by, client_request_id)
);

CREATE TABLE integration_gate_evidence (
    gate_id UUID NOT NULL REFERENCES integration_gate_proposal(id) ON DELETE RESTRICT,
    evidence_reference_id UUID NOT NULL REFERENCES evidence_reference(id) ON DELETE RESTRICT,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    PRIMARY KEY (gate_id, evidence_reference_id),
    UNIQUE (gate_id, ordinal)
);

CREATE TABLE integration_gate_event (
    id BIGSERIAL PRIMARY KEY,
    gate_id UUID NOT NULL REFERENCES integration_gate_proposal(id) ON DELETE RESTRICT,
    event_type TEXT NOT NULL CHECK (btrim(event_type) <> ''),
    actor TEXT NOT NULL CHECK (btrim(actor) <> ''),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_integration_gate_active_schedule
    ON integration_gate_proposal(project_id, schedule_id)
    WHERE status IN ('PENDING_APPROVAL', 'APPROVED');
CREATE UNIQUE INDEX uq_integration_gate_decision_request
    ON integration_gate_proposal(project_id, decided_by, decision_request_id)
    WHERE decision_request_id IS NOT NULL;
CREATE INDEX idx_integration_gate_project_plan
    ON integration_gate_proposal(project_id, plan_id, created_at DESC);
CREATE INDEX idx_integration_gate_event_gate
    ON integration_gate_event(gate_id, id);

COMMENT ON TABLE integration_gate_proposal IS
    'Proposal-first Integration Gate review. EVIDENCE_ONLY and NOT_ATTEMPTED never claim merge/apply execution.';
COMMENT ON COLUMN integration_gate_proposal.proposal_payload IS
    'Untrusted candidate integration summary derived from the approved Parallel Schedule and evidence references.';
COMMENT ON COLUMN integration_gate_proposal.conflict_assessment IS
    'Precheck result only; it is not proof that files were merged or tests were run.';

CREATE FUNCTION reject_integration_gate_evidence_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Integration Gate evidence and events are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_integration_gate_evidence_immutable
    BEFORE UPDATE OR DELETE ON integration_gate_evidence
    FOR EACH ROW EXECUTE FUNCTION reject_integration_gate_evidence_mutation();
CREATE TRIGGER trg_integration_gate_event_immutable
    BEFORE UPDATE OR DELETE ON integration_gate_event
    FOR EACH ROW EXECUTE FUNCTION reject_integration_gate_evidence_mutation();
