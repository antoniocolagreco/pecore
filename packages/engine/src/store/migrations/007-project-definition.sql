CREATE TABLE project_definition (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  repo_url TEXT,
  repo_account TEXT,
  folder TEXT,
  base_branch TEXT NOT NULL,
  create_repo TEXT,
  services TEXT,
  pm_name TEXT,
  pm_color TEXT,
  pm_agent_id TEXT,
  source_node TEXT,
  source_account TEXT,
  uses_templates INTEGER NOT NULL CHECK (uses_templates IN (0, 1)),
  has_variables INTEGER NOT NULL CHECK (has_variables IN (0, 1)),
  has_credentials INTEGER NOT NULL CHECK (has_credentials IN (0, 1)),
  has_recipe_knowledge INTEGER NOT NULL CHECK (has_recipe_knowledge IN (0, 1))
) STRICT;

CREATE TABLE project_recipes (
  position INTEGER PRIMARY KEY,
  name TEXT NOT NULL
) STRICT;

CREATE TABLE project_variables (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL CHECK (json_valid(value))
) STRICT;

CREATE TABLE project_source_params (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL CHECK (json_valid(value))
) STRICT;

CREATE TABLE project_credentials (
  name TEXT PRIMARY KEY,
  account TEXT NOT NULL
) STRICT;

CREATE TABLE project_knowledge_recipes (
  recipe TEXT PRIMARY KEY
) STRICT;

CREATE TABLE project_knowledge_steps (
  recipe TEXT NOT NULL REFERENCES project_knowledge_recipes(recipe) ON DELETE CASCADE,
  step TEXT NOT NULL,
  PRIMARY KEY (recipe, step)
) STRICT;

CREATE TABLE project_knowledge_reads (
  recipe TEXT NOT NULL,
  step TEXT NOT NULL,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (recipe, step, position),
  FOREIGN KEY (recipe, step) REFERENCES project_knowledge_steps(recipe, step) ON DELETE CASCADE
) STRICT;

CREATE TABLE project_creation (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  step INTEGER NOT NULL CHECK (step IN (1, 3, 4, 5, 6))
) STRICT;
