ALTER TABLE integration_gate_proposal
    ADD COLUMN evidence_count INTEGER;

UPDATE integration_gate_proposal proposal
SET evidence_count = (
    SELECT count(*)
    FROM integration_gate_evidence evidence
    WHERE evidence.gate_id = proposal.id
);

ALTER TABLE integration_gate_proposal
    ALTER COLUMN evidence_count SET NOT NULL,
    ADD CONSTRAINT chk_integration_gate_evidence_manifest
        CHECK (
            (evidence_status = 'MISSING' AND evidence_count = 0)
            OR (evidence_status = 'PRESENT' AND evidence_count BETWEEN 1 AND 100)
        );

DROP TRIGGER trg_integration_gate_evidence_immutable ON integration_gate_evidence;

ALTER TABLE integration_gate_evidence
    ADD COLUMN project_id UUID,
    ADD COLUMN artifact_id UUID,
    ADD COLUMN artifact_hash TEXT,
    ADD COLUMN source_type TEXT,
    ADD COLUMN source_id UUID,
    ADD COLUMN purpose TEXT,
    ADD COLUMN reference_created_at TIMESTAMPTZ,
    ADD COLUMN captured_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE integration_gate_evidence evidence
SET project_id = source_ref.project_id,
    artifact_id = source_ref.artifact_id,
    artifact_hash = artifact.hash,
    source_type = source_ref.source_type,
    source_id = source_ref.source_id,
    purpose = source_ref.purpose,
    reference_created_at = source_ref.created_at
FROM evidence_reference source_ref
JOIN task_artifact artifact ON artifact.id = source_ref.artifact_id
WHERE source_ref.id = evidence.evidence_reference_id;

ALTER TABLE integration_gate_evidence
    ALTER COLUMN project_id SET NOT NULL,
    ALTER COLUMN artifact_id SET NOT NULL,
    ALTER COLUMN source_type SET NOT NULL,
    ALTER COLUMN source_id SET NOT NULL,
    ALTER COLUMN purpose SET NOT NULL,
    ALTER COLUMN reference_created_at SET NOT NULL,
    ADD CONSTRAINT chk_integration_gate_evidence_snapshot_text
        CHECK (
            btrim(source_type) <> ''
            AND btrim(purpose) <> ''
            AND (artifact_hash IS NULL OR btrim(artifact_hash) <> '')
        );

CREATE TRIGGER trg_integration_gate_evidence_immutable
    BEFORE UPDATE OR DELETE ON integration_gate_evidence
    FOR EACH ROW EXECUTE FUNCTION reject_integration_gate_evidence_mutation();

CREATE FUNCTION enforce_integration_gate_evidence_insert() RETURNS trigger AS $$
DECLARE
    expected_count INTEGER;
    gate_status TEXT;
    gate_project_id UUID;
BEGIN
    SELECT evidence_count, status, project_id
    INTO expected_count, gate_status, gate_project_id
    FROM integration_gate_proposal
    WHERE id = NEW.gate_id;

    IF gate_status IS DISTINCT FROM 'PENDING_APPROVAL' THEN
        RAISE EXCEPTION 'Integration Gate evidence can only be inserted while the proposal is pending';
    END IF;
    IF NEW.ordinal < 0 OR NEW.ordinal >= expected_count THEN
        RAISE EXCEPTION 'Integration Gate evidence is outside the sealed manifest';
    END IF;
    IF NEW.project_id IS DISTINCT FROM gate_project_id OR NOT EXISTS (
        SELECT 1
        FROM evidence_reference evidence_ref
        JOIN task_artifact artifact ON artifact.id = evidence_ref.artifact_id
        JOIN agent_task task ON task.id = artifact.task_id
        WHERE evidence_ref.id = NEW.evidence_reference_id
          AND evidence_ref.project_id = NEW.project_id
          AND evidence_ref.artifact_id = NEW.artifact_id
          AND artifact.hash IS NOT DISTINCT FROM NEW.artifact_hash
          AND evidence_ref.source_type = NEW.source_type
          AND evidence_ref.source_id = NEW.source_id
          AND evidence_ref.purpose = NEW.purpose
          AND evidence_ref.created_at = NEW.reference_created_at
          AND task.project_id = gate_project_id
    ) THEN
        RAISE EXCEPTION 'Integration Gate evidence snapshot does not match its source';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_integration_gate_evidence_insert
    BEFORE INSERT ON integration_gate_evidence
    FOR EACH ROW EXECUTE FUNCTION enforce_integration_gate_evidence_insert();

CREATE FUNCTION enforce_integration_gate_proposal_transition() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Integration Gate proposals are immutable';
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.project_id IS DISTINCT FROM OLD.project_id
        OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
        OR NEW.plan_version_id IS DISTINCT FROM OLD.plan_version_id
        OR NEW.schedule_id IS DISTINCT FROM OLD.schedule_id
        OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
        OR NEW.gate_mode IS DISTINCT FROM OLD.gate_mode
        OR NEW.apply_state IS DISTINCT FROM OLD.apply_state
        OR NEW.evidence_status IS DISTINCT FROM OLD.evidence_status
        OR NEW.evidence_count IS DISTINCT FROM OLD.evidence_count
        OR NEW.base_state_revision IS DISTINCT FROM OLD.base_state_revision
        OR NEW.base_plan_version IS DISTINCT FROM OLD.base_plan_version
        OR NEW.proposal_payload IS DISTINCT FROM OLD.proposal_payload
        OR NEW.conflict_assessment IS DISTINCT FROM OLD.conflict_assessment
        OR NEW.client_request_id IS DISTINCT FROM OLD.client_request_id
        OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
        OR NEW.created_by IS DISTINCT FROM OLD.created_by
        OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'Integration Gate proposal facts are immutable';
    END IF;

    IF OLD.status <> 'PENDING_APPROVAL'
        OR NEW.status NOT IN ('APPROVED', 'REJECTED', 'STALE') THEN
        RAISE EXCEPTION 'Integration Gate status transition is not allowed';
    END IF;
    IF NEW.decided_by IS NULL OR btrim(NEW.decided_by) = '' OR NEW.decided_at IS NULL THEN
        RAISE EXCEPTION 'Integration Gate terminal status requires decision audit fields';
    END IF;
    IF NEW.status IN ('APPROVED', 'REJECTED')
        AND (NEW.decision_request_id IS NULL OR btrim(NEW.decision_request_id) = ''
             OR NEW.decision_hash IS NULL OR btrim(NEW.decision_hash) = '') THEN
        RAISE EXCEPTION 'Integration Gate user decision requires an idempotency record';
    END IF;
    IF NEW.status = 'APPROVED'
        AND (NEW.evidence_status <> 'PRESENT' OR NEW.evidence_count < 1) THEN
        RAISE EXCEPTION 'Integration Gate approval requires sealed evidence';
    END IF;
    IF NEW.status IN ('REJECTED', 'STALE')
        AND (NEW.decision_reason IS NULL OR btrim(NEW.decision_reason) = '') THEN
        RAISE EXCEPTION 'Integration Gate rejection or stale transition requires a reason';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_integration_gate_proposal_transition
    BEFORE UPDATE OR DELETE ON integration_gate_proposal
    FOR EACH ROW EXECUTE FUNCTION enforce_integration_gate_proposal_transition();

COMMENT ON COLUMN integration_gate_proposal.evidence_count IS
    'Expected immutable Evidence snapshot count. Ordinals outside this sealed manifest are rejected.';
COMMENT ON COLUMN integration_gate_evidence.artifact_hash IS
    'Artifact hash captured when the Gate was proposed. Null records that the source artifact supplied no hash.';
COMMENT ON COLUMN integration_gate_evidence.captured_at IS
    'Time when the Evidence Reference and Artifact identity were copied into this immutable Gate snapshot.';
