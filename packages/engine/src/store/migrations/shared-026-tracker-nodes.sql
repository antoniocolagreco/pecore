ALTER TABLE catalog_nodes ADD COLUMN next_kind TEXT NOT NULL DEFAULT 'command' CHECK (next_kind IN ('command', 'agent', 'human', 'tracker'));
ALTER TABLE catalog_nodes ADD COLUMN tracker_provider TEXT;
ALTER TABLE catalog_nodes ADD COLUMN tracker_account TEXT;
ALTER TABLE catalog_nodes ADD COLUMN tracker_script TEXT;
ALTER TABLE catalog_nodes ADD COLUMN tracker_repeat_check INTEGER;

DELETE FROM catalog_nodes WHERE kind = 'source';

UPDATE catalog_nodes SET
  next_kind = 'tracker',
  tracker_provider = CASE name WHEN 'github-issue-comment' THEN 'github' ELSE 'gitlab' END,
  tracker_account = coalesce(
    (SELECT nullif(value, 'project.account') FROM catalog_node_lists WHERE node = catalog_nodes.name AND field = 'credentials' ORDER BY position LIMIT 1),
    'project.account'
  ),
  tracker_script = (SELECT body FROM catalog_node_content WHERE name = (
    SELECT script FROM catalog_commands WHERE node = catalog_nodes.name AND action = 'command'
  )),
  tracker_repeat_check = EXISTS (SELECT 1 FROM catalog_commands WHERE node = catalog_nodes.name AND action = 'probe')
WHERE kind = 'command' AND name IN ('github-issue-comment', 'gitlab-issue-comment')
  AND EXISTS (SELECT 1 FROM catalog_node_content WHERE name = (
    SELECT script FROM catalog_commands WHERE node = catalog_nodes.name AND action = 'command'
  ));

UPDATE catalog_nodes SET next_kind = kind WHERE next_kind <> 'tracker';
DELETE FROM catalog_commands WHERE action = 'probe' AND node IN (SELECT name FROM catalog_nodes WHERE next_kind = 'tracker');
DELETE FROM catalog_node_lists WHERE field = 'credentials' AND node IN (SELECT name FROM catalog_nodes WHERE next_kind = 'tracker');
UPDATE catalog_commands SET script = NULL WHERE action = 'command' AND node IN (SELECT name FROM catalog_nodes WHERE next_kind = 'tracker');
ALTER TABLE catalog_nodes DROP COLUMN kind;
ALTER TABLE catalog_nodes RENAME COLUMN next_kind TO kind;
