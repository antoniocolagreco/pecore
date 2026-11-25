import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Node, Recipe } from "@pecore/schemas";
import type { Artifact } from "@pecore/schemas";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { tempDir } from "../../test/tmp";
import { jobDefinitions } from "../definitions/snapshot";
import { ChatsDb, assistantChat, notificationsKept } from "./chats-db";
import { Catalog } from "./catalog";
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
    expect(db.version()).toBe(27);
    expect(db.db.prepare("SELECT name FROM pragma_table_info('catalog_nodes') WHERE name = 'clean_checkout'").get()).toBeUndefined();
    expect(db.db.pragma("journal_mode", { simple: true })).toBe("wal");
    db.close();
    const again = new ProjectDb(path);
    expect(again.version()).toBe(27);
    const tables = again.db.prepare<[], string>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'catalog_%' ORDER BY name").pluck().all();
    expect(tables).toEqual([
      "artifacts", "attempt_logs", "attempts", "events", "human_queue", "jobs", "node_runs",
      "project_creation", "project_credentials", "project_definition", "project_knowledge_reads", "project_knowledge_recipes",
      "project_knowledge_steps", "project_recipes", "project_variables", "schema_version", "tickets_seen",
    ]);
    again.close();
  });

  it("migrates old agent templates, recipe steps and attempts to the agent session fields", async () => {
    const path: string = join(await tempDir(), "pecore.db");
    const old: Database.Database = new Database(path);
    for (const name of ["001-init.sql", "002-orders.sql", "003-drop-usage-daily.sql", "004-drop-confirmed-hashes.sql", "005-artifacts.sql",
      "006-attempt-logs.sql", "007-project-definition.sql", "shared-012-catalog.sql", "shared-019-drop-recipe-node-run-limit.sql"]) {
      old.exec(await readFile(new URL(`./migrations/${name}`, import.meta.url), "utf8"));
    }
    old.exec(`INSERT INTO schema_version VALUES (19);
      INSERT INTO catalog_nodes (name, description, kind, shipped, timeout_sec, changes_files, retry, prompt, tier, resume)
        VALUES ('builder', 'Build', 'agent', 0, 60, 1, 0, 'builder.md', 'standard', 1);
      INSERT INTO catalog_node_lists VALUES ('builder', 'outcomes', 0, 'done');
      INSERT INTO catalog_recipes (name, description, shipped, start, has_start_ports, has_ends, has_layout)
        VALUES ('build', 'Build', 0, 'build', 0, 0, 0);
      INSERT INTO catalog_recipe_lists VALUES ('build', 'successOutcomes', 0, 'build:done');
      INSERT INTO catalog_recipe_steps (recipe, step, position, node, optional, session, skip_when_unchanged, has_params, has_agent, has_provider_not)
        VALUES ('build', 'build', 0, 'builder', 0, 'builders', 0, 0, 0, 0);
      INSERT INTO attempts (id, node_run_id, profile, os_user, session_group, session_id, started_at)
        VALUES ('previous', 'old-run', 'profile', 'ac', 'builders', 'S1', 0);`);
    old.close();

    const db: ProjectDb = new ProjectDb(path);
    try {
      const node: Node = db.catalog.node("builder")!;
      const recipe: Recipe = db.catalog.recipe("build")!;
      expect(node).toMatchObject({ kind: "agent", agentSession: "job" });
      expect(node).not.toHaveProperty("resume");
      expect(recipe.nodes.build).not.toHaveProperty("session");
      expect(recipe.nodes.build?.agentSession).toBeUndefined();
      expect(db.db.prepare("SELECT session_id, agent_id, agent_session FROM attempts WHERE id = 'previous'").get())
        .toEqual({ session_id: "S1", agent_id: null, agent_session: null });
      expect(db.db.prepare("SELECT name FROM pragma_table_info('attempts') WHERE name = 'session_group'").get()).toBeUndefined();
      db.catalog.saveNode(Node.parse({ ...node, agentSession: "new" }));
      db.catalog.saveRecipe(Recipe.parse({ ...recipe, nodes: { build: { use: "builder", agentId: "reviewer", agentSession: "job" } } }));
      expect(db.catalog.node("builder")).toHaveProperty("agentSession", "new");
      expect(db.catalog.recipe("build")?.nodes.build).toMatchObject({ agentId: "reviewer", agentSession: "job" });
    } finally {
      db.close();
    }
  });

  it("migrates Shared and Isolated catalog entries and attempts while keeping saved definitions readable", async () => {
    const path: string = join(await tempDir(), "pecore.db");
    const old: Database.Database = new Database(path);
    for (const name of ["001-init.sql", "002-orders.sql", "003-drop-usage-daily.sql", "004-drop-confirmed-hashes.sql", "005-artifacts.sql",
      "006-attempt-logs.sql", "007-project-definition.sql", "shared-012-catalog.sql", "shared-019-drop-recipe-node-run-limit.sql",
      "shared-020-agent-context.sql", "021-agent-sessions.sql"]) {
      old.exec(await readFile(new URL(`./migrations/${name}`, import.meta.url), "utf8"));
    }
    old.exec(`INSERT INTO schema_version VALUES (21);
      INSERT INTO catalog_nodes (name, description, kind, shipped, timeout_sec, changes_files, retry, prompt, tier, agent_context)
        VALUES ('builder', 'Build', 'agent', 0, 60, 1, 0, 'builder.md', 'standard', 'shared'),
               ('reviewer', 'Review', 'agent', 0, 60, 0, 0, 'reviewer.md', 'standard', 'isolated'),
               ('github-issues', 'Old intake', 'source', 1, 60, NULL, NULL, NULL, NULL, NULL),
               ('github-issue-comment', 'Post delivery', 'command', 0, 60, 0, 1, NULL, NULL, NULL);
      INSERT INTO catalog_node_content VALUES ('delivery-comment.sh', 'shell', 'printf posted', 0);
      INSERT INTO catalog_commands VALUES ('github-issue-comment', 'command', 'delivery-comment.sh', NULL);
      INSERT INTO catalog_node_lists VALUES ('github-issue-comment', 'credentials', 0, 'gh-alice'), ('github-issue-comment', 'outcomes', 0, 'done');
      INSERT INTO catalog_outcome_rules VALUES ('github-issue-comment', 0, 'done', 0, NULL, NULL);
      INSERT INTO project_definition (id, name, base_branch, source_node, source_account, uses_templates, has_variables, has_credentials, has_recipe_knowledge)
        VALUES ('demo', 'Demo', 'main', 'github-issues', 'gh-alice', 0, 0, 0, 0);
      INSERT INTO catalog_node_lists VALUES ('builder', 'outcomes', 0, 'done'), ('reviewer', 'outcomes', 0, 'done');
      INSERT INTO catalog_recipes (name, description, shipped, start, has_start_ports, has_ends, has_layout)
        VALUES ('build', 'Build', 0, 'build', 0, 0, 0);
      INSERT INTO catalog_recipe_lists VALUES ('build', 'successOutcomes', 0, 'build:done');
      INSERT INTO catalog_recipe_steps (recipe, step, position, node, optional, skip_when_unchanged, has_params, has_agent, has_provider_not, agent_context)
        VALUES ('build', 'build', 0, 'builder', 0, 0, 0, 0, 0, 'isolated'),
               ('build', 'review', 1, 'reviewer', 0, 0, 0, 0, 0, 'shared'),
               ('build', 'inherit', 2, 'builder', 0, 0, 0, 0, 0, NULL);
      INSERT INTO attempts (id, node_run_id, profile, os_user, session_id, started_at, agent_id, agent_context)
        VALUES ('a1', 'build-run', 'profile', 'ac', 'S1', 0, 'agent-default', 'shared'),
               ('a2', 'review-run', 'profile', 'ac', 'S2', 0, 'agent-default', 'isolated');`);
    const hash: string = "a".repeat(64);
    const snapshot = {
      recipeHash: hash,
      nodes: {
        reviewer: {
          definition: {
            name: "reviewer", description: "Review", kind: "agent", prompt: "reviewer.md", changesFiles: false,
            timeoutSec: 60, agent: { tier: "standard" }, outcomes: ["done"], agentContext: "isolated",
          },
          sidecars: { "reviewer.md": "Review" },
          hash,
        },
        tests: {
          definition: {
            name: "tests", description: "Test", kind: "command", changesFiles: false, timeoutSec: 60,
            outcomes: ["passed"], command: ["true"], outcomeRules: [{ exitCode: 0, outcome: "passed" }], cleanCheckout: true,
          },
          sidecars: {},
          hash,
        },
      },
    };
    old.prepare("INSERT INTO events VALUES ('e1', ?, 'job.definitions_saved', ?, 0)").run(job, JSON.stringify(snapshot));
    old.prepare("INSERT INTO events VALUES ('e2', ?, 'attempt.started', ?, 0)").run(job, JSON.stringify({
      attemptId: "a1", nodeRunId: "build-run", profile: "profile", connector: "fake", harnessVersion: null, connectorVersion: null, account: "fake",
      osUser: "ac", agentId: "agent-default", agentContext: "shared",
    }));
    old.close();

    const db: ProjectDb = new ProjectDb(path);
    try {
      expect(db.catalog.node("github-issues")).toBeNull();
      expect(db.catalog.node("github-issue-comment")).toMatchObject({
        kind: "tracker", provider: "github", account: "gh-alice", script: "printf posted",
      });
      expect(db.definition.read()?.tracker).toEqual({ provider: "github", account: "gh-alice" });
      expect(db.catalog.node("builder")).toHaveProperty("agentSession", "job");
      expect(db.catalog.node("reviewer")).toHaveProperty("agentSession", "new");
      const recipe: Recipe = db.catalog.recipe("build")!;
      expect(recipe.nodes.build?.agentSession).toBe("new");
      expect(recipe.nodes.review?.agentSession).toBe("job");
      expect(recipe.nodes.inherit?.agentSession).toBeUndefined();
      expect(db.db.prepare("SELECT id, session_id, agent_session FROM attempts ORDER BY id").all()).toEqual([
        { id: "a1", session_id: "S1", agent_session: "job" },
        { id: "a2", session_id: "S2", agent_session: "new" },
      ]);
      const event = db.events(job).find(({ type }) => type === "attempt.started");
      expect(event?.payload).toMatchObject({ agentId: "agent-default", agentSession: "job" });
      expect(event?.payload).not.toHaveProperty("agentContext");
      const saved = jobDefinitions(db, job);
      expect(saved?.nodes.reviewer).toMatchObject({ definition: { agentSession: "new" }, hash });
      expect(saved?.nodes.tests).toMatchObject({ definition: { kind: "command", command: ["true"] }, hash });
      expect(saved?.nodes.tests?.definition).not.toHaveProperty("cleanCheckout");
    } finally {
      db.close();
    }
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
        { jobId: job, type: "attempt.started", payload: { attemptId: id, nodeRunId: `${job}/code#0`, profile: "opus", connector: "claude-code", harnessVersion: "2.1.327", connectorVersion: "0.108.0", account: "claude", osUser: "ac", agentId: "agent-default", agentSession: "job" } },
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
    for (const name of ["chats-009-agent-contexts.sql", "chats-010-configuration.sql", "shared-012-catalog.sql"]) {
      old.exec(await readFile(new URL(`./migrations/${name}`, import.meta.url), "utf8"));
    }
    old.exec(`CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
      INSERT INTO schema_version VALUES (13);
      INSERT INTO catalog_recipes (name, description, shipped, has_start_ports, max_node_runs, has_ends, has_layout)
        VALUES ('saved-recipe', 'Saved recipe', 0, 0, 60, 0, 0);
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
        { id: "assistant", kind: "agent", name: "Assistant", color: "#FFFFFF", model: { account: "account", model: "saved-model", effort: "high" }, compaction: { auto: 65_536, max: 131_072 } },
        { id: "pm-project", kind: "pm", name: "Chris", color: "#DC2626", cardId: "agent-default" },
        { id: "custom", kind: "agent", name: "Reviewer", color: "#FFFFFF", model: null, compaction: { auto: 131_072, max: 262_144 } },
        { id: "coloured", kind: "agent", name: "Builder", color: "#123456", model: null, compaction: { auto: 131_072, max: 262_144 } },
      ]);
      expect(db.agentContext("assistant")).toBe("Assistant context");
      expect(db.agentContext("agent-default")).toBe("Default context");
      expect(db.db.prepare("SELECT count(*) FROM sqlite_schema WHERE name IN ('agent_traits', 'assistant_traits')").pluck().get()).toBe(0);
      expect(new Catalog(db.db).recipe("saved-recipe")).toMatchObject({ name: "saved-recipe", description: "Saved recipe" });
      expect(db.db.prepare("SELECT name FROM pragma_table_info('catalog_recipes') WHERE name = 'max_node_runs'").get()).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("applies its migrations and keeps the last notifications", async () => {
    const db = new ChatsDb(join(await tempDir(), "chats.db"));
    expect(db.version()).toBe(26);
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
    expect(db.version()).toBe(26);
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
