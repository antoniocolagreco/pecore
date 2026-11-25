ALTER TABLE attempts DROP COLUMN session_group;
ALTER TABLE attempts ADD COLUMN agent_id TEXT;
ALTER TABLE attempts ADD COLUMN agent_context TEXT CHECK (agent_context IN ('shared', 'isolated'));
