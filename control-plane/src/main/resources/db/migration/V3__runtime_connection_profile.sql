ALTER TABLE agent_profile
    ADD COLUMN IF NOT EXISTS connection_ref TEXT;

CREATE INDEX IF NOT EXISTS idx_agent_profile_connection_ref
    ON agent_profile(connection_ref);
