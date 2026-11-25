import { stripRecipeAnchors } from "@pecore/schemas";
import type { JobDefinitions } from "@pecore/schemas";
import type Database from "better-sqlite3";
import { definitionHash } from "../definitions/snapshot";

type Row = { id: string; recipe: string };
type SavedEvent = { id: string; job_id: string; type: string; payload: string };

export function migrateRecipeAnchors(db: Database.Database, sql: string, project: boolean): void {
  db.exec(sql);
  if (!project) return;
  const hashes: Map<string, string> = new Map();
  const strip = (recipe: object): object => {
    const current: object = stripRecipeAnchors(recipe);
    if (JSON.stringify(recipe) !== JSON.stringify(current)) hashes.set(definitionHash(recipe), definitionHash(current));
    return current;
  };
  const saveJob = db.prepare("UPDATE jobs SET recipe = ? WHERE id = ?");
  for (const { id, recipe } of db.prepare<[], Row>("SELECT id, recipe FROM jobs").all()) {
    const updated: string = JSON.stringify(strip(JSON.parse(recipe) as object));
    if (updated !== recipe) saveJob.run(updated, id);
  }
  const events: SavedEvent[] = db.prepare<[], SavedEvent>(
    "SELECT id, job_id, type, payload FROM events WHERE job_id IS NOT NULL AND type IN ('job.created', 'job.definitions_saved') ORDER BY id").all();
  const saveEvent = db.prepare("UPDATE events SET payload = ? WHERE id = ?");
  const updateHash = (definitions: JobDefinitions): void => {
    definitions.recipeHash = hashes.get(definitions.recipeHash) ?? definitions.recipeHash;
  };
  for (const event of events) {
    if (event.type === "job.created") {
      const job = JSON.parse(event.payload) as { recipe: object; definitions?: JobDefinitions };
      job.recipe = strip(job.recipe);
      if (job.definitions) updateHash(job.definitions);
      saveEvent.run(JSON.stringify(job), event.id);
    } else {
      const definitions: JobDefinitions = JSON.parse(event.payload);
      updateHash(definitions);
      saveEvent.run(JSON.stringify(definitions), event.id);
    }
  }
}
