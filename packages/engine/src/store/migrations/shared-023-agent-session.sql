ALTER TABLE catalog_nodes ADD COLUMN agent_session TEXT CHECK (agent_session IN ('job', 'node', 'new'));
UPDATE catalog_nodes SET agent_session = CASE agent_context WHEN 'shared' THEN 'job' WHEN 'isolated' THEN 'new' END;
ALTER TABLE catalog_nodes DROP COLUMN agent_context;

ALTER TABLE catalog_recipe_steps ADD COLUMN agent_session TEXT CHECK (agent_session IN ('job', 'node', 'new'));
UPDATE catalog_recipe_steps SET agent_session = CASE agent_context WHEN 'shared' THEN 'job' WHEN 'isolated' THEN 'new' END;
ALTER TABLE catalog_recipe_steps DROP COLUMN agent_context;
