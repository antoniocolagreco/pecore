UPDATE catalog_node_lists AS entry SET value = renames.new
FROM outcome_renames AS renames
WHERE entry.field IN ('outcomes', 'failOutcomes') AND entry.node = renames.node AND entry.value = renames.old;

UPDATE catalog_node_outputs AS entry SET outcome = renames.new
FROM outcome_renames AS renames
WHERE entry.node = renames.node AND entry.outcome = renames.old;

UPDATE catalog_outcome_rules AS entry SET outcome = renames.new
FROM outcome_renames AS renames
WHERE entry.node = renames.node AND entry.outcome = renames.old;

UPDATE catalog_output_rules AS entry SET output = renames.new
FROM outcome_renames AS renames
WHERE entry.action = 'command' AND entry.node = renames.node AND entry.output = renames.old;

DROP TABLE outcome_renames;
