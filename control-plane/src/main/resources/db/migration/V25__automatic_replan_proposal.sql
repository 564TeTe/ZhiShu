ALTER TABLE plan_proposal
    ADD COLUMN trigger_type TEXT,
    ADD COLUMN trigger_id UUID,
    ADD COLUMN trigger_fingerprint TEXT;

CREATE UNIQUE INDEX uq_plan_proposal_trigger
    ON plan_proposal(project_id, trigger_type, trigger_id)
    WHERE trigger_type IS NOT NULL AND trigger_id IS NOT NULL;

ALTER TABLE integration_execution_run
    ADD CONSTRAINT fk_integration_run_replan_proposal
    FOREIGN KEY (replan_proposal_id) REFERENCES plan_proposal(id) ON DELETE RESTRICT;

COMMENT ON COLUMN plan_proposal.trigger_type IS
    'System trigger for proposal-only automatic replanning; it never publishes a Plan Version.';
COMMENT ON COLUMN plan_proposal.trigger_fingerprint IS
    'Deterministic source and baseline fingerprint used to audit automatic Replan deduplication.';
