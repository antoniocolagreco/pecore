CREATE TABLE chats (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  last_read_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  context TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX messages_chat ON messages (chat_id);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  path TEXT NOT NULL,
  mime TEXT NOT NULL
);

CREATE TABLE actions (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  target TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  target TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE schema_version (
  version INTEGER NOT NULL
);
