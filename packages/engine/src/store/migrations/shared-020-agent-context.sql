ALTER TABLE catalog_nodes DROP COLUMN resume;
ALTER TABLE catalog_nodes ADD COLUMN agent_context TEXT CHECK (agent_context IN ('shared', 'isolated'));
UPDATE catalog_nodes SET agent_context = 'shared' WHERE kind = 'agent';

ALTER TABLE catalog_recipe_steps DROP COLUMN session;
ALTER TABLE catalog_recipe_steps ADD COLUMN agent_context TEXT CHECK (agent_context IN ('shared', 'isolated'));
ALTER TABLE catalog_recipe_steps ADD COLUMN agent_id TEXT;
