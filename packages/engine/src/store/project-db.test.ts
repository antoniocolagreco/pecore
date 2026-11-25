import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Artifact } from "@pecore/schemas";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { tempDir } from "../../test/tmp";
import { ChatsDb, assistantChat, notificationsKept } from "./chats-db";
import { Configuration } from "./configuration";
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
    expect(db.version()).toBe(12);
    expect(db.db.pragma("journal_mode", { simple: true })).toBe("wal");
    db.close();
    const again = new ProjectDb(path);
    expect(again.version()).toBe(12);
    const tables = again.db.prepare<[], string>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'catalog_%' ORDER BY name").pluck().all();
    expect(tables).toEqual([
      "artifacts", "attempt_logs", "attempts", "events", "human_queue", "jobs", "node_runs",
      "project_creation", "project_credentials", "project_definition", "project_knowledge_reads", "project_knowledge_recipes",
      "project_knowledge_steps", "project_recipes", "project_source_params", "project_variables", "schema_version", "tickets_seen",
    ]);
    again.close();
  });

  it("persists artifact bytes and metadata by job, run, name and type", async () => {
    const path: string = join(await tempDir(), "pecore.db");
    const db: ProjectDb = new ProjectDb(path);
    db.append([created]);
    const content: string = "a change\n";
    const ref: Artifact = db.saveArtifact(job, "lint-0", "output", "text", content, "tree");
    const patch: Artifact = db.saveArtifact(job, "lint-0", "output", "diff", "+change\n", "tree");
    db.close();

    const reopened: ProjectDb = new ProjectDb(path);
    try {
      expect(ref).toEqual({ jobId: job, run: "lint-0", name: "output", type: "text", sha256: createHash("sha256").update(content).digest("hex"), contentState: "tree" });
      expect(reopened.db.prepare("SELECT sha256, content_state FROM artifacts WHERE type = 'text'").get()).toEqual({ sha256: ref.sha256, content_state: "tree" });
      expect(reopened.requireArtifact(ref)).toEqual(Buffer.from(content));
      expect(reopened.requireArtifact(ref, 2)).toEqual(Buffer.from("a "));
      expect(reopened.requireArtifact(patch)).toEqual(Buffer.from("+change\n"));
    } finally {
      reopened.close();
    }
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

  it("keeps ordered attempt logs and their tails after the attempts end and the database reopens", async () => {
    const path: string = join(await tempDir(), "pecore.db");
    const db: ProjectDb = new ProjectDb(path);
    db.append([created]);
    for (const id of ["A1", "A2"]) {
      db.append([
        { jobId: job, type: "attempt.started", payload: { attemptId: id, nodeRunId: `${job}/code#0`, profile: "opus", connector: "claude-code", harnessVersion: "2.1.327", connectorVersion: "0.108.0", account: "claude", osUser: "ac", sessionGroup: null } },
      ], 10);
    }
    db.logs.write("A1", { dir: "out", msg: { id: 1 }, at: 13 });
    db.logs.write("A1", { dir: "err", line: "é", at: 12 });
    db.logs.write("A2", { dir: "cmd", text: "still running", at: 11 });
    db.append([{ jobId: job, type: "attempt.ended", payload: { attemptId: "A1", endReason: "done", model: "claude-opus-5-5", account: "claude", tokens: { input: 10, output: 20, cacheRead: 300, cacheWrite: 40 }, cost: 0.5 } }], 20);
    expect(db.db.prepare("SELECT model, end_reason FROM attempts WHERE id = 'A1'").get()).toEqual({ model: "claude-opus-5-5", end_reason: "done" });
    db.close();

    const reopened: ProjectDb = new ProjectDb(path);
    try {
      expect(reopened.logs.read("A1")).toEqual([{ dir: "out", msg: { id: 1 }, at: 13 }, { dir: "err", line: "é", at: 12 }]);
      expect(reopened.logs.tail("A1", 13)).toEqual({ bytes: Buffer.from('é","at":12}\n'), truncated: true });
      expect(reopened.logs.tail("A2", 1000)).toEqual({ bytes: Buffer.from('{"dir":"cmd","text":"still running","at":11}\n'), truncated: false });
      expect(reopened.logs.status("A1")).toBe("available");
      expect(reopened.logs.status("A2")).toBe("available");
    } finally {
      reopened.close();
    }
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
  it("migrates the saved Assistant and PM identity while dropping personality traits", async () => {
    const file: string = join(await tempDir(), "chats.db");
    const old: Database.Database = new Database(file);
    for (const name of ["chats-009-agent-contexts.sql", "chats-010-configuration.sql"]) {
      old.exec(await readFile(new URL(`./migrations/${name}`, import.meta.url), "utf8"));
    }
    old.exec(`CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
      INSERT INTO schema_version VALUES (13);
      INSERT INTO agents VALUES
        ('assistant', 0, 'assistant', 'Old Name', 'account', 'saved-model', 'high', 65536, 131072, NULL, 0),
        ('pm-project', 1, 'pm', 'Chris', 'old-account', 'old-model', NULL, 131072, 262144, '#DC2626', 1),
        ('custom', 2, 'agent', 'Reviewer', NULL, NULL, NULL, 131072, 262144, NULL, 0),
        ('coloured', 3, 'agent', 'Builder', NULL, NULL, NULL, 131072, 262144, '#123456', 1);
      INSERT INTO agent_traits VALUES ('assistant', 0, 'critical');
      INSERT INTO assistant_traits VALUES (0, 'bold');
      INSERT INTO agent_contexts VALUES ('assistant', 'Assistant context'), ('pm-default', 'Default context');`);
    old.close();
    const db: ChatsDb = new ChatsDb(file);
    try {
      const configuration = new Configuration(db.db);
      expect(configuration.agents().agents).toEqual([
        { id: "assistant", kind: "agent", name: "Assistant", color: "#68389A", model: { account: "account", model: "saved-model", effort: "high" }, compaction: { auto: 65_536, max: 131_072 } },
        { id: "pm-project", kind: "pm", name: "Chris", color: "#DC2626", cardId: "agent-default" },
        { id: "custom", kind: "agent", name: "Reviewer", color: "#FFFFFF", model: null, compaction: { auto: 131_072, max: 262_144 } },
        { id: "coloured", kind: "agent", name: "Builder", color: "#123456", model: null, compaction: { auto: 131_072, max: 262_144 } },
      ]);
      expect(db.agentContext("assistant")).toBe("Assistant context");
      expect(db.agentContext("agent-default")).toBe("Default context");
      expect(db.db.prepare("SELECT count(*) FROM sqlite_schema WHERE name IN ('agent_traits', 'assistant_traits')").pluck().get()).toBe(0);
    } finally {
      db.close();
    }
  });

  it("applies its migrations and keeps the last notifications", async () => {
    const db = new ChatsDb(join(await tempDir(), "chats.db"));
    expect(db.version()).toBe(17);
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
    for (const name of old.db.prepare<[], string>("SELECT name FROM sqlite_schema WHERE type = 'table' AND name LIKE 'catalog_%' ORDER BY rowid DESC").pluck().all()) {
      old.db.exec(`DROP TABLE "${name}"`);
    }
    old.db.exec(`DROP TABLE agent_contexts; DROP TABLE settings; DROP TABLE ui_preferences; DROP TABLE harness_colors;
      DROP TABLE agents; DROP TABLE tier_profiles;
      DROP TABLE profiles; DROP TABLE accounts; DROP TABLE auto_setup_profiles; DROP TABLE theme_tokens; DROP TABLE themes;
      UPDATE schema_version SET version = 5`);
    old.close();
    const db = new ChatsDb(file);
    expect(db.version()).toBe(17);
    expect(db.messages(assistantChat)).toEqual([]);
    db.close();
  });

  it("keeps each agent's context after reopening the database", async () => {
    const path: string = join(await tempDir(), "chats.db");
    const db: ChatsDb = new ChatsDb(path);
    db.setAgentContext("assistant", "# Small changes");
    db.setAgentContext("agent-default", "# Check dependencies");
    db.setAgentContext("assistant", "# Ask before changing scope");
    db.close();

    const reopened: ChatsDb = new ChatsDb(path);
    try {
      expect(reopened.agentContext("assistant")).toBe("# Ask before changing scope");
      expect(reopened.agentContext("agent-default")).toBe("# Check dependencies");
      expect(reopened.agentContext("unknown")).toBe("");
    } finally {
      reopened.close();
    }
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
