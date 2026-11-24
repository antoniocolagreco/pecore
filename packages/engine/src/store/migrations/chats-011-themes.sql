CREATE TABLE themes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
) STRICT;

CREATE TABLE theme_tokens (
  theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  color TEXT NOT NULL,
  PRIMARY KEY (theme_id, token)
) STRICT;
