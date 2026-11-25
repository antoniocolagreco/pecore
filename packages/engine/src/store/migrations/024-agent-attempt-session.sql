ALTER TABLE attempts ADD COLUMN agent_session TEXT CHECK (agent_session IN ('job', 'node', 'new'));
UPDATE attempts SET agent_session = CASE agent_context WHEN 'shared' THEN 'job' WHEN 'isolated' THEN 'new' END;
ALTER TABLE attempts DROP COLUMN agent_context;

UPDATE events
SET payload = json_remove(json_set(payload, '$.agentSession',
  CASE json_extract(payload, '$.agentContext') WHEN 'shared' THEN 'job' WHEN 'isolated' THEN 'new' END), '$.agentContext')
WHERE type = 'attempt.started' AND json_extract(payload, '$.agentContext') IN ('shared', 'isolated');
