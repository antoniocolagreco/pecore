import { Recipe } from "@pecore/schemas";
import type { JobDefinitions, Node } from "@pecore/schemas";
import type { Catalog } from "../store/catalog";
import type { NewEvent, ProjectDb } from "../store/project-db";
import { nodeSidecars } from "./load";
import type { LoadedProject } from "./load";
import { definitionHash, jobDefinitions, snapshotDefinitions, snapshotNode } from "./snapshot";

function chooseContent(catalog: Catalog, name: string, alternate: string, content: string): string {
  const initial: string | null = catalog.content(name);
  if (initial === null || initial === content) return name;
  for (let index: number = 1; ; index++) {
    const candidate: string = index === 1 ? alternate : `${index}-${alternate}`;
    const existing: string | null = catalog.content(candidate);
    if (existing === null || existing === content) return candidate;
  }
}

function rewriteSidecar(node: Node, field: string, file: string): void {
  if (node.kind === "agent") node.prompt = file;
  if (node.kind === "command") {
    if (field === "script") node.script = file;
    else if (field === "probe.script") node.probe = { script: file };
    else node.mergedCheck = { script: file };
  }
}

function importNode(catalog: Catalog, source: JobDefinitions["nodes"][string], differences: string[]): void {
  const node: Node = structuredClone(source.definition);
  const sidecars: Map<string, string> = new Map();
  for (const [field, name] of nodeSidecars(node)) {
    const content: string = source.sidecars[name]!;
    const key: string = chooseContent(catalog, name, `${node.name}-${name}`, content);
    rewriteSidecar(node, field, key);
    sidecars.set(key, content);
  }
  const before: Node | null = catalog.node(node.name);
  if (before) {
    const saved: Record<string, string | null> = Object.fromEntries(nodeSidecars(before).map(([, key]) => [key, catalog.content(key)]));
    if (definitionHash({ definition: before, sidecars: saved }) !== definitionHash({ definition: node, sidecars: Object.fromEntries(sidecars) })) {
      differences.push(`nodes/${node.name}.json`);
    }
    return;
  }
  for (const [key, body] of sidecars) if (catalog.content(key) === null) catalog.saveContent(key, body);
  catalog.saveNode(node);
}

export async function importCatalog(catalog: Catalog, loaded: LoadedProject): Promise<string[]> {
  const snapshots: JobDefinitions["nodes"][string][] = await Promise.all(
    [...loaded.nodes.values()].map((node) => snapshotNode(node, loaded.nodeDir, loaded.sidecars)),
  );
  const differences: string[] = [];
  catalog.db.transaction(() => {
    for (const snapshot of snapshots) importNode(catalog, snapshot, differences);
    for (const recipe of loaded.recipes.values()) {
      const before: Recipe | null = catalog.recipe(recipe.name);
      if (before === null) catalog.saveRecipe(recipe);
      else if (definitionHash(before) !== definitionHash(recipe)) differences.push(`recipes/${recipe.name}.json`);
    }
  })();
  return differences;
}

export async function saveLegacyJobDefinitions(loaded: LoadedProject, db: ProjectDb): Promise<void> {
  const rows = db.db.prepare("SELECT id, recipe FROM jobs").all() as { id: string; recipe: string }[];
  const legacy: NewEvent[] = [];
  for (const row of rows) {
    if (jobDefinitions(db, row.id)) continue;
    const recipe: Recipe = Recipe.parse(JSON.parse(row.recipe));
    if (Object.values(recipe.nodes).some(({ use }) => !loaded.nodes.has(use))) continue;
    legacy.push({ jobId: row.id, type: "job.definitions_saved", payload: await snapshotDefinitions(recipe, loaded.nodes, loaded.nodeDir) });
  }
  if (legacy.length) db.append(legacy);
}
