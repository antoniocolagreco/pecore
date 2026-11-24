import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";

const migrationsDir = fileURLToPath(new URL("./migrations/", import.meta.url));

export function migrate(db: Database.Database, prefix: string): number {
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
      db.exec(readFileSync(migrationsDir + file, "utf8"));
      db.prepare("DELETE FROM schema_version").run();
      db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(version);
    })();
    current = version;
  }
  return current;
}
