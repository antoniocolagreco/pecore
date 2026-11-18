import Database from "better-sqlite3";
import { monotonicFactory } from "ulid";
import { migrate } from "./migrate";

const ulid = monotonicFactory();

export const notificationsKept = 500;

export type Notification = { id: string; kind: string; title: string; body: string; target: string | null; createdAt: number };

export class ChatsDb {
  readonly db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    migrate(this.db, "chats-");
  }

  close(): void {
    this.db.close();
  }

  version(): number {
    return (this.db.prepare("SELECT version FROM schema_version").get() as { version: number }).version;
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
