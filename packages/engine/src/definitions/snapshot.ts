import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { JobDefinitions } from "@pecore/schemas";
import type { Node, Recipe } from "@pecore/schemas";
import type { ProjectDb } from "../store/project-db";
import { nodeSidecars } from "./load";

export function definitionHash(content: unknown): string {
  const json: string = JSON.stringify(content, (_key, value: unknown) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  });
  return createHash("sha256").update(json).digest("hex");
}

export async function snapshotNode(definition: Node, dir: string): Promise<JobDefinitions["nodes"][string]> {
  const names: Set<string> = new Set(nodeSidecars(definition).map(([, name]) => name));
  const sidecars: Record<string, string> = Object.fromEntries(
    await Promise.all([...names].map(async (name) => [name, await readFile(join(dir, name), "utf8")] as const)),
  );
  return { definition, sidecars, hash: definitionHash({ definition, sidecars }) };
}

export async function snapshotDefinitions(recipe: Recipe, nodes: Map<string, Node>, dir: string): Promise<JobDefinitions> {
  const names: Set<string> = new Set(Object.values(recipe.nodes).map(({ use }) => use));
  const entries: [string, JobDefinitions["nodes"][string]][] = await Promise.all([...names].map(async (name) => {
    const node: Node | undefined = nodes.get(name);
    if (!node) throw new Error(`node ${name} not found`);
    return [name, await snapshotNode(node, dir)];
  }));
  return { recipeHash: definitionHash(recipe), nodes: Object.fromEntries(entries) };
}

export function jobDefinitions(db: ProjectDb, jobId: string): JobDefinitions | null {
  const row = db.db.prepare(`SELECT CASE type WHEN 'job.created' THEN payload -> '$.definitions' ELSE payload END AS definitions
    FROM events WHERE type IN ('job.created', 'job.definitions_saved') AND job_id = ? ORDER BY id DESC LIMIT 1`).get(jobId) as { definitions: string | null } | undefined;
  return row?.definitions ? JobDefinitions.parse(JSON.parse(row.definitions)) : null;
}

export function jobNodes(snapshot: JobDefinitions | null, fallback: Map<string, Node>): Map<string, Node> {
  if (!snapshot) return fallback;
  return new Map(Object.entries(snapshot.nodes).map(([name, entry]) => [name, entry.definition]));
}
