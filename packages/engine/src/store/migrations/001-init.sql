CREATE TABLE events (
  id TEXT PRIMARY KEY,
  job_id TEXT,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX events_job ON events (job_id);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  recipe TEXT NOT NULL,
  state TEXT NOT NULL,
  waiting_reason TEXT,
  failure_reason TEXT,
  parent_job_id TEXT,
  base_branch TEXT NOT NULL,
  base TEXT,
  old_base TEXT,
  target TEXT NOT NULL,
  branch TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  merged_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX jobs_state ON jobs (state);
CREATE INDEX jobs_parent ON jobs (parent_job_id);

CREATE TABLE node_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  node TEXT NOT NULL,
  round INTEGER NOT NULL,
  via_edge INTEGER,
  state TEXT NOT NULL,
  outcome TEXT,
  waiting_reason TEXT,
  reset_at INTEGER,
  queue_item_id TEXT,
  auth_account TEXT,
  auth_os_user TEXT,
  auth_kind TEXT,
  failure_reason TEXT,
  content_before TEXT,
  content_after TEXT,
  git_before TEXT,
  pgid INTEGER,
  os_user TEXT,
  started_at INTEGER,
  ended_at INTEGER
);
CREATE INDEX node_runs_job ON node_runs (job_id);

CREATE TABLE attempts (
  id TEXT PRIMARY KEY,
  node_run_id TEXT NOT NULL,
  profile TEXT,
  connector TEXT,
  harness_version TEXT,
  connector_version TEXT,
  model TEXT,
  account TEXT,
  os_user TEXT NOT NULL,
  session_group TEXT,
  session_id TEXT,
  resumed INTEGER,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cache_read INTEGER NOT NULL DEFAULT 0,
  cache_write INTEGER NOT NULL DEFAULT 0,
  cost REAL,
  end_reason TEXT,
  log_path TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);
CREATE INDEX attempts_node_run ON attempts (node_run_id);

CREATE TABLE human_queue (
  id TEXT PRIMARY KEY,
  job_id TEXT,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  subject_hash TEXT NOT NULL,
  state TEXT NOT NULL,
  choices TEXT NOT NULL,
  choice TEXT,
  note TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX human_queue_state ON human_queue (state);

CREATE TABLE confirmed_hashes (
  path TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL,
  confirmed_at INTEGER NOT NULL
);

CREATE TABLE tickets_seen (
  source TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  seen_at INTEGER NOT NULL,
  PRIMARY KEY (source, ticket_id)
);

CREATE TABLE usage_daily (
  day TEXT NOT NULL,
  account TEXT NOT NULL,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cache_read INTEGER NOT NULL DEFAULT 0,
  cache_write INTEGER NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (day, account)
);

CREATE TABLE schema_version (
  version INTEGER NOT NULL
);
