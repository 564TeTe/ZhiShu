ALTER TABLE integration_execution_run
    ADD COLUMN policy_preset TEXT CHECK (policy_preset IS NULL OR policy_preset IN ('NPM', 'MAVEN')),
    ADD COLUMN build_command_summary TEXT,
    ADD COLUMN test_command_summary TEXT,
    ADD CONSTRAINT chk_integration_policy_snapshot CHECK (
        (policy_preset IS NULL AND build_command_summary IS NULL AND test_command_summary IS NULL)
        OR
        (policy_preset IS NOT NULL
            AND build_command_summary IS NOT NULL AND btrim(build_command_summary) <> ''
            AND test_command_summary IS NOT NULL AND btrim(test_command_summary) <> '')
    );

COMMENT ON COLUMN integration_execution_run.policy_preset IS
    'Frozen server-owned project Integration preset; clients never supply command argv.';
