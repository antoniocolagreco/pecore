import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import type { OutcomeLookup } from "../definitions/outcomes";
import { migrateOutcomes } from "./migrate-outcomes";
import { migrateRecipeAnchors } from "./migrate-recipe-anchors";
import { migrateAgentTrackers } from "./migrate-agent-tracker";

const migrationsDir = fileURLToPath(new URL("./migrations/", import.meta.url));

export function migrate(db: Database.Database, prefix: string, options?: { inherited?: Database.Database; archivedOutcomes?: OutcomeLookup }): number {
  const files = readdirSync(migrationsDir)
    .map((f) => ({ f, m: new RegExp(`^(?:${prefix}|shared-)(\\d{3})-.*\\.sql$`).exec(f) }))
    .filter((x): x is { f: string; m: RegExpExecArray } => x.m !== null)
    .map(({ f, m }) => ({ file: f, version: Number(m[1]) }))
    .sort((a, b) => a.version - b.version);
  const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'").get();
  let current = hasTable ? ((db.prepare("SELECT max(version) AS v FROM schema_version").get() as { v: number | null }).v ?? 0) : 0;
  for (const { file, version } of files) {
    if (version <= current) continue;
    db.transaction(() => {
      const sql: string = readFileSync(migrationsDir + file, "utf8");
      if (file === "shared-031-node-outcomes.sql") migrateOutcomes(db, sql, prefix === "", options);
      else if (file === "shared-033-drop-recipe-anchors.sql") migrateRecipeAnchors(db, sql, prefix === "");
      else if (file === "shared-034-agent-tracker-access.sql") {
        if (!db.prepare("SELECT 1 FROM pragma_table_info('catalog_nodes') WHERE name = 'agent_tracker_access'").get()) db.exec(sql);
      }
      else if (file === "shared-035-remove-tracker-nodes.sql") migrateAgentTrackers(db, sql, prefix === "");
      else db.exec(sql);
      db.prepare("DELETE FROM schema_version").run();
      db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(version);
    })();
    current = version;
  }
  return current;
}
