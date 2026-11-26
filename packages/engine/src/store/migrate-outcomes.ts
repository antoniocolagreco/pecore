import type Database from "better-sqlite3";
import type { JobDefinitions, Recipe } from "@pecore/schemas";
import { outcomeRenames, renamedOutcome, renameNodeOutcomes, renameOutcomeMentions, renameRecipeOutcomes, renameRouteReason, recipeStepOutcomes } from "../definitions/outcomes";
import type { OutcomeLookup } from "../definitions/outcomes";
import { definitionHash } from "../definitions/snapshot";
import { subjectHash } from "../runners/human";
import { Catalog } from "./catalog";

type Renames = ReadonlyMap<string, string>;
type JobRow = { id: string; recipe: string; failure_reason: string | null };
type RunRow = { id: string; job_id: string; node: string; outcome: string | null };
type QueueRow = { id: string; subject: string; choices: string; choice: string | null };
type EventRow = { id: string; job_id: string | null; type: string; payload: string };

function catalogRenames(db: Database.Database): Map<string, Renames> {
  const stored = db.prepare<[], { name: string; human_interface: string | null; outcomes: string }>(`
    SELECT n.name, n.human_interface, json_group_array(l.value ORDER BY l.position) AS outcomes
    FROM catalog_nodes n JOIN catalog_node_lists l ON l.node = n.name AND l.field = 'outcomes'
    GROUP BY n.name`).all();
  return new Map(stored.map(({ name, human_interface, outcomes }) => [
    name, outcomeRenames(name, JSON.parse(outcomes) as string[], human_interface),
  ]));
}

function snapshotLookup(snapshot: JobDefinitions | undefined, fallback: OutcomeLookup): OutcomeLookup {
  if (!snapshot) return fallback;
  const byNode: Map<string, Renames> = new Map(Object.entries(snapshot.nodes).flatMap(([name, { definition }]) =>
    Array.isArray(definition.outcomes)
      ? [[name, outcomeRenames(name, definition.outcomes, definition.kind === "human" ? definition.interface : null)]]
      : []));
  return (node, outcome) => byNode.has(node) ? byNode.get(node)?.get(outcome) ?? outcome : fallback(node, outcome);
}

function updateSnapshot(snapshot: JobDefinitions, recipe: Recipe, oldRecipeHash: string, lookup: OutcomeLookup): void {
  for (const [name, entry] of Object.entries(snapshot.nodes)) {
    const node = entry.definition;
    if (!Array.isArray(node.outcomes)) continue;
    const renames: Renames = new Map(node.outcomes.map((outcome): [string, string] => [outcome, lookup(name, outcome)]).filter(([old, next]) => old !== next));
    if (!renames.size) continue;
    renameNodeOutcomes(node, renames);
    if (node.kind === "agent" && typeof entry.sidecars[node.prompt] === "string") {
      entry.sidecars[node.prompt] = renameOutcomeMentions(entry.sidecars[node.prompt]!, renames);
    }
    entry.hash = definitionHash({ definition: node, sidecars: entry.sidecars });
  }
  if (snapshot.recipeHash === oldRecipeHash) snapshot.recipeHash = definitionHash(recipe);
}

function migrateCatalogRecipes(db: Database.Database, lookup: OutcomeLookup): void {
  const catalog: Catalog = new Catalog(db);
  const selectEdges = db.prepare<[string], { position: number; source: string; outcome: string }>(
    "SELECT position, source, outcome FROM catalog_recipe_edges WHERE recipe = ?");
  const saveEdge = db.prepare("UPDATE catalog_recipe_edges SET outcome = ? WHERE recipe = ? AND position = ?");
  const saveCi = db.prepare("UPDATE catalog_recipes SET ci_on = ? WHERE name = ?");
  const saveSuccess = db.prepare("UPDATE catalog_recipe_lists SET value = ? WHERE recipe = ? AND field = 'successOutcomes' AND position = ?");
  for (const name of catalog.names("recipes")) {
    const recipe: Recipe = catalog.recipe(name)!;
    const atStep: OutcomeLookup = recipeStepOutcomes(recipe, lookup);
    for (const { position, source, outcome } of selectEdges.all(name)) {
      const renamed: string = atStep(source, outcome);
      if (renamed !== outcome) saveEdge.run(renamed, name, position);
    }
    const success: string[] = recipe.successOutcomes;
    const ci: string | undefined = recipe.ci?.on;
    renameRecipeOutcomes(recipe, lookup);
    if (recipe.ci && recipe.ci.on !== ci) saveCi.run(recipe.ci.on, name);
    for (const [position, value] of recipe.successOutcomes.entries()) {
      if (value !== success[position]) saveSuccess.run(value, name, position);
    }
  }
}

function migrateJobs(db: Database.Database, fallback: OutcomeLookup): void {
  const jobs: JobRow[] = db.prepare<[], JobRow>("SELECT id, recipe, failure_reason FROM jobs").all();
  const runs: Map<string, RunRow> = new Map(db.prepare<[], RunRow>("SELECT id, job_id, node, outcome FROM node_runs").all().map((run) => [run.id, run]));
  const attempts: Map<string, string> = new Map(db.prepare<[], { id: string; node_run_id: string }>("SELECT id, node_run_id FROM attempts").all().map((attempt) => [attempt.id, attempt.node_run_id]));
  const before: Map<string, Recipe> = new Map(jobs.map((job) => [job.id, JSON.parse(job.recipe) as Recipe]));
  const latest: Map<string, OutcomeLookup> = new Map();
  const events: EventRow[] = db.prepare<[], EventRow>(`
    SELECT id, job_id, type, payload FROM events WHERE job_id IS NOT NULL AND type IN (
      'job.created', 'job.definitions_saved', 'job.state_changed', 'node_run.completed',
      'attempt.ended', 'queue.added', 'queue.resolved'
    ) ORDER BY id`).all();
  const saveEvent = db.prepare("UPDATE events SET payload = ? WHERE id = ?");
  const saveJob = db.prepare("UPDATE jobs SET recipe = ?, failure_reason = ? WHERE id = ?");
  const saveRun = db.prepare("UPDATE node_runs SET outcome = ? WHERE id = ?");
  const saveAttempt = db.prepare("UPDATE attempts SET end_reason = ? WHERE id = ?");
  const saveQueue = db.prepare("UPDATE human_queue SET subject = ?, subject_hash = ?, choices = ?, choice = ? WHERE id = ?");
  for (const event of events) {
    const recipe: Recipe | undefined = before.get(event.job_id!);
    if (!recipe) continue;
    if (event.type === "job.created") {
      const payload = JSON.parse(event.payload) as { recipe: Recipe; definitions?: JobDefinitions };
      const lookup: OutcomeLookup = snapshotLookup(payload.definitions, fallback);
      latest.set(event.job_id!, lookup);
      const oldRecipeHash: string = definitionHash(payload.recipe);
      renameRecipeOutcomes(payload.recipe, lookup);
      if (payload.definitions) updateSnapshot(payload.definitions, payload.recipe, oldRecipeHash, lookup);
      saveEvent.run(JSON.stringify(payload), event.id);
    }
    if (event.type === "job.definitions_saved") {
      const snapshot: JobDefinitions = JSON.parse(event.payload);
      const lookup: OutcomeLookup = snapshotLookup(snapshot, fallback);
      latest.set(event.job_id!, lookup);
      const updated: Recipe = structuredClone(recipe);
      renameRecipeOutcomes(updated, lookup);
      updateSnapshot(snapshot, updated, definitionHash(recipe), lookup);
      saveEvent.run(JSON.stringify(snapshot), event.id);
    }
  }
  const noChange: OutcomeLookup = (_, value) => value;
  const forJob = (id: string): OutcomeLookup => {
    const recipe: Recipe | undefined = before.get(id);
    return recipe ? recipeStepOutcomes(recipe, latest.get(id) ?? fallback) : noChange;
  };
  const forRun = (id: string, outcome: string): string => {
    const run: RunRow | undefined = runs.get(id);
    return run ? forJob(run.job_id)(run.node, outcome) : outcome;
  };
  for (const job of jobs) {
    const recipe: Recipe = structuredClone(before.get(job.id)!);
    renameRecipeOutcomes(recipe, latest.get(job.id) ?? fallback);
    saveJob.run(JSON.stringify(recipe), job.failure_reason === null ? null : renameRouteReason(job.failure_reason, forJob(job.id)), job.id);
  }
  for (const run of runs.values()) {
    if (run.outcome === null) continue;
    const outcome: string = forRun(run.id, run.outcome);
    if (outcome !== run.outcome) saveRun.run(outcome, run.id);
  }
  const queueRuns: Map<string, string> = new Map();
  for (const row of db.prepare<[], QueueRow>("SELECT id, subject, choices, choice FROM human_queue WHERE kind = 'human-node'").all()) {
    const subject = JSON.parse(row.subject) as { nodeRunId?: string; notes?: string[] };
    if (!subject.nodeRunId) continue;
    const rename = (outcome: string): string => forRun(subject.nodeRunId!, outcome);
    queueRuns.set(row.id, subject.nodeRunId);
    if (subject.notes) subject.notes = subject.notes.map(rename);
    saveQueue.run(JSON.stringify(subject), subjectHash(subject), JSON.stringify((JSON.parse(row.choices) as string[]).map(rename)),
      row.choice === null ? null : rename(row.choice), row.id);
  }
  for (const event of events) {
    if (event.type === "job.created" || event.type === "job.definitions_saved") continue;
    const payload = JSON.parse(event.payload) as {
      reason?: string | null; nodeRunId?: string; outcome?: string; attemptId?: string; endReason?: string;
      itemId?: string; kind?: string; choices?: string[]; choice?: string | null;
      subject?: { nodeRunId?: string; notes?: string[] }; subjectHash?: string;
    };
    if (event.type === "job.state_changed" && payload.reason) payload.reason = renameRouteReason(payload.reason, forJob(event.job_id!));
    if (event.type === "node_run.completed" && payload.outcome) payload.outcome = forRun(payload.nodeRunId!, payload.outcome);
    if (event.type === "attempt.ended" && payload.endReason) {
      const reason: string = forRun(attempts.get(payload.attemptId!) ?? "", payload.endReason);
      if (reason !== payload.endReason) saveAttempt.run(reason, payload.attemptId);
      payload.endReason = reason;
    }
    if (event.type === "queue.added" && payload.kind === "human-node" && payload.subject?.nodeRunId) {
      const subject = payload.subject;
      const rename = (outcome: string): string => forRun(subject.nodeRunId!, outcome);
      queueRuns.set(payload.itemId!, subject.nodeRunId!);
      if (subject.notes) subject.notes = subject.notes.map(rename);
      payload.choices = payload.choices?.map(rename);
      payload.subjectHash = subjectHash(subject);
    }
    if (event.type === "queue.resolved" && payload.choice) payload.choice = forRun(queueRuns.get(payload.itemId!) ?? "", payload.choice);
    const updated: string = JSON.stringify(payload);
    if (updated !== event.payload) saveEvent.run(updated, event.id);
  }
}

export function migrateOutcomes(db: Database.Database, sql: string, project: boolean, options?: { inherited?: Database.Database; archivedOutcomes?: OutcomeLookup }): void {
  const catalog: Catalog = new Catalog(db);
  const byNode: Map<string, Renames> = catalogRenames(db);
  const lookup: OutcomeLookup = (name, outcome) => byNode.has(name) ? byNode.get(name)?.get(outcome) ?? outcome : renamedOutcome(name, outcome);
  const approved: string[] = [];
  db.exec("CREATE TEMP TABLE outcome_renames (node TEXT, old TEXT, new TEXT, PRIMARY KEY (node, old))");
  const insert = db.prepare("INSERT INTO outcome_renames (node, old, new) VALUES (?, ?, ?)");
  const approval = db.prepare("SELECT chat_approved_hash FROM catalog_nodes WHERE name = ? AND kind = 'repository'");
  const prompt = db.prepare<[string], string | null>(`SELECT node.prompt FROM catalog_nodes node WHERE node.name = ?\n    AND (SELECT count(*) FROM catalog_nodes sibling WHERE sibling.prompt = node.prompt) = 1`).pluck();
  const updatePrompt = db.prepare("UPDATE catalog_node_content SET body = ? WHERE name = ?");
  for (const [name, renames] of byNode) {
    if (!renames.size) continue;
    if ((approval.get(name) as { chat_approved_hash: string | null } | undefined)?.chat_approved_hash && catalog.chatNode(name)?.approved) approved.push(name);
    const key: string | null | undefined = prompt.get(name);
    const body: string | null = key ? catalog.content(key) : null;
    if (body !== null) updatePrompt.run(renameOutcomeMentions(body, renames), key);
    for (const [old, next] of renames) insert.run(name, old, next);
  }
  migrateCatalogRecipes(db, lookup);
  if (project) {
    const shared: unknown = db.prepare("SELECT uses_templates FROM project_definition").pluck().get();
    const global: Catalog | undefined = shared === 1 && options?.inherited ? new Catalog(options.inherited) : undefined;
    const fallback: OutcomeLookup = global ? (name, outcome) => global.node(name)?.outcomes.includes(outcome) ? outcome : renamedOutcome(name, outcome) : lookup;
    migrateJobs(db, options?.archivedOutcomes ?? fallback);
  }
  db.exec(sql);
  for (const name of approved) {
    const current = catalog.chatNode(name);
    if (current) catalog.approveChatNode(name, current.hash);
  }
}
