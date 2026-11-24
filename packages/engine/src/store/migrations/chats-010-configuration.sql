CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  user_name TEXT,
  job_limit INTEGER,
  agent_limit INTEGER NOT NULL,
  services_runtime TEXT,
  min_free_disk_gb REAL NOT NULL,
  merge_check_sec INTEGER NOT NULL,
  projects_folder TEXT NOT NULL,
  protected_mode INTEGER NOT NULL CHECK (protected_mode IN (0, 1)),
  assistant_profile TEXT,
  assistant_compaction_auto INTEGER NOT NULL,
  assistant_compaction_max INTEGER NOT NULL,
  pm_profile TEXT,
  pm_compaction_auto INTEGER NOT NULL,
  pm_compaction_max INTEGER NOT NULL
) STRICT;

CREATE TABLE assistant_traits (
  position INTEGER PRIMARY KEY,
  trait TEXT NOT NULL UNIQUE
) STRICT;

CREATE TABLE harness_colors (
  harness TEXT PRIMARY KEY,
  color TEXT NOT NULL
) STRICT;

CREATE TABLE ui_preferences (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL CHECK (json_valid(value))
) STRICT;

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  position INTEGER NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('model', 'forge', 'service')),
  provider TEXT,
  connector TEXT,
  login TEXT,
  email TEXT,
  max_parallel INTEGER,
  forge TEXT,
  host TEXT,
  tool TEXT,
  user TEXT,
  author_name TEXT,
  author_email TEXT,
  service TEXT
) STRICT;

CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  position INTEGER NOT NULL UNIQUE,
  account TEXT NOT NULL,
  model TEXT NOT NULL,
  effort TEXT
) STRICT;

CREATE TABLE tier_profiles (
  tier TEXT NOT NULL,
  position INTEGER NOT NULL,
  profile TEXT NOT NULL,
  PRIMARY KEY (tier, position)
) STRICT;

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  position INTEGER NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('assistant', 'pm', 'agent')),
  name TEXT NOT NULL,
  account TEXT,
  model TEXT,
  effort TEXT,
  compaction_auto INTEGER NOT NULL,
  compaction_max INTEGER NOT NULL,
  color TEXT,
  has_color INTEGER NOT NULL CHECK (has_color IN (0, 1))
) STRICT;

CREATE TABLE agent_traits (
  agent TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  trait TEXT NOT NULL,
  PRIMARY KEY (agent, position),
  UNIQUE (agent, trait)
) STRICT;

CREATE TABLE auto_setup_profiles (
  id TEXT PRIMARY KEY,
  position INTEGER NOT NULL UNIQUE,
  account TEXT NOT NULL,
  model TEXT NOT NULL,
  effort TEXT
) STRICT;
