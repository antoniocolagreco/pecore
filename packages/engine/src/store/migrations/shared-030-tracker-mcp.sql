ALTER TABLE catalog_nodes ADD COLUMN tracker_server TEXT;
ALTER TABLE catalog_nodes ADD COLUMN tracker_tool TEXT;

CREATE TABLE catalog_tracker_arguments (
  node TEXT NOT NULL REFERENCES catalog_nodes(name) ON DELETE CASCADE,
  name TEXT NOT NULL,
  value TEXT NOT NULL CHECK (json_valid(value)),
  PRIMARY KEY (node, name)
) STRICT;
