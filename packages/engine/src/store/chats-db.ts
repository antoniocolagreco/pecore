import Database from "better-sqlite3";
import { monotonicFactory } from "ulid";
import type { ChatActionView, ChatAttachmentView, ChatMessageView, ChatReference } from "@pecore/schemas";
import { migrate } from "./migrate";

const ulid = monotonicFactory();

export const assistantChat = "assistant";
export const notificationsKept = 500;

export type Notification = { id: string; kind: string; title: string; body: string; target: string | null; seen: boolean; createdAt: number };

export type Chat = { id: string; project: string | null };
export type ChatSession = { sessionId: string | null; sessionKey: string | null };
export type ChatTurn = ChatMessageView & { chatId: string; orderId: string; orderProject: string | null };
export type ChatAttachment = ChatAttachmentView & { path: string };
type MessageRow = Omit<ChatTurn, "context"> & { context: string };
type ActionRow = Omit<ChatActionView, "target"> & { target: string };

const messageColumns = `id, chat_id AS chatId, role, text, context, created_at AS createdAt, state, error, reply_to AS replyTo,
  COALESCE(order_id, id) AS orderId, order_project AS orderProject`;
const attachmentColumns = "id, message_id AS messageId, mime, size, path";

function messageView(row: MessageRow): ChatTurn {
  return { ...row, context: JSON.parse(row.context) as ChatReference[] };
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

  chats(): Chat[] {
    return this.db.prepare("SELECT id, project FROM chats ORDER BY id").all() as Chat[];
  }

  chat(id: string): Chat | undefined {
    return this.db.prepare("SELECT id, project FROM chats WHERE id = ?").get(id) as Chat | undefined;
  }

  projectChat(project: string): string {
    const existing = this.db.prepare("SELECT id FROM chats WHERE project = ?").get(project) as { id: string } | undefined;
    if (existing) return existing.id;
    const id: string = ulid();
    this.db.prepare("INSERT INTO chats (id, project) VALUES (?, ?)").run(id, project);
    return id;
  }

  unread(id: string): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM messages m WHERE m.chat_id = ? AND m.role = 'assistant'
      AND m.rowid > COALESCE((SELECT rowid FROM messages WHERE id = (SELECT last_read_message_id FROM chats WHERE id = m.chat_id)), 0)`).get(id) as { n: number }).n;
  }

  markRead(id: string): void {
    this.db.prepare("UPDATE chats SET last_read_message_id = (SELECT id FROM messages WHERE chat_id = chats.id ORDER BY rowid DESC LIMIT 1) WHERE id = ?").run(id);
  }

  clearChat(id: string): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM attachments WHERE chat_id = ?").run(id);
      this.db.prepare("DELETE FROM messages WHERE chat_id = ?").run(id);
      this.db.prepare("UPDATE chats SET session_id = NULL, session_key = NULL, context_tokens = NULL, last_read_message_id = NULL WHERE id = ?").run(id);
    })();
  }

  session(id: string): ChatSession {
    return this.db.prepare("SELECT session_id AS sessionId, session_key AS sessionKey FROM chats WHERE id = ?").get(id) as ChatSession;
  }

  setSession(id: string, sessionId: string, sessionKey: string): void {
    this.db.prepare("UPDATE chats SET session_id = ?, session_key = ? WHERE id = ?").run(sessionId, sessionKey, id);
  }

  contextTokens(id: string): number | null {
    return (this.db.prepare("SELECT context_tokens AS tokens FROM chats WHERE id = ?").get(id) as { tokens: number | null } | undefined)?.tokens ?? null;
  }

  setContextTokens(id: string, tokens: number | null): void {
    this.db.prepare("UPDATE chats SET context_tokens = ? WHERE id = ?").run(tokens, id);
  }

  busy(chatId: string): boolean {
    return this.db.prepare("SELECT 1 FROM messages WHERE chat_id = ? AND state IN ('queued', 'running') LIMIT 1").get(chatId) !== undefined;
  }

  queued(chatId: string, text: string): boolean {
    return this.db.prepare("SELECT 1 FROM messages WHERE chat_id = ? AND state = 'queued' AND text = ? LIMIT 1").get(chatId, text) !== undefined;
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

  addMessage(chatId: string, role: ChatMessageView["role"], text: string, context: ChatReference[], { order, replyTo }: { order?: { id: string; project: string }; replyTo?: string } = {}): ChatTurn {
    const id: string = ulid();
    this.db.prepare(`INSERT INTO messages (id, chat_id, role, text, context, state, order_id, order_project, reply_to, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, chatId, role, text, JSON.stringify(context), role === "user" ? "queued" : "completed", order?.id ?? null, order?.project ?? null, replyTo ?? null, Date.now());
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
    return (this.db.prepare("SELECT id, kind, title, body, target, seen, created_at AS createdAt FROM notifications ORDER BY id DESC").all() as (Omit<Notification, "seen"> & { seen: number })[])
      .map((n) => ({ ...n, seen: n.seen === 1 }));
  }

  unseenNotifications(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE seen = 0").get() as { n: number }).n;
  }

  markNotificationsSeen(): void {
    this.db.prepare("UPDATE notifications SET seen = 1 WHERE seen = 0").run();
  }

  deleteNotification(id: string): boolean {
    return this.db.prepare("DELETE FROM notifications WHERE id = ?").run(id).changes > 0;
  }
}
