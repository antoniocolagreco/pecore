ALTER TABLE agents ADD COLUMN card_id TEXT;
UPDATE agents SET card_id = 'agent-default' WHERE kind = 'pm';
