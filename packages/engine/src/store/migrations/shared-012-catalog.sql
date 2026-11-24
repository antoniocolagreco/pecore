CREATE TABLE catalog_version (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  format TEXT NOT NULL
) STRICT;

CREATE TABLE catalog_nodes (
  name TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  icon TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('command', 'agent', 'human', 'source')),
  shipped INTEGER NOT NULL CHECK (shipped IN (0, 1)),
  timeout_sec INTEGER,
  changes_files INTEGER,
  retry INTEGER,
  prompt TEXT,
  tier TEXT,
  resume INTEGER,
  human_interface TEXT,
  runs_as TEXT,
  clean_checkout INTEGER
) STRICT;

CREATE TABLE catalog_node_lists (
  node TEXT NOT NULL REFERENCES catalog_nodes(name) ON DELETE CASCADE,
  field TEXT NOT NULL,
  position INTEGER NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (node, field, position)
) STRICT;

CREATE TABLE catalog_node_params (
  node TEXT NOT NULL REFERENCES catalog_nodes(name) ON DELETE CASCADE,
  name TEXT NOT NULL,
  value TEXT NOT NULL CHECK (json_valid(value)),
  PRIMARY KEY (node, name)
) STRICT;

CREATE TABLE catalog_node_outputs (
  node TEXT NOT NULL REFERENCES catalog_nodes(name) ON DELETE CASCADE,
  outcome TEXT NOT NULL,
  type TEXT NOT NULL,
  PRIMARY KEY (node, outcome)
) STRICT;

CREATE TABLE catalog_commands (
  node TEXT NOT NULL REFERENCES catalog_nodes(name) ON DELETE CASCADE,
  action TEXT NOT NULL,
  script TEXT,
  rule_field TEXT,
  PRIMARY KEY (node, action)
) STRICT;

CREATE TABLE catalog_command_args (
  node TEXT NOT NULL,
  action TEXT NOT NULL,
  position INTEGER NOT NULL,
  argument TEXT NOT NULL,
  PRIMARY KEY (node, action, position),
  FOREIGN KEY (node, action) REFERENCES catalog_commands(node, action) ON DELETE CASCADE
) STRICT;

CREATE TABLE catalog_probe_values (
  node TEXT NOT NULL,
  action TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('done', 'notDone')),
  position INTEGER NOT NULL,
  value TEXT NOT NULL CHECK (json_valid(value)),
  PRIMARY KEY (node, action, result, position),
  FOREIGN KEY (node, action) REFERENCES catalog_commands(node, action) ON DELETE CASCADE
) STRICT;

CREATE TABLE catalog_outcome_rules (
  node TEXT NOT NULL REFERENCES catalog_nodes(name) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  exit_code INTEGER,
  json_field TEXT,
  json_value TEXT CHECK (json_valid(json_value)),
  PRIMARY KEY (node, position)
) STRICT;

CREATE TABLE catalog_output_rules (
  node TEXT NOT NULL,
  action TEXT NOT NULL,
  output TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('file', 'stdoutJson', 'stdoutLastLine')),
  target TEXT NOT NULL,
  PRIMARY KEY (node, action, output),
  FOREIGN KEY (node, action) REFERENCES catalog_commands(node, action) ON DELETE CASCADE
) STRICT;

CREATE TABLE catalog_node_content (
  name TEXT PRIMARY KEY,
  language TEXT NOT NULL CHECK (language IN ('markdown', 'shell')),
  body TEXT NOT NULL,
  shipped INTEGER NOT NULL CHECK (shipped IN (0, 1))
) STRICT;

CREATE TABLE catalog_icons (
  name TEXT PRIMARY KEY,
  svg TEXT NOT NULL,
  shipped INTEGER NOT NULL CHECK (shipped IN (0, 1))
) STRICT;

CREATE TABLE catalog_recipes (
  name TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  icon TEXT,
  shipped INTEGER NOT NULL CHECK (shipped IN (0, 1)),
  start TEXT,
  has_start_ports INTEGER NOT NULL,
  start_source_port TEXT,
  start_target_port TEXT,
  on_base_changed TEXT,
  max_node_runs INTEGER NOT NULL,
  has_ends INTEGER NOT NULL,
  has_layout INTEGER NOT NULL,
  ci_after TEXT,
  ci_on TEXT,
  ci_interval_sec INTEGER,
  ci_timeout_sec INTEGER,
  ci_max_corrections INTEGER
) STRICT;

CREATE TABLE catalog_recipe_lists (
  recipe TEXT NOT NULL REFERENCES catalog_recipes(name) ON DELETE CASCADE,
  field TEXT NOT NULL,
  position INTEGER NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (recipe, field, position)
) STRICT;

CREATE TABLE catalog_recipe_steps (
  recipe TEXT NOT NULL REFERENCES catalog_recipes(name) ON DELETE CASCADE,
  step TEXT NOT NULL,
  position INTEGER NOT NULL,
  node TEXT NOT NULL,
  optional INTEGER NOT NULL,
  session TEXT,
  skip_when_unchanged INTEGER NOT NULL,
  has_params INTEGER NOT NULL,
  has_agent INTEGER NOT NULL,
  tier TEXT,
  has_provider_not INTEGER NOT NULL,
  PRIMARY KEY (recipe, step)
) STRICT;

CREATE TABLE catalog_step_params (
  recipe TEXT NOT NULL,
  step TEXT NOT NULL,
  name TEXT NOT NULL,
  value TEXT NOT NULL CHECK (json_valid(value)),
  PRIMARY KEY (recipe, step, name),
  FOREIGN KEY (recipe, step) REFERENCES catalog_recipe_steps(recipe, step) ON DELETE CASCADE
) STRICT;

CREATE TABLE catalog_step_lists (
  recipe TEXT NOT NULL,
  step TEXT NOT NULL,
  field TEXT NOT NULL,
  position INTEGER NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (recipe, step, field, position),
  FOREIGN KEY (recipe, step) REFERENCES catalog_recipe_steps(recipe, step) ON DELETE CASCADE
) STRICT;

CREATE TABLE catalog_recipe_edges (
  recipe TEXT NOT NULL REFERENCES catalog_recipes(name) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  source TEXT NOT NULL,
  outcome TEXT NOT NULL,
  target TEXT,
  result TEXT,
  max_rounds INTEGER,
  source_port TEXT,
  target_port TEXT,
  PRIMARY KEY (recipe, position)
) STRICT;

CREATE TABLE catalog_recipe_layout (
  recipe TEXT NOT NULL REFERENCES catalog_recipes(name) ON DELETE CASCADE,
  step TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  PRIMARY KEY (recipe, step)
) STRICT;
