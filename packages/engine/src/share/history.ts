import Database from "better-sqlite3";
import { EventBody, JobState, Recipe } from "@pecore/schemas";
import { migrate } from "../store/migrate";
import { ProjectDb } from "../store/project-db";
import type { NewEvent } from "../store/project-db";
import { activeJobCount, archivePath, InvalidArchive } from "./archive";

function schema(db: ProjectDb["db"]): unknown[] {
  return db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY name").raw().all();
}

export function migrateHistory(path: string): void {
  const db: ProjectDb["db"] = new Database(path, { fileMustExist: true });
  try {
    db.pragma("trusted_schema = OFF");
    const tables = db.pragma("table_list") as { type: string }[];
    if (tables.some(({ type }) => type !== "table") || db.prepare("SELECT 1 FROM sqlite_schema WHERE type NOT IN ('table', 'index')").get()) {
      throw new InvalidArchive("pecore.db has an unexpected SQLite schema");
    }
    const version: number = migrate(db, "");
    const expected: ProjectDb = new ProjectDb(":memory:");
    try {
      if (version !== expected.version() || JSON.stringify(schema(db)) !== JSON.stringify(schema(expected.db))) {
        throw new InvalidArchive("pecore.db has an unexpected SQLite schema");
      }
    } finally {
      expected.close();
    }
  } finally {
    db.close();
  }
}

function checkPath(path: string, root: string): void {
  if (archivePath(path) !== path || !path.startsWith(`${root}/`)) throw new InvalidArchive(`pecore.db contains an invalid ${root} path`);
}

export function resetHistory(project: ProjectDb, events: NewEvent[]): void {
  const db: ProjectDb["db"] = project.db;
  const count: number = activeJobCount(db);
  if (count > 0) throw new InvalidArchive(`pecore.db contains ${count} active ${count === 1 ? "job" : "jobs"}`);
  const jobs = db.prepare("SELECT id, state, recipe, base, old_base FROM jobs").iterate() as Iterable<{ id: string; state: string; recipe: string; base: string | null; old_base: string | null }>;
  const validBase = (base: string | null): boolean => base === null || /^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(base);
  for (const job of jobs) {
    if (!/^[a-z\d][a-z\d_-]*$/i.test(job.id) || !JobState.safeParse(job.state).success || !validBase(job.base) || !validBase(job.old_base)) {
      throw new InvalidArchive("pecore.db contains an invalid job");
    }
    Recipe.parse(JSON.parse(job.recipe));
  }
  const logs = db.prepare("SELECT log_path FROM attempts").pluck().iterate() as Iterable<string>;
  for (const path of logs) checkPath(path, "logs");
  for (const event of project.events()) {
    if (event.type === "confirmation.recorded") continue;
    EventBody.parse(event);
    if (event.type === "job.created") for (const artifact of [...(event.payload.attachments ?? []), ...(event.payload.ticket ? [event.payload.ticket] : [])]) checkPath(artifact.path, "artifacts");
    if (event.type === "node_run.completed") for (const artifact of event.payload.artifacts) checkPath(artifact.path, "artifacts");
    if (event.type === "attempt.started") checkPath(event.payload.logPath, "logs");
    if (event.type === "job.base_change_requested" && !validBase(event.payload.base)) throw new InvalidArchive("pecore.db contains an invalid requested job base");
  }
  const obsolete = db.prepare("SELECT id, job_id FROM human_queue WHERE state = 'open' OR (kind = 'import' AND state = 'resolved' AND choice = 'reject')").all() as { id: string; job_id: string | null }[];
  db.transaction(() => {
    db.prepare("DELETE FROM events WHERE type = 'confirmation.recorded'").run();
    db.prepare("DELETE FROM confirmed_hashes").run();
    db.prepare("UPDATE node_runs SET state = 'interrupted', pgid = NULL, os_user = NULL WHERE state = 'running'").run();
    project.append([
      ...obsolete.map(({ id, job_id }): NewEvent => ({ jobId: job_id, type: "queue.resolved", payload: { itemId: id, state: "cancelled", choice: null, note: "the project was imported" } })),
      ...events,
    ]);
  })();
}
