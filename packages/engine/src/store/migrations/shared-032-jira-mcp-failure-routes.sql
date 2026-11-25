WITH missing AS (
  SELECT step.recipe, step.step,
    row_number() OVER (PARTITION BY step.recipe ORDER BY step.position) AS offset
  FROM catalog_recipe_steps step
  JOIN catalog_recipes recipe ON recipe.name = step.recipe
  JOIN catalog_nodes node ON node.name = step.node
  WHERE recipe.has_ends = 1 AND node.shipped = 1
    AND node.name IN ('jira-mcp-ticket-read', 'jira-mcp-ticket-search', 'jira-mcp-issue-comment')
    AND NOT EXISTS (
      SELECT 1 FROM catalog_recipe_edges edge
      WHERE edge.recipe = step.recipe AND edge.source = step.step AND edge.outcome = 'failure'
    )
)
INSERT INTO catalog_recipe_edges (recipe, position, source, outcome, result)
SELECT missing.recipe,
  coalesce((SELECT max(edge.position) FROM catalog_recipe_edges edge WHERE edge.recipe = missing.recipe), -1) + missing.offset,
  missing.step, 'failure', 'failed'
FROM missing;
