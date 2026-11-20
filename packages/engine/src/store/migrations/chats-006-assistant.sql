DROP TABLE IF EXISTS actions;
DROP TABLE IF EXISTS attachments;
DROP TABLE IF EXISTS old_attachments;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS chats;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS schema_version;

CREATE TABLE schema_version (
  version INTEGER NOT NULL
);

CREATE TABLE chats (
  id TEXT PRIMARY KEY,
  project TEXT UNIQUE,
  session_id TEXT,
  session_key TEXT,
  context_tokens INTEGER,
  last_read_message_id TEXT
);
INSERT INTO chats (id) VALUES ('assistant');

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  text TEXT NOT NULL,
  context TEXT NOT NULL,
  state TEXT NOT NULL,
  error TEXT,
  order_id TEXT,
  order_project TEXT,
  reply_to TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX messages_chat ON messages(chat_id);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL
);
CREATE INDEX attachments_chat ON attachments(chat_id);
CREATE INDEX attachments_message ON attachments(message_id);

CREATE TABLE actions (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  tool TEXT NOT NULL,
  target TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX actions_message ON actions(message_id);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  target TEXT,
  seen INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
