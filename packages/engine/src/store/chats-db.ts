import Database from "better-sqlite3";
import { monotonicFactory } from "ulid";
import type { ChatActionView, ChatAttachmentView, ChatMessageView, ChatReference, ChatView } from "@pecore/schemas";
import { migrate } from "./migrate";

const ulid = monotonicFactory();

export const notificationsKept = 500;

export type Notification = { id: string; kind: string; title: string; body: string; target: string | null; createdAt: number };

export type ChatSession = { id: string; sessionId: string | null; sessionKey: string | null };
export type ChatTurn = ChatMessageView & { orderId: string; orderProject: string | null };
export type ChatAttachment = ChatAttachmentView & { path: string };
type MessageRow = Omit<ChatTurn, "context"> & { context: string | null };
type ActionRow = Omit<ChatActionView, "target"> & { target: string };

const chatColumns = `c.id, c.title, c.intake_project AS projectId, c.created_at AS createdAt, c.last_read_at AS lastReadAt,
  (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id AND m.role = 'assistant'
    AND (CASE WHEN c.last_read_message_id IS NULL THEN m.created_at > COALESCE(c.last_read_at, -1)
      ELSE m.rowid > COALESCE((SELECT rowid FROM messages WHERE id = c.last_read_message_id), 0) END)) AS unread`;
const messageColumns = `id, chat_id AS chatId, role, text, context, created_at AS createdAt, state, error,
  COALESCE(order_id, id) AS orderId, order_project AS orderProject`;
const attachmentColumns = "id, message_id AS messageId, mime, size, path";

function messageView(row: MessageRow): ChatTurn {
  return { ...row, context: row.context ? JSON.parse(row.context) as ChatReference[] : [] };
}

export class ChatsDb {
  readonly db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    migrate(this.db, "chats-");
  }

  close(): void {
    this.db.close();
  }

  version(): number {
    return (this.db.prepare("SELECT version FROM schema_version").get() as { version: number }).version;
  }

  listChats(): ChatView[] {
    return this.db.prepare(`SELECT ${chatColumns} FROM chats c ORDER BY
      COALESCE((SELECT MAX(created_at) FROM messages WHERE chat_id = c.id), c.created_at) DESC, c.id DESC`).all() as ChatView[];
  }

  chat(id: string): ChatView | undefined {
    return this.db.prepare(`SELECT ${chatColumns} FROM chats c WHERE id = ?`).get(id) as ChatView | undefined;
  }

  intakeChat(projectId: string): string | undefined {
    return (this.db.prepare("SELECT id FROM chats WHERE intake_project = ?").get(projectId) as { id: string } | undefined)?.id;
  }

  createChat(id: string, title: string, projectId: string | null): ChatView {
    this.db.prepare("INSERT INTO chats (id, title, intake_project, created_at) VALUES (?, ?, ?, ?)").run(id, title, projectId, Date.now());
    return this.chat(id)!;
  }

  session(id: string): ChatSession {
    return this.db.prepare("SELECT id, session_id AS sessionId, session_key AS sessionKey FROM chats WHERE id = ?").get(id) as ChatSession;
  }

  setSession(id: string, sessionId: string, sessionKey: string): void {
    this.db.prepare("UPDATE chats SET session_id = ?, session_key = ? WHERE id = ?").run(sessionId, sessionKey, id);
  }

  messages(chatId: string): ChatTurn[] {
    return (this.db.prepare(`SELECT ${messageColumns} FROM messages WHERE chat_id = ? ORDER BY rowid`).all(chatId) as MessageRow[]).map(messageView);
  }

  nextMessage(chatId: string): ChatTurn | undefined {
    const row: MessageRow | undefined = this.db.prepare(`SELECT ${messageColumns} FROM messages WHERE chat_id = ? AND state = 'queued' ORDER BY rowid LIMIT 1`).get(chatId) as MessageRow | undefined;
    return row && messageView(row);
  }

  message(chatId: string, id: string): ChatTurn | undefined {
    const row: MessageRow | undefined = this.db.prepare(`SELECT ${messageColumns} FROM messages WHERE chat_id = ? AND id = ?`).get(chatId, id) as MessageRow | undefined;
    return row && messageView(row);
  }

  addMessage(chatId: string, role: ChatMessageView["role"], text: string, context: ChatReference[], order?: { id: string; project: string }): ChatTurn {
    const id: string = ulid();
    this.db.prepare(`INSERT INTO messages (id, chat_id, role, text, context, state, order_id, order_project, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, chatId, role, text, JSON.stringify(context), role === "user" ? "queued" : "completed", order?.id ?? null, order?.project ?? null, Date.now());
    return this.message(chatId, id)!;
  }

  setMessageState(id: string, state: ChatMessageView["state"], error: string | null = null): void {
    this.db.prepare("UPDATE messages SET state = ?, error = ? WHERE id = ?").run(state, error, id);
  }

  setOrderProject(id: string, project: string | null): void {
    this.db.prepare("UPDATE messages SET order_project = ? WHERE id = ?").run(project, id);
  }

  interruptMessages(): void {
    this.db.transaction(() => {
      this.db.prepare("UPDATE messages SET state = 'interrupted' WHERE state IN ('queued', 'running')").run();
      this.db.prepare("UPDATE actions SET target = ? WHERE json_extract(target, '$.state') = 'running'").run(JSON.stringify({ state: "interrupted" }));
    })();
  }

  markRead(id: string): ChatView {
    this.db.prepare(`UPDATE chats SET last_read_at = ?, last_read_message_id =
      COALESCE((SELECT id FROM messages WHERE chat_id = chats.id ORDER BY rowid DESC LIMIT 1), '') WHERE id = ?`).run(Date.now(), id);
    return this.chat(id)!;
  }

  attachments(chatId: string): ChatAttachment[] {
    return this.db.prepare(`SELECT ${attachmentColumns} FROM attachments WHERE chat_id = ? ORDER BY id`).all(chatId) as ChatAttachment[];
  }

  messageAttachments(messageId: string): ChatAttachment[] {
    return this.db.prepare(`SELECT ${attachmentColumns} FROM attachments WHERE message_id = ? ORDER BY id`).all(messageId) as ChatAttachment[];
  }

  addAttachment(chatId: string, attachment: ChatAttachment): void {
    this.db.prepare("INSERT INTO attachments (id, chat_id, path, mime, size) VALUES (?, ?, ?, ?, ?)").run(attachment.id, chatId, attachment.path, attachment.mime, attachment.size);
  }

  linkAttachment(id: string, chatId: string, messageId: string): boolean {
    return this.db.prepare("UPDATE attachments SET message_id = ? WHERE id = ? AND chat_id = ? AND message_id IS NULL").run(messageId, id, chatId).changes === 1;
  }

  actions(chatId: string): ChatActionView[] {
    const rows = this.db.prepare(`SELECT a.id, a.message_id AS messageId, a.tool, a.target, a.created_at AS createdAt
      FROM actions a JOIN messages m ON a.message_id = m.id WHERE m.chat_id = ? ORDER BY a.id`).all(chatId) as ActionRow[];
    return rows.map((row) => ({ ...row, target: JSON.parse(row.target) as unknown }));
  }

  startAction(messageId: string, tool: string, target: unknown): string {
    const id: string = ulid();
    this.db.prepare("INSERT INTO actions (id, message_id, tool, target, created_at) VALUES (?, ?, ?, ?, ?)").run(id, messageId, tool, JSON.stringify(target ?? null), Date.now());
    return id;
  }

  finishAction(id: string, target: unknown): void {
    this.db.prepare("UPDATE actions SET target = ? WHERE id = ?").run(JSON.stringify(target), id);
  }

  addNotification(n: { kind: string; title: string; body: string; target?: unknown }, now = Date.now()): string {
    const id = ulid(now);
    this.db.transaction(() => {
      this.db
        .prepare("INSERT INTO notifications (id, kind, title, body, target, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, n.kind, n.title, n.body, n.target === undefined ? null : JSON.stringify(n.target), now);
      this.db.prepare("DELETE FROM notifications WHERE id NOT IN (SELECT id FROM notifications ORDER BY id DESC LIMIT ?)").run(notificationsKept);
    })();
    return id;
  }

  notifications(): Notification[] {
    return (this.db.prepare("SELECT * FROM notifications ORDER BY id DESC").all() as { id: string; kind: string; title: string; body: string; target: string | null; created_at: number }[]).map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      body: r.body,
      target: r.target,
      createdAt: r.created_at,
    }));
  }
}
