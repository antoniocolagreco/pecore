CREATE TABLE artifacts (
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  run TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  content_state TEXT,
  content BLOB NOT NULL,
  PRIMARY KEY (job_id, run, name, type)
);
