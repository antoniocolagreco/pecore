ALTER TABLE attempts DROP COLUMN log_path;
ALTER TABLE attempts ADD COLUMN log_omitted INTEGER NOT NULL DEFAULT 0 CHECK (log_omitted IN (0, 1));
UPDATE attempts SET log_omitted = 1;

CREATE TABLE attempt_logs (
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out', 'err', 'cmd')),
  at INTEGER NOT NULL,
  payload TEXT NOT NULL CHECK (direction IN ('err', 'cmd') OR json_valid(payload)),
  PRIMARY KEY (attempt_id, sequence)
) STRICT;
