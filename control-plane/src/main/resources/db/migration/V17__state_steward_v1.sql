CREATE UNIQUE INDEX uq_state_steward_report_proposal
    ON project_state_proposal(project_id, source_type, source_id)
    WHERE proposal_type = 'STATE_CHANGE' AND source_type = 'EXECUTION_REPORT';

COMMENT ON INDEX uq_state_steward_report_proposal IS
    'One State Change Proposal per verified Execution Report; replays return the original audit record.';
