DELETE FROM catalog_recipe_edges WHERE outcome = 'skipped' AND EXISTS (
  SELECT 1 FROM catalog_recipe_steps WHERE recipe = catalog_recipe_edges.recipe AND step = catalog_recipe_edges.source AND optional = 1
);
DELETE FROM catalog_recipe_lists WHERE field = 'successOutcomes' AND EXISTS (
  SELECT 1 FROM catalog_recipe_steps WHERE recipe = catalog_recipe_lists.recipe AND value = step || ':skipped' AND optional = 1
);
DELETE FROM catalog_step_lists WHERE field = 'reads' AND value = '@start';
ALTER TABLE catalog_recipe_steps DROP COLUMN optional;

UPDATE catalog_node_outputs SET type = CASE
  WHEN type = 'text' AND (SELECT kind FROM catalog_nodes WHERE name = node) IN ('command', 'repository') THEN 'log'
  WHEN type = 'text' AND (SELECT human_interface FROM catalog_nodes WHERE name = node) = 'code-review' THEN 'code_review'
  WHEN type = 'text' THEN 'feedback'
  WHEN type = 'findings' AND node = 'approver' THEN 'code_analysis'
  WHEN type = 'findings' THEN 'code_review'
  WHEN type = 'document' AND node = 'write-pr' THEN 'pull_request'
  WHEN type = 'reference' AND node = 'git-commit' THEN 'sha'
  ELSE type END;
UPDATE catalog_node_lists SET value = 'log' WHERE field IN ('inputs', 'optionalInputs') AND value = 'text';
