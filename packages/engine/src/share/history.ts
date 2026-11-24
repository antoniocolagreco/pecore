import Database from "better-sqlite3";
import { monotonicFactory } from "ulid";
import { EventBody, JobState, Recipe } from "@pecore/schemas";
import { jobArtifacts } from "../jobs/stacked";
import { subjectHash } from "../runners/human";
import { migrate } from "../store/migrate";
import { ProjectDb } from "../store/project-db";
import type { NewEvent } from "../store/project-db";
import { activeJobCount, archivePath, InvalidArchive } from "./archive";

type HistoryArtifact = { file: string; bytes: number; content: Buffer | null };

export function historyArtifacts(db: ProjectDb["db"], maxBytes: number = Number.MAX_SAFE_INTEGER): IterableIterator<HistoryArtifact> {
  return db.prepare<[number], HistoryArtifact>(`
    SELECT job_id || '/' || run || '/' || name AS file, length(content) AS bytes,
      CASE WHEN length(content) <= ? THEN content END AS content
    FROM artifacts ORDER BY file, type`).iterate(maxBytes);
}

export function historyLogs(db: ProjectDb["db"], maxBytes: number = Number.MAX_SAFE_INTEGER): IterableIterator<HistoryArtifact> {
  return db.prepare<[number], HistoryArtifact>(`
    SELECT 'logs/' || attempt_id || '/' || sequence AS file, length(CAST(payload AS BLOB)) AS bytes,
      CASE WHEN length(CAST(payload AS BLOB)) <= ? THEN CAST(payload AS BLOB) END AS content
    FROM attempt_logs ORDER BY attempt_id, sequence`).iterate(maxBytes);
}

function schema(db: ProjectDb["db"]): unknown[] {
  return db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY name").raw().all();
}

export function migrateHistory(path: string, includeLogs: boolean): void {
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
    if (!includeLogs && db.prepare("SELECT 1 FROM attempt_logs LIMIT 1").get()) {
      throw new InvalidArchive("archive files do not match the manifest's history and logs flags");
    }
    if (db.prepare("SELECT 1 FROM pragma_foreign_key_check('attempt_logs') LIMIT 1").get() ||
      db.prepare("SELECT 1 FROM attempt_logs JOIN attempts ON attempts.id = attempt_logs.attempt_id WHERE log_omitted = 1 LIMIT 1").get()) {
      throw new InvalidArchive("pecore.db contains an invalid attempt log reference");
    }
  } finally {
    db.close();
  }
}

function remapHistory(db: ProjectDb["db"]): void {
  const ulidText = /(?<![0-9a-z])[0-7][0-9a-hjkmnp-tv-z]{25}(?![0-9a-z])/gi;
  const oldIds: Set<string> = new Set();
  const sources: string = `
    SELECT id FROM events UNION SELECT id FROM jobs UNION SELECT id FROM attempts UNION SELECT id FROM human_queue
    UNION SELECT order_id FROM jobs WHERE order_id IS NOT NULL UNION SELECT order_id FROM tickets_seen WHERE order_id IS NOT NULL`;
  for (const id of db.prepare<[], string>(sources).pluck().iterate()) if (id.match(ulidText)?.[0] === id) oldIds.add(id);
  const ulid = monotonicFactory();
  const ids: Map<string, string> = new Map([...oldIds].map((id) => [id, ulid()]));
  const rewrite = (text: string): string => text.replace(ulidText, (id) => ids.get(id) ?? id);

  db.function("import_text", (value: unknown) => (typeof value === "string" ? rewrite(value) : value));
  const tables = db.prepare<[], string>("SELECT name FROM sqlite_schema WHERE type = 'table'").pluck().all();
  for (const table of tables) {
    if (table.startsWith("project_") || table.startsWith("catalog_")) continue;
    const columns = db.prepare<[string], string>("SELECT name FROM pragma_table_info(?) WHERE type = 'TEXT'").pluck().all(table);
    if (columns.length > 0) db.exec(`UPDATE "${table}" SET ${columns.map((name) => {
      if (table === "jobs" && name === "recipe") return 'recipe = recipe';
      if (table === "attempt_logs" && name === "payload") return 'payload = payload';
      if (table === "events" && name === "payload") return `payload = CASE
        WHEN type = 'job.definitions_saved' THEN payload
        WHEN type = 'job.created' AND json_type(payload, '$.definitions') IS NOT NULL
          THEN json_set(import_text(payload), '$.recipe', payload -> '$.recipe', '$.definitions', payload -> '$.definitions')
        WHEN type = 'job.created' THEN json_set(import_text(payload), '$.recipe', payload -> '$.recipe')
        ELSE import_text(payload) END`;
      return `"${name}" = import_text("${name}")`;
    }).join(", ")}`);
  }
  db.function("import_subject_hash", (json: string) => subjectHash(JSON.parse(json) as unknown));
  db.exec(`
    UPDATE human_queue SET subject_hash = import_subject_hash(subject);
    UPDATE events SET payload = json_set(payload, '$.subjectHash', import_subject_hash(payload -> '$.subject')) WHERE type = 'queue.added';
  `);
}

export function resetHistory(project: ProjectDb): void {
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
  const events = project.events();
  const hasArtifact = db.prepare<[string, string, string, string]>("SELECT 1 FROM artifacts WHERE job_id = ? AND run = ? AND name = ? AND type = ?");
  for (const event of events) {
    if (event.type === "confirmation.recorded") continue;
    EventBody.parse(event);
    for (const { artifact: { jobId, run, name, type } } of jobArtifacts([event])) {
      const key: string = `${jobId}/${run}/${name}`;
      if (jobId !== event.jobId || key.split("/").length !== 3 || archivePath(key) !== key || !hasArtifact.get(jobId, run, name, type)) {
        throw new InvalidArchive("pecore.db contains an invalid artifact reference");
      }
    }
    if (event.type === "job.base_change_requested" && !validBase(event.payload.base)) throw new InvalidArchive("pecore.db contains an invalid requested job base");
  }
  db.transaction(() => {
    remapHistory(db);
    const obsolete = db.prepare("SELECT id, job_id FROM human_queue WHERE state = 'open' OR (kind = 'import' AND state = 'resolved' AND choice = 'reject')").all() as { id: string; job_id: string | null }[];
    db.prepare("DELETE FROM events WHERE type = 'confirmation.recorded'").run();
    db.prepare("UPDATE node_runs SET state = 'interrupted', pgid = NULL, os_user = NULL WHERE state = 'running'").run();
    project.append([
      ...obsolete.map(({ id, job_id }): NewEvent => ({ jobId: job_id, type: "queue.resolved", payload: { itemId: id, state: "cancelled", choice: null, note: "the project was imported" } })),
    ]);
  })();
}
