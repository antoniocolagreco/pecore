import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "../../test/tmp";
import { ChatsDb, notificationsKept } from "./chats-db";
import { ProjectDb } from "./project-db";

const job = "01JOB";
const created = {
  jobId: job,
  type: "job.created" as const,
  payload: { title: "Fix login", recipe: { name: "empty" }, ticket: null, parentJobId: null, baseBranch: "main", base: "a".repeat(40), target: "main", branch: `factory/${job}` },
};

describe("pecore.db", () => {
  it("applies the migrations once, in WAL mode", async () => {
    const path = join(await tempDir(), "pecore.db");
    const db = new ProjectDb(path);
    expect(db.version()).toBe(2);
    expect(db.db.pragma("journal_mode", { simple: true })).toBe("wal");
    db.close();
    const again = new ProjectDb(path);
    expect(again.version()).toBe(2);
    const tables = (again.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    expect(tables).toEqual(["attempts", "confirmed_hashes", "events", "human_queue", "jobs", "node_runs", "schema_version", "tickets_seen", "usage_daily"]);
    again.close();
  });

  it("updates the job and node run views with each event", async () => {
    const db = new ProjectDb(join(await tempDir(), "pecore.db"));
    db.append([created], 1000);
    db.append([{ jobId: job, type: "job.state_changed", payload: { state: "running", reason: null } }], 2000);
    db.append(
      [
        { jobId: job, type: "node_run.created", payload: { nodeRunId: `${job}/lint#0`, node: "lint", round: 0 } },
        { jobId: job, type: "node_run.state_changed", payload: { nodeRunId: `${job}/lint#0`, state: "running", waitingReason: null, pgid: 42, osUser: "ac" } },
      ],
      3000,
    );
    db.append([{ jobId: job, type: "node_run.completed", payload: { nodeRunId: `${job}/lint#0`, outcome: "passed", contentBefore: "t1", contentAfter: "t1", artifacts: [] } }], 4000);
    db.append([{ jobId: job, type: "job.state_changed", payload: { state: "failed", reason: "lint:failed" } }], 5000);
    expect(db.db.prepare("SELECT state, failure_reason, waiting_reason, created_at, updated_at FROM jobs").get()).toEqual({
      state: "failed",
      failure_reason: "lint:failed",
      waiting_reason: null,
      created_at: 1000,
      updated_at: 5000,
    });
    expect(db.db.prepare("SELECT state, outcome, pgid, os_user, started_at, ended_at FROM node_runs").get()).toEqual({
      state: "completed",
      outcome: "passed",
      pgid: 42,
      os_user: "ac",
      started_at: 3000,
      ended_at: 4000,
    });
    expect(db.events(job).map((e) => e.type)).toEqual(["job.created", "job.state_changed", "node_run.created", "node_run.state_changed", "node_run.completed", "job.state_changed"]);
    db.close();
  });

  it("sums attempt usage per day and account", async () => {
    const db = new ProjectDb(join(await tempDir(), "pecore.db"));
    db.append([created]);
    for (const id of ["A1", "A2"]) {
      db.append([
        { jobId: job, type: "attempt.started", payload: { attemptId: id, nodeRunId: `${job}/code#0`, profile: "opus", connector: "claude-code", harnessVersion: "2.1.327", connectorVersion: "0.108.0", account: "claude", osUser: "ac", sessionGroup: null, logPath: `logs/${id}.jsonl.zst` } },
        { jobId: job, type: "attempt.ended", payload: { attemptId: id, endReason: "done", model: "claude-opus-5-5", account: "claude", tokens: { input: 10, output: 20, cacheRead: 300, cacheWrite: 40 }, cost: 0.5, day: "2026-11-18" } },
      ]);
    }
    expect(db.db.prepare("SELECT * FROM usage_daily").all()).toEqual([{ day: "2026-11-18", account: "claude", tokens_in: 20, tokens_out: 40, cache_read: 600, cache_write: 80, cost: 1 }]);
    expect(db.db.prepare("SELECT model, end_reason FROM attempts WHERE id = 'A2'").get()).toEqual({ model: "claude-opus-5-5", end_reason: "done" });
    db.close();
  });

  it("rejects an invalid event and writes nothing of its transaction", async () => {
    const db = new ProjectDb(join(await tempDir(), "pecore.db"));
    expect(() => db.append([created, { jobId: job, type: "job.state_changed", payload: { state: "lost", reason: null } } as never])).toThrow();
    expect(db.events()).toEqual([]);
    expect(db.db.prepare("SELECT count(*) AS n FROM jobs").get()).toEqual({ n: 0 });
    db.close();
  });

  it("keeps the queue item and its resolution", async () => {
    const db = new ProjectDb(join(await tempDir(), "pecore.db"));
    db.append([
      created,
      { jobId: job, type: "queue.added", payload: { itemId: "Q1", kind: "human-node", subject: { node: "human" }, subjectHash: "h", choices: ["approve", "reject"] } },
      { jobId: job, type: "queue.resolved", payload: { itemId: "Q1", state: "resolved", choice: "approve", note: null } },
    ]);
    expect(db.db.prepare("SELECT job_id, state, choice, choices FROM human_queue").get()).toEqual({ job_id: job, state: "resolved", choice: "approve", choices: '["approve","reject"]' });
    db.close();
  });
});

describe("chats.db", () => {
  it("applies its migrations and keeps the last notifications", async () => {
    const db = new ChatsDb(join(await tempDir(), "chats.db"));
    expect(db.version()).toBe(4);
    for (let i = 0; i < notificationsKept + 3; i++) db.addNotification({ kind: "job", title: `n${i}`, body: "" }, 1000 + i);
    const kept = db.notifications();
    expect(kept).toHaveLength(notificationsKept);
    expect(kept[0]!.title).toBe(`n${notificationsKept + 2}`);
    db.close();
  });

  it("removes the chat reply notifications an older version stored and keeps the others", async () => {
    const file = join(await tempDir(), "chats.db");
    const old = new ChatsDb(file);
    old.addNotification({ kind: "orchestrator-replied", title: "Orchestrator replied", body: "Orders", target: { chatId: "c1", messageId: "m1" } }, 1000);
    old.addNotification({ kind: "job-finished", title: "Fix login", body: "done" }, 1001);
    old.db.exec("ALTER TABLE messages DROP COLUMN reply_to; UPDATE schema_version SET version = 2;");
    old.close();
    const db = new ChatsDb(file);
    expect(db.version()).toBe(4);
    expect(db.notifications().map(({ kind }) => kind)).toEqual(["job-finished"]);
    db.close();
  });

  it("uses the manual chat with the latest message as the Assistant chat, never an intake chat", async () => {
    const db = new ChatsDb(join(await tempDir(), "chats.db"));
    expect(db.assistantChat()).toBeUndefined();
    db.createChat("c1", "Older", null);
    db.createChat("c2", "Newer", null);
    db.createChat("c3", "demo intake", "demo");
    expect(db.assistantChat()).toBe("c2");
    db.db.exec("UPDATE chats SET created_at = 1000");
    db.addMessage("c1", "user", "hello", []);
    db.addMessage("c3", "user", "ticket", []);
    db.db.exec("UPDATE messages SET created_at = CASE chat_id WHEN 'c1' THEN 2000 ELSE 3000 END");
    expect(db.assistantChat()).toBe("c1");
    db.close();
  });
});
