ALTER TABLE catalog_nodes ADD COLUMN next_kind TEXT NOT NULL DEFAULT 'command' CHECK (next_kind IN ('command', 'agent', 'human', 'tracker', 'repository'));
ALTER TABLE catalog_nodes ADD COLUMN repository_account TEXT;
ALTER TABLE catalog_nodes ADD COLUMN repository_script TEXT;

UPDATE catalog_nodes SET next_kind = kind;
UPDATE catalog_nodes SET
  next_kind = 'repository',
  changes_files = 0,
  repository_account = coalesce(
    (SELECT value FROM catalog_node_lists WHERE node = catalog_nodes.name AND field = 'credentials' ORDER BY position LIMIT 1),
    'project.account'
  ),
  repository_script = (SELECT body FROM catalog_node_content WHERE name = (
    SELECT script FROM catalog_commands WHERE node = catalog_nodes.name AND action = 'command'
  ))
WHERE kind = 'command' AND runs_as = 'engine';

UPDATE catalog_commands SET script = NULL
WHERE action = 'command' AND node IN (SELECT name FROM catalog_nodes WHERE repository_script IS NOT NULL);
DELETE FROM catalog_commands WHERE action <> 'command' AND node IN (SELECT name FROM catalog_nodes WHERE next_kind = 'command');
DELETE FROM catalog_node_lists WHERE field = 'credentials';
ALTER TABLE catalog_nodes DROP COLUMN runs_as;
ALTER TABLE catalog_nodes DROP COLUMN kind;
ALTER TABLE catalog_nodes RENAME COLUMN next_kind TO kind;
