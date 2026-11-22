import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "../../test/tmp";
import { ChatsDb, assistantChat, notificationsKept } from "./chats-db";
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
    expect(db.version()).toBe(4);
    expect(db.db.pragma("journal_mode", { simple: true })).toBe("wal");
    db.close();
    const again = new ProjectDb(path);
    expect(again.version()).toBe(4);
    const tables = (again.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    expect(tables).toEqual(["attempts", "events", "human_queue", "jobs", "node_runs", "schema_version", "tickets_seen"]);
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

  it("records the end of each attempt", async () => {
    const db = new ProjectDb(join(await tempDir(), "pecore.db"));
    db.append([created]);
    for (const id of ["A1", "A2"]) {
      db.append([
        { jobId: job, type: "attempt.started", payload: { attemptId: id, nodeRunId: `${job}/code#0`, profile: "opus", connector: "claude-code", harnessVersion: "2.1.327", connectorVersion: "0.108.0", account: "claude", osUser: "ac", sessionGroup: null, logPath: `logs/${id}.jsonl.zst` } },
        { jobId: job, type: "attempt.ended", payload: { attemptId: id, endReason: "done", model: "claude-opus-5-5", account: "claude", tokens: { input: 10, output: 20, cacheRead: 300, cacheWrite: 40 }, cost: 0.5 } },
      ]);
    }
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
    expect(db.version()).toBe(6);
    for (let i = 0; i < notificationsKept + 3; i++) db.addNotification({ kind: "job", title: `n${i}`, body: "" }, 1000 + i);
    const kept = db.notifications();
    expect(kept).toHaveLength(notificationsKept);
    expect(kept[0]!.title).toBe(`n${notificationsKept + 2}`);
    db.close();
  });

  it("starts with the Assistant chat only, and replaces a database of an older version", async () => {
    const file = join(await tempDir(), "chats.db");
    const old = new ChatsDb(file);
    expect(old.chats()).toEqual([{ id: assistantChat, project: null }]);
    old.addMessage(assistantChat, "user", "hello", []);
    old.db.exec("UPDATE schema_version SET version = 5");
    old.close();
    const db = new ChatsDb(file);
    expect(db.version()).toBe(6);
    expect(db.messages(assistantChat)).toEqual([]);
    db.close();
  });

  it("keeps one Project Manager chat per project and counts unread Assistant replies", async () => {
    const db = new ChatsDb(join(await tempDir(), "chats.db"));
    const demo: string = db.projectChat("demo");
    expect(db.projectChat("demo")).toBe(demo);
    expect(db.projectChat("shop")).not.toBe(demo);
    db.addMessage(assistantChat, "user", "hi", []);
    db.addMessage(assistantChat, "assistant", "hello", []);
    expect(db.unread(assistantChat)).toBe(1);
    db.markRead(assistantChat);
    expect(db.unread(assistantChat)).toBe(0);
    db.addMessage(assistantChat, "assistant", "more", []);
    expect(db.unread(assistantChat)).toBe(1);
    db.close();
  });

  it("marks notifications seen", async () => {
    const db = new ChatsDb(join(await tempDir(), "chats.db"));
    db.addNotification({ kind: "job-finished", title: "Fix login", body: "done" });
    expect(db.unseenNotifications()).toBe(1);
    db.markNotificationsSeen();
    expect(db.unseenNotifications()).toBe(0);
    expect(db.notifications()).toMatchObject([{ title: "Fix login", seen: true }]);
    db.close();
  });
});
