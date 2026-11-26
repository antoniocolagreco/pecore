ALTER TABLE catalog_nodes ADD COLUMN agent_tracker_access TEXT CHECK (agent_tracker_access IN ('read', 'read-write'));
ALTER TABLE catalog_nodes ADD COLUMN agent_tracker_account TEXT;
