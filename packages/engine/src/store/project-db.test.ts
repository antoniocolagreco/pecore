import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Node, Recipe } from "@pecore/schemas";
import type { Artifact } from "@pecore/schemas";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { tempDir } from "../../test/tmp";
import { definitionHash, jobDefinitions, snapshotDefinitions } from "../definitions/snapshot";
import { nextStep } from "../graph/rules";
import { humanItem } from "../runners/human";
import { ChatsDb, assistantChat, notificationsKept } from "./chats-db";
import { Catalog } from "./catalog";
import { Configuration } from "./configuration";
import { ProjectDb } from "./project-db";

const job = "01JOB";
function restoreArtifactColumns(db: Database.Database): void {
  db.exec(`ALTER TABLE catalog_recipe_steps ADD COLUMN optional INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE jobs DROP COLUMN request;
    ALTER TABLE jobs DROP COLUMN ticket_id;
    ALTER TABLE artifacts RENAME COLUMN files_hash TO content_state;
    ALTER TABLE node_runs RENAME COLUMN files_hash_before TO content_before;
    ALTER TABLE node_runs RENAME COLUMN files_hash_after TO content_after`);
}

function restoreLegacyAnchors(db: Database.Database): void {
  db.exec(`ALTER TABLE catalog_recipes ADD COLUMN has_start_ports INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE catalog_recipes ADD COLUMN start_source_port TEXT;
    ALTER TABLE catalog_recipes ADD COLUMN start_target_port TEXT;
    ALTER TABLE catalog_recipe_edges ADD COLUMN source_port TEXT;
    ALTER TABLE catalog_recipe_edges ADD COLUMN target_port TEXT;`);
}
async function restoreTrackerColumns(db: Database.Database): Promise<void> {
  db.exec(`ALTER TABLE catalog_nodes ADD COLUMN old_kind TEXT NOT NULL DEFAULT 'command' CHECK (old_kind IN ('command', 'agent', 'human', 'tracker', 'repository'));
    UPDATE catalog_nodes SET old_kind = kind;
    ALTER TABLE catalog_nodes DROP COLUMN kind;
    ALTER TABLE catalog_nodes RENAME COLUMN old_kind TO kind;
    ALTER TABLE catalog_nodes ADD COLUMN tracker_provider TEXT;
    ALTER TABLE catalog_nodes ADD COLUMN tracker_account TEXT;
    ALTER TABLE catalog_nodes ADD COLUMN tracker_script TEXT;
    ALTER TABLE catalog_nodes ADD COLUMN tracker_repeat_check INTEGER;`);
  db.exec(await readFile(new URL("./migrations/shared-030-tracker-mcp.sql", import.meta.url), "utf8"));
}
const created = {
  jobId: job,
  type: "job.created" as const,
  payload: { title: "Fix login", recipe: { name: "empty" }, request: "", parentJobId: null, baseBranch: "main", base: "a".repeat(40), target: "main", branch: `factory/${job}` },
};

describe("pecore.db", () => {
  it("removes obsolete history and skipped routes but keeps project records and usable recipes", async () => {
    const path: string = join(await tempDir(), "pecore.db");
    const old: ProjectDb = new ProjectDb(path);
    old.definition.write({ id: "demo", name: "Demo", repo: null, folder: null, createRepo: null, baseBranch: "main", services: null, pm: null, tracker: null });
    old.catalog.saveRecipe(Recipe.parse({
      name: "reviewed", description: "Review", start: "review",
      nodes: { review: { use: "human-review" } },
      ends: [{ from: "review", on: "approved", result: "succeeded" }, { from: "review", on: "skipped", result: "succeeded" }],
    }));
    old.append([created]);
    old.saveArtifact(job, "ticket", "ticket.json", "attachment", Buffer.from("old request"), null);
    restoreArtifactColumns(old.db);
    old.db.exec(`
      UPDATE schema_version SET version = 35;
      UPDATE catalog_recipe_steps SET optional = 1;
      INSERT INTO catalog_step_lists VALUES ('reviewed', 'review', 'reads', 0, '@start');
      UPDATE artifacts SET type = 'document';
      UPDATE events SET payload = json_set(json_remove(payload, '$.request'), '$.ticket', null);
    `);
    old.close();
    const reopened: ProjectDb = new ProjectDb(path);
    try {
      expect(reopened.definition.read()?.id).toBe("demo");
      expect(reopened.catalog.recipe("reviewed")).toMatchObject({
        nodes: { review: { use: "human-review", reads: [] } },
        ends: [{ from: "review", on: "approved", result: "succeeded" }],
      });
      expect(reopened.catalog.recipe("reviewed")?.nodes.review).not.toHaveProperty("optional");
      expect(reopened.events()).toEqual([]);
      expect(reopened.db.prepare("SELECT * FROM jobs").all()).toEqual([]);
      expect(reopened.db.prepare("SELECT * FROM artifacts").all()).toEqual([]);
      expect(reopened.db.prepare("SELECT name FROM pragma_table_info('artifacts') WHERE name = 'files_hash'").pluck().get()).toBe("files_hash");
    } finally {
      reopened.close();
    }
  });

  it("drops only graph anchors from catalog recipes, job recipes and their saved events", async () => {
    const path: string = join(await tempDir(), "pecore.db");
    const old: ProjectDb = new ProjectDb(path);
    await restoreTrackerColumns(old.db);
    const current: Recipe = Recipe.parse({
      name: "run", description: "Two checks", start: "one",
      nodes: { one: { use: "check" }, two: { use: "check" } },
      edges: [{ from: "one", to: "two", on: "success", maxRounds: 2 }],
      ends: [{ from: "two", on: "success", result: "succeeded" }],
      layout: { one: { x: 272, y: 176 }, two: { x: 544, y: 176 } },
    });
    const legacy = {
      ...current,
      startPorts: { sourcePort: "bottom", targetPort: "top" },
      edges: [{ ...current.edges[0]!, sourcePort: "left", targetPort: "right" }],
      ends: [{ ...current.ends![0]!, targetPort: "left" }],
    };
    const recipe: string = JSON.stringify(legacy);
    const definitions = { nodes: {}, recipeHash: definitionHash(legacy) };
    old.catalog.saveRecipe(current);
    old.append([
      { ...created, payload: { ...created.payload, recipe: current, definitions } },
      { jobId: job, type: "job.definitions_saved", payload: definitions },
    ]);
    old.db.prepare("UPDATE jobs SET recipe = ? WHERE id = ?").run(recipe, job);
    old.db.prepare("UPDATE events SET payload = json_set(payload, '$.recipe', json(?)) WHERE type = 'job.created'").run(recipe);
    restoreLegacyAnchors(old.db);
    restoreArtifactColumns(old.db);
    old.db.exec(`UPDATE catalog_recipes SET has_start_ports = 1, start_source_port = 'bottom', start_target_port = 'top';
      UPDATE catalog_recipe_edges SET source_port = 'left', target_port = 'right';
      UPDATE schema_version SET version = 32;`);
    old.close();
    const db: ProjectDb = new ProjectDb(path);
    try {
      expect(db.version()).toBe(37);
      expect(db.catalog.recipe(current.name)).toEqual(current);
      expect(db.db.prepare("SELECT name FROM pragma_table_info('catalog_recipes') WHERE name LIKE '%port%'").all()).toEqual([]);
      expect(db.db.prepare("SELECT name FROM pragma_table_info('catalog_recipe_edges') WHERE name LIKE '%port%'").all()).toEqual([]);
      const migrated: string = db.db.prepare<[], string>("SELECT recipe FROM jobs").pluck().get()!;
      expect(JSON.parse(migrated)).toMatchObject(current);
      const events = db.events(job);
      expect(events[0]?.payload).toMatchObject({ recipe: current, definitions: { recipeHash: definitionHash(current) } });
      expect(events[1]?.payload).toMatchObject({ recipeHash: definitionHash(current) });
      expect(migrated + JSON.stringify(events)).not.toMatch(/(?:sourcePort|targetPort|startPorts)/);
    } finally {
      db.close();
    }
  });

  it("applies the migrations once, in WAL mode", async () => {
    const path = join(await tempDir(), "pecore.db");
    const db = new ProjectDb(path);
    expect(db.version()).toBe(37);
    expect(db.db.prepare("SELECT name FROM pragma_table_info('catalog_nodes') WHERE name IN ('tracker_provider', 'tracker_script', 'tracker_account')").all()).toEqual([]);
    expect(db.db.prepare("SELECT name FROM sqlite_master WHERE name = 'catalog_tracker_arguments'").get()).toBeUndefined();
    expect(() => db.db.exec("INSERT INTO catalog_nodes (name, description, kind, shipped) VALUES ('legacy', 'Old tracker', 'tracker', 0)")).toThrow(/CHECK constraint failed/);
    expect(db.db.prepare("SELECT name FROM pragma_table_info('catalog_nodes') WHERE name = 'clean_checkout'").get()).toBeUndefined();
    expect(db.db.pragma("journal_mode", { simple: true })).toBe("wal");
    db.close();
    const again = new ProjectDb(path);
    expect(again.version()).toBe(37);
    const tables = again.db.prepare<[], string>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'catalog_%' ORDER BY name").pluck().all();
    expect(tables).toEqual([
      "artifacts", "attempt_logs", "attempts", "events", "human_queue", "jobs", "node_runs",
      "project_creation", "project_credentials", "project_definition", "project_knowledge_reads", "project_knowledge_recipes",
      "project_knowledge_steps", "project_recipes", "project_variables", "schema_version", "tickets_seen",
    ]);
    again.close();
  });

  it("adds the new Jira MCP failure route to recipes using a shipped template only", async () => {
    const path: string = join(await tempDir(), "chats.db");
    const old: ChatsDb = new ChatsDb(path);
    const catalog: Catalog = new Catalog(old.db);
    await restoreTrackerColumns(old.db);
    old.db.exec(`INSERT INTO catalog_nodes (name, description, kind, shipped, timeout_sec, changes_files, retry, tracker_provider, tracker_account, tracker_server, tracker_tool)
      VALUES ('jira-mcp-ticket-read', 'Read Jira', 'tracker', 1, 120, 0, 1, 'jira', 'atlassian', 'atlassian', 'getJiraIssue'),
      ('jira-mcp-ticket-search', 'Find Jira tickets', 'tracker', 0, 120, 0, 1, 'jira', 'atlassian', 'atlassian', 'searchJiraIssuesUsingJql');
      INSERT INTO catalog_node_lists VALUES ('jira-mcp-ticket-read', 'outcomes', 0, 'success'), ('jira-mcp-ticket-search', 'outcomes', 0, 'success');`);
    catalog.saveRecipe(Recipe.parse({
      name: "jira", description: "Read and search Jira", start: "read",
      nodes: { read: { use: "jira-mcp-ticket-read" }, search: { use: "jira-mcp-ticket-search" } },
      edges: [{ from: "read", on: "success", to: "search" }],
      ends: [{ from: "search", on: "success", result: "succeeded" }],
    }));
    restoreLegacyAnchors(old.db);
    old.db.exec("ALTER TABLE catalog_recipe_steps ADD COLUMN optional INTEGER NOT NULL DEFAULT 0");
    old.db.prepare("UPDATE schema_version SET version = 31").run();
    old.close();
    const db: ChatsDb = new ChatsDb(path);
    try {
      const updated: Recipe = new Catalog(db.db).recipe("jira")!;
      expect(updated.edges).toEqual([{ from: "read", on: "success", to: "search" }]);
      expect(updated.ends).toEqual([
        { from: "search", on: "success", result: "succeeded" },
        { from: "read", on: "failure", result: "failed" },
      ]);
      const migrated = new Catalog(db.db);
      expect(migrated.node("jira-mcp-ticket-read")).toMatchObject({
        kind: "agent", tracker: { access: "read", account: "atlassian" }, outcomes: ["success", "failure"],
      });
    } finally {
      db.close();
    }
  });

  it("adapts a saved recipe and converts its job snapshots without changing results or reading connections", async () => {
    const path: string = join(await tempDir(), "pecore.db");
    const old: ProjectDb = new ProjectDb(path);
    const read = {
      name: "github-ticket-read", description: "Read a ticket", kind: "tracker", provider: "github", account: "project.account",
      script: "echo ticket", readOnly: true, outcomes: ["success", "failure"], failOutcomes: ["failure"],
      outcomeRules: [{ exitCode: 0, outcome: "success" }, { exitCode: "other", outcome: "failure" }],
      outputs: { success: "code_review" }, outputRules: { success: { stdoutJson: "" } },
    };
    const next: Node = Node.parse({
      name: "consume", description: "Consume the ticket", kind: "command", command: ["cat"], changesFiles: false, timeoutSec: 30,
      inputs: ["code_review"], outcomes: ["success"], outcomeRules: [{ exitCode: 0, outcome: "success" }],
    });
    const recipe: Recipe = Recipe.parse({
      name: "use-ticket", description: "Read then consume a ticket", start: "read",
      nodes: { read: { use: read.name }, consume: { use: next.name, reads: ["read"] } },
      edges: [{ from: "read", on: "success", to: "consume" }],
      ends: [{ from: "consume", on: "success", result: "succeeded" }, { from: "read", on: "failure", result: "failed" }],
    });
    await restoreTrackerColumns(old.db);
    old.db.exec(`INSERT INTO catalog_nodes (name, description, kind, shipped, timeout_sec, changes_files, retry, tracker_provider, tracker_account, tracker_script, reads_only)
      VALUES ('github-ticket-read', 'Read a ticket', 'tracker', 1, 120, 0, 1, 'github', 'project.account', 'echo ticket', 1);
      INSERT INTO catalog_node_lists VALUES ('github-ticket-read', 'outcomes', 0, 'success'), ('github-ticket-read', 'outcomes', 1, 'failure'),
        ('github-ticket-read', 'failOutcomes', 0, 'failure');
      INSERT INTO catalog_node_outputs VALUES ('github-ticket-read', 'success', 'code_review');`);
    old.catalog.saveNode(next);
    old.catalog.saveRecipe(recipe);
    const [first, last] = old.append([
      { ...created, payload: { ...created.payload, recipe } },
      { jobId: job, type: "job.definitions_saved", payload: { recipeHash: definitionHash(recipe), nodes: {} } },
    ]);
    const readSnapshot = { definition: read, sidecars: {}, hash: definitionHash({ definition: read, sidecars: {} }) };
    const definitions = {
      recipeHash: definitionHash(recipe),
      nodes: { [read.name]: readSnapshot, [next.name]: { definition: next, sidecars: {}, hash: definitionHash({ definition: next, sidecars: {} }) } },
    };
    const customDefinition = { ...read, name: "custom-read", script: "echo custom action" };
    const customSnapshot = { definition: customDefinition, sidecars: {}, hash: definitionHash(customDefinition) };
    const save = old.db.prepare("UPDATE events SET payload = ? WHERE id = ?");
    save.run(JSON.stringify({ ...first!.payload, definitions }), first!.id);
    save.run(JSON.stringify({ ...definitions, nodes: { ...definitions.nodes, [customDefinition.name]: customSnapshot } }), last!.id);
    restoreArtifactColumns(old.db);
    old.db.exec("UPDATE schema_version SET version = 34");
    old.close();
    const db: ProjectDb = new ProjectDb(path);
    try {
      expect(db.catalog.recipe(recipe.name)).toEqual(recipe);
      expect(db.catalog.node(read.name)).toMatchObject({
        kind: "agent", tracker: { account: "project.account", access: "read" },
        outputs: { success: "code_review" }, outcomes: ["success", "failure"],
      });
      expect(db.catalog.content("github-ticket-read-tracker-agent.md")).toContain("Read the specified ticket");
      const history = db.events(job).find((event) => event.type === "job.created");
      expect(history?.payload.definitions?.nodes[read.name]?.definition).toMatchObject({ kind: "agent", outputs: { success: "code_review" } });
      const snapshot = jobDefinitions(db, job)!;
      const changed = snapshot.nodes[read.name]!;
      expect(changed.definition).toEqual(db.catalog.node(read.name));
      expect(changed.hash).toBe(definitionHash({ definition: changed.definition, sidecars: changed.sidecars }));
      expect(snapshot.nodes[next.name]).toEqual(definitions.nodes[next.name]);
      expect(snapshot.nodes["custom-read"]?.definition).toMatchObject({ kind: "agent", tracker: { access: "read" } });
      expect(snapshot.nodes["custom-read"]?.sidecars["custom-read-previous-tracker.md"]).toContain("echo custom action");
      expect(snapshot.recipeHash).toBe(definitions.recipeHash);
    } finally {
      db.close();
    }
  });

  it("migrates catalog references, live review choices, finished outcomes and job snapshots together", async () => {
    const path: string = join(await tempDir(), "pecore.db");
    const old: ProjectDb = new ProjectDb(path);
    await restoreTrackerColumns(old.db);
    const check: Node = Node.parse({
      name: "check", description: "Run a check", kind: "command", outcomes: ["passed", "failed"],
      failOutcomes: ["failed"], outputs: { passed: "log" }, outputRules: { passed: { stdoutLastLine: "report" } },
      outcomeRules: [{ exitCode: 0, outcome: "passed" }, { exitCode: "other", outcome: "failed" }],
      command: ["true"], changesFiles: false, timeoutSec: 5,
    });
    const review: Node = Node.parse({
      name: "review", description: "Review", kind: "human", interface: "code-review",
      outcomes: ["approve", "changes", "reject"], outputs: { changes: "code_review" },
    });
    if (review.kind !== "human") throw new Error("Expected a Human node");
    const legacy: Recipe = Recipe.parse({
      name: "check-then-review", description: "Check and review", start: "check",
      nodes: { check: { use: "check" }, review: { use: "review" } },
      edges: [{ from: "check", on: "passed", to: "review", maxRounds: 2 }, { from: "review", on: "changes", to: "check" }],
      ends: [{ from: "check", on: "failed", result: "failed" }, { from: "review", on: "approve", result: "succeeded" },
        { from: "review", on: "reject", result: "not_delivered" }],
    });
    const definitions = await snapshotDefinitions(legacy, new Map([["check", check], ["review", review]]), "");
    old.catalog.saveNode(check);
    old.catalog.saveNode(review);
    old.catalog.saveRecipe(legacy);
    restoreLegacyAnchors(old.db);
    old.db.prepare("UPDATE schema_version SET version = 30").run();
    const checkRun: string = job + "/check#0";
    const reviewRun: string = job + "/review#0";
    const finishedJob: string = "finished";
    const finishedRun: string = finishedJob + "/check#0";
    const item = humanItem(reviewRun, "review", review, [], "tree");
    old.append([
      { ...created, payload: { ...created.payload, recipe: legacy, definitions } },
      { jobId: job, type: "node_run.created", payload: { nodeRunId: checkRun, node: "check", round: 0, viaEdge: null } },
      { jobId: job, type: "attempt.started", payload: { attemptId: "attempt", nodeRunId: checkRun, profile: null, connector: null,
        harnessVersion: null, connectorVersion: null, account: null, osUser: "user" } },
      { jobId: job, type: "attempt.ended", payload: { attemptId: "attempt", endReason: "passed", model: null, account: null,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, cost: null } },
      { jobId: job, type: "node_run.completed", payload: { nodeRunId: checkRun, outcome: "passed", filesHashBefore: "tree", filesHashAfter: "tree", artifacts: [] } },
      { jobId: job, type: "node_run.created", payload: { nodeRunId: reviewRun, node: "review", round: 0, viaEdge: 0 } },
      { jobId: job, type: "queue.added", payload: { ...item, itemId: "review-item" } },
      { jobId: job, type: "job.state_changed", payload: { state: "waiting", reason: "human" } },
      { ...created, jobId: finishedJob, payload: { ...created.payload, recipe: legacy, definitions } },
      { jobId: finishedJob, type: "node_run.created", payload: { nodeRunId: finishedRun, node: "check", round: 0, viaEdge: null } },
      { jobId: finishedJob, type: "node_run.completed", payload: { nodeRunId: finishedRun, outcome: "failed", filesHashBefore: null, filesHashAfter: null, artifacts: [] } },
      { jobId: finishedJob, type: "job.state_changed", payload: { state: "failed", reason: "check:failed" } },
    ]);
    restoreArtifactColumns(old.db);
    old.close();

    const db: ProjectDb = new ProjectDb(path);
    try {
      const saved = db.catalog.node("check");
      expect(saved).toMatchObject({
        outcomes: ["success", "failure"], failOutcomes: ["failure"], outputs: { success: "log" },
        outcomeRules: [{ exitCode: 0, outcome: "success" }, { exitCode: "other", outcome: "failure" }],
        outputRules: { success: { stdoutLastLine: "report" } },
      });
      const migrated: Recipe = db.catalog.recipe(legacy.name)!;
      expect(migrated.edges).toEqual([
        { from: "check", on: "success", to: "review", maxRounds: 2 },
        { from: "review", on: "changes_requested", to: "check" },
      ]);
      expect(migrated.ends).toEqual([
        { from: "check", on: "failure", result: "failed" },
        { from: "review", on: "approved", result: "succeeded" },
        { from: "review", on: "rejected", result: "not_delivered" },
      ]);
      const snapshot = jobDefinitions(db, job)!;
      expect(snapshot.recipeHash).toBe(definitionHash(migrated));
      expect(snapshot.nodes.check?.definition).toEqual(saved);
      expect(db.db.prepare("SELECT state, failure_reason FROM jobs WHERE id = ?").get(finishedJob)).toEqual({ state: "failed", failure_reason: "check:failure" });
      expect(db.db.prepare("SELECT outcome FROM node_runs WHERE id = ?").pluck().get(checkRun)).toBe("success");
      expect(db.db.prepare("SELECT end_reason FROM attempts WHERE id = 'attempt'").pluck().get()).toBe("success");
      expect(db.events(finishedJob).find(({ type }) => type === "node_run.completed")?.payload).toMatchObject({ outcome: "failure" });
      const migratedItem = humanItem(reviewRun, "review", Node.parse(snapshot.nodes.review?.definition) as typeof review, [], "tree");
      expect(db.db.prepare("SELECT subject_hash, choices FROM human_queue WHERE id = 'review-item'").get()).toEqual({
        subject_hash: migratedItem.subjectHash, choices: '["approved","changes_requested","rejected"]',
      });
      expect(db.events(job).find(({ type }) => type === "queue.added")?.payload).toMatchObject({ subjectHash: migratedItem.subjectHash });
      expect(nextStep(migrated, new Map([["check", saved!], ["review", db.catalog.node("review")!]]),
        [{ nodeId: "check", outcome: "success", viaEdge: null }])).toEqual({ kind: "run", nodeId: "review", round: 0, viaEdge: 0 });
    } finally {
      db.close();
    }
  });

  it("migrates credentialed Command nodes to Repository and removes credentials and checks from Command", async () => {
    const path: string = join(await tempDir(), "pecore.db");
    const old: Database.Database = new Database(path);
    const dir: URL = new URL("./migrations/", import.meta.url);
    const migrations: string[] = (await readdir(dir)).filter((name) => /^(?:shared-)?0(?:0\d|1\d|2[0-7])-.*\.sql$/.test(name))
      .sort((a, b) => a.replace("shared-", "").localeCompare(b.replace("shared-", "")));
    for (const name of migrations) old.exec(await readFile(new URL(name, dir), "utf8"));
    old.exec(`INSERT INTO schema_version VALUES (27);
      INSERT INTO catalog_nodes (name, description, kind, shipped, timeout_sec, changes_files, retry, runs_as)
        VALUES ('publish', 'Publish', 'command', 0, 60, 0, 1, 'engine'), ('check', 'Check', 'command', 0, 60, 0, 1, 'project-user'),
        ('inspect', 'Inspect the remote', 'command', 0, 60, 0, 1, 'engine');
      INSERT INTO catalog_node_lists VALUES ('publish', 'credentials', 0, 'gh-user'), ('publish', 'outcomes', 0, 'done'),
        ('check', 'outcomes', 0, 'done'), ('inspect', 'outcomes', 0, 'done');
      INSERT INTO catalog_commands (node, action, script) VALUES ('publish', 'command', 'publish.sh'), ('publish', 'probe', NULL),
        ('check', 'command', NULL), ('check', 'probe', NULL), ('inspect', 'command', NULL);
      INSERT INTO catalog_command_args VALUES ('publish', 'probe', 0, 'true'), ('check', 'command', 0, 'true'), ('check', 'probe', 0, 'false'),
        ('inspect', 'command', 0, 'gh'), ('inspect', 'command', 1, 'repo'), ('inspect', 'command', 2, 'view'),
        ('inspect', 'command', 3, '{project.repo.owner}/{project.repo.name}');
      INSERT INTO catalog_outcome_rules (node, position, outcome, exit_code) VALUES ('publish', 0, 'done', 0), ('check', 0, 'done', 0), ('inspect', 0, 'done', 0);
      INSERT INTO catalog_node_content VALUES ('publish.sh', 'shell', 'gh repo view', 0);`);
    old.close();
    const db: ProjectDb = new ProjectDb(path);
    try {
      expect(db.catalog.node("publish")).toMatchObject({ kind: "repository", account: "gh-user", script: "gh repo view", probe: ["true"] });
      expect(db.catalog.node("check")).toMatchObject({ kind: "command", command: ["true"] });
      expect(db.catalog.node("check")).not.toHaveProperty("probe");
      expect(db.catalog.node("inspect")).toMatchObject({
        kind: "repository", account: "project.account", script: expect.stringContaining("PECORE_PROJECT_REPO_OWNER"),
      });
      expect(db.db.prepare("SELECT name FROM pragma_table_info('catalog_nodes') WHERE name = 'runs_as'").get()).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("converts a custom CLI tracker and keeps its old definition for reference", async () => {
    const path: string = join(await tempDir(), "pecore.db");
    const old: Database.Database = new Database(path);
    const dir: URL = new URL("./migrations/", import.meta.url);
    const migrations: string[] = (await readdir(dir)).filter((name) => /^(?:shared-)?0[0-2]\d-.*\.sql$/.test(name))
      .sort((a, b) => a.replace("shared-", "").localeCompare(b.replace("shared-", "")));
    for (const name of migrations) old.exec(await readFile(new URL(name, dir), "utf8"));
    old.exec("INSERT INTO schema_version VALUES (29);" +
      "INSERT INTO catalog_nodes (name, description, kind, shipped, timeout_sec, changes_files, retry, tracker_provider, tracker_account, tracker_script) VALUES ('read', 'Read', 'tracker', 0, 60, 0, 1, 'jira', 'project.account', 'echo ticket');" +
      "INSERT INTO catalog_node_lists VALUES ('read', 'outcomes', 0, 'done');" +
      "INSERT INTO catalog_outcome_rules (node, position, outcome, exit_code) VALUES ('read', 0, 'done', 0);");
    old.close();
    const db: ProjectDb = new ProjectDb(path);
    try {
      expect(db.catalog.node("read")).toMatchObject({
        kind: "agent", prompt: "read-tracker-agent.md", tracker: { access: "read", account: "active-jira" },
      });
      expect(db.catalog.content("read-previous-tracker.md")).toContain('"script": "echo ticket"');
      expect(db.catalog.content("read-tracker-agent.md")).toContain("Ask the user");
    } finally {
      db.close();
    }
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
        kind: "agent", tracker: { access: "read", account: "gh-alice" },
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
    const ref: Artifact = db.saveArtifact(job, "lint-0", "output", "log", content, "tree");
    const patch: Artifact = db.saveArtifact(job, "lint-0", "output", "diff", "+change\n", "tree");
    db.close();

    const reopened: ProjectDb = new ProjectDb(path);
    try {
      expect(ref).toEqual({ jobId: job, run: "lint-0", name: "output", type: "log", sha256: createHash("sha256").update(content).digest("hex"), filesHash: "tree" });
      expect(reopened.db.prepare("SELECT sha256, files_hash FROM artifacts WHERE type = 'log'").get()).toEqual({ sha256: ref.sha256, files_hash: "tree" });
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
    db.append([{ jobId: job, type: "node_run.completed", payload: { nodeRunId: `${job}/lint#0`, outcome: "passed", filesHashBefore: "t1", filesHashAfter: "t1", artifacts: [] } }], 4000);
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
    expect(db.version()).toBe(36);
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
    expect(db.version()).toBe(36);
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
