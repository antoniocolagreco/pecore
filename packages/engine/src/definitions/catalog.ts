import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Recipe } from "@pecore/schemas";
import type { JobDefinitions, Node, Project } from "@pecore/schemas";
import type { NewEvent, ProjectDb } from "../store/project-db";
import { commitDefinition } from "../home/git-commit";
import { loadNodeFile, loadRecipeFile, nodeSidecars } from "./load";
import type { LoadedProject } from "./load";
import { definitionHash, jobDefinitions, snapshotDefinitions, snapshotNode } from "./snapshot";

const nodeSchema: string = "../../schemas/node.json";
const recipeSchema: string = "../../schemas/recipe.json";

async function bytes(file: string): Promise<string | null> {
  const info = await lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!info) return null;
  if (!info.isFile()) throw new Error(`${file} must be a regular file`);
  return readFile(file, "utf8");
}

async function chooseFile(dir: string, name: string, alternate: string, content: string): Promise<string> {
  const initial: string | null = await bytes(join(dir, name));
  if (initial === null || initial === content) return name;
  for (let index: number = 1; ; index++) {
    const candidate: string = index === 1 ? alternate : `${index}-${alternate}`;
    const existing: string | null = await bytes(join(dir, candidate));
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
  if (node.kind === "source") {
    const action = field.split(".")[0] as "list" | "read" | "comment" | "replies";
    node[action].script = file;
  }
}

function nameFor(name: string, project: string, attempt: number): string {
  if (attempt === 0) return name;
  return attempt === 1 ? `${name}-${project}` : `${name}-${project}-${attempt}`;
}

async function saveNode(dir: string, source: JobDefinitions["nodes"][string], project: string, written: string[], differences?: string[]): Promise<string> {
  for (let attempt: number = 0; ; attempt++) {
    const node: Node = structuredClone(source.definition);
    node.name = nameFor(node.name, project, attempt);
    node.$schema = nodeSchema;
    const path: string = join(dir, `${node.name}.json`);
    const before: string | null = await bytes(path);
    const sidecars: Map<string, string> = new Map();
    for (const [field, name] of nodeSidecars(node)) {
      const content: string = source.sidecars[name]!;
      const file: string = await chooseFile(dir, name, `${node.name}-${name}`, content);
      rewriteSidecar(node, field, file);
      sidecars.set(file, content);
    }
    if (before !== null) {
      const existing = await loadNodeFile(path);
      if (existing.value) {
        const stored = await snapshotNode({ ...existing.value, $schema: nodeSchema }, dir);
        if (stored.hash === definitionHash({ definition: node, sidecars: Object.fromEntries(sidecars) })) return node.name;
      }
      if (differences) {
        differences.push(`nodes/${node.name}.json`);
        return node.name;
      }
      continue;
    }
    for (const [file, content] of sidecars) {
      const target: string = join(dir, file);
      if (await bytes(target) !== null) continue;
      await writeFile(target, content, { flag: "wx" });
      written.push(target);
    }
    await writeFile(path, JSON.stringify(node, null, 2) + "\n", { flag: "wx" });
    written.push(path);
    return node.name;
  }
}

async function saveRecipe(dir: string, source: Recipe, project: string, written: string[], differences?: string[]): Promise<string> {
  for (let attempt: number = 0; ; attempt++) {
    const name: string = nameFor(source.name, project, attempt);
    const recipe: Recipe = { ...source, $schema: recipeSchema, name };
    const path: string = join(dir, `${name}.json`);
    const before: string | null = await bytes(path);
    if (before === null) {
      await writeFile(path, JSON.stringify(recipe, null, 2) + "\n", { flag: "wx" });
      written.push(path);
      return name;
    }
    const existing = await loadRecipeFile(path);
    if (existing.value && definitionHash({ ...existing.value, $schema: recipeSchema }) === definitionHash(recipe)) return name;
    if (differences) {
      differences.push(`recipes/${name}.json`);
      return name;
    }
  }
}

export async function importCatalog(home: string, templates: string, loaded: LoadedProject): Promise<string[]> {
  const written: string[] = [];
  const differences: string[] = [];
  for (const node of loaded.nodes.values()) {
    const snapshot = await snapshotNode(node, loaded.nodeDir);
    await saveNode(join(templates, "nodes"), snapshot, "", written, differences);
  }
  for (const recipe of loaded.recipes.values()) await saveRecipe(join(templates, "recipes"), recipe, "", written, differences);
  if (written.length > 0) await commitDefinition(home, written, "templates: import project definitions");
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

export async function migrateProjectDefinitions(home: string, dir: string, templates: string, loaded: LoadedProject, db: ProjectDb): Promise<void> {
  const project: Project | null = loaded.project;
  if (!project || project.recipes !== undefined) return;
  if (loaded.errors.length > 0) throw new Error("Fix the project definitions before moving them to Templates.");
  await saveLegacyJobDefinitions(loaded, db);

  const written: string[] = [];
  const nodeDir: string = join(templates, "nodes");
  const recipeDir: string = join(templates, "recipes");
  await mkdir(nodeDir, { recursive: true });
  await mkdir(recipeDir, { recursive: true });
  const names: Map<string, string> = new Map();
  for (const node of loaded.nodes.values()) {
    const snapshot = await snapshotNode(node, loaded.nodeDir);
    names.set(node.name, await saveNode(nodeDir, snapshot, project.id, written));
  }
  const recipes: string[] = [];
  for (const recipe of loaded.recipes.values()) {
    const nodes: Recipe["nodes"] = Object.fromEntries(Object.entries(recipe.nodes).map(([id, step]) => [id, { ...step, use: names.get(step.use)! }]));
    recipes.push(await saveRecipe(recipeDir, { ...recipe, nodes }, project.id, written));
  }
  const next: Project = { ...project, recipes, createRepo: project.createRepo && names.get(project.createRepo) || null,
    source: project.source && { ...project.source, node: names.get(project.source.node)! } };
  const file: string = join(dir, "project.json");
  const staged: string = join(dir, ".project-templates.json");
  await writeFile(staged, JSON.stringify(next, null, 2) + "\n");
  if (written.length > 0) await commitDefinition(home, written, `templates: migrate ${project.id}`);
  await rename(staged, file);
  for (const name of ["nodes", "recipes"]) await rm(join(dir, name), { recursive: true, force: true });
  await commitDefinition(home, [dir], `project ${basename(dir)}: use shared templates`);
}
