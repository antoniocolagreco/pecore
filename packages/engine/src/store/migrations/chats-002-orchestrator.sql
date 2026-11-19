ALTER TABLE chats ADD COLUMN session_id TEXT;
ALTER TABLE chats ADD COLUMN session_key TEXT;
ALTER TABLE chats ADD COLUMN intake_project TEXT;
ALTER TABLE chats ADD COLUMN last_read_message_id TEXT;
CREATE UNIQUE INDEX chats_intake_project ON chats(intake_project) WHERE intake_project IS NOT NULL;

ALTER TABLE messages ADD COLUMN state TEXT NOT NULL DEFAULT 'completed';
ALTER TABLE messages ADD COLUMN error TEXT;
ALTER TABLE messages ADD COLUMN order_id TEXT;
ALTER TABLE messages ADD COLUMN order_project TEXT;

ALTER TABLE attachments RENAME TO old_attachments;
CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id),
  message_id TEXT REFERENCES messages(id),
  path TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0
);
INSERT INTO attachments (id, chat_id, message_id, path, mime)
SELECT a.id, m.chat_id, a.message_id, a.path, a.mime FROM old_attachments a JOIN messages m ON m.id = a.message_id;
DROP TABLE old_attachments;
CREATE INDEX attachments_chat ON attachments(chat_id);
CREATE INDEX attachments_message ON attachments(message_id);
CREATE INDEX actions_message ON actions(message_id);
