DROP TABLE assistant_traits;
DROP TABLE agent_traits;

CREATE TABLE agent_cards (
  id TEXT PRIMARY KEY,
  position INTEGER NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('pm', 'agent')),
  name TEXT NOT NULL,
  account TEXT,
  model TEXT,
  effort TEXT,
  compaction_auto INTEGER,
  compaction_max INTEGER,
  color TEXT,
  has_color INTEGER NOT NULL CHECK (has_color IN (0, 1))
) STRICT;

INSERT INTO agent_cards
SELECT a.id, a.position, CASE WHEN a.kind = 'assistant' THEN 'agent' ELSE a.kind END,
  CASE WHEN a.kind = 'assistant' THEN 'Assistant' ELSE a.name END,
  CASE WHEN a.kind <> 'pm' THEN a.account END,
  CASE WHEN a.kind <> 'pm' THEN a.model END,
  CASE WHEN a.kind <> 'pm' THEN a.effort END,
  CASE WHEN a.kind <> 'pm' THEN a.compaction_auto END,
  CASE WHEN a.kind <> 'pm' THEN a.compaction_max END,
  CASE WHEN a.kind = 'assistant' THEN '#FFFFFF' ELSE a.color END,
  CASE WHEN a.kind = 'assistant' THEN 1 ELSE a.has_color END
FROM agents a WHERE a.id <> 'pm-default';

INSERT INTO agent_cards
SELECT 'assistant', (SELECT COALESCE(MAX(position), -1) + 1 FROM agent_cards), 'agent', 'Assistant',
  p.account, p.model, p.effort, s.assistant_compaction_auto, s.assistant_compaction_max, '#FFFFFF', 1
FROM settings s LEFT JOIN profiles p ON p.id = s.assistant_profile
WHERE NOT EXISTS (SELECT 1 FROM agent_cards WHERE id = 'assistant')
  AND (s.assistant_profile IS NOT NULL OR s.assistant_compaction_auto <> 131072 OR s.assistant_compaction_max <> 262144);

DROP TABLE agents;
ALTER TABLE agent_cards RENAME TO agents;

INSERT OR IGNORE INTO agent_contexts (agent_id, markdown)
SELECT 'agent-default', markdown FROM agent_contexts WHERE agent_id = 'pm-default';
DELETE FROM agent_contexts WHERE agent_id = 'pm-default';

ALTER TABLE settings DROP COLUMN assistant_profile;
ALTER TABLE settings DROP COLUMN assistant_compaction_auto;
ALTER TABLE settings DROP COLUMN assistant_compaction_max;
ALTER TABLE settings DROP COLUMN pm_profile;
ALTER TABLE settings DROP COLUMN pm_compaction_auto;
ALTER TABLE settings DROP COLUMN pm_compaction_max;
