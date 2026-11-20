import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { z } from "zod";
import { Accounts, Node, Profiles, Project, Recipe, Settings, Tiers, unknownPlaceholders } from "@pecore/schemas";
import { checkRecipe } from "./recipe-check";

export type DefinitionError = { file: string; path: string; message: string };

export type Loaded<T> = { value: T | null; errors: DefinitionError[] };

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function readJson(file: string): Promise<{ value: unknown; error: DefinitionError | null }> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (e) {
    return { value: null, error: { file, path: "", message: (e as NodeJS.ErrnoException).code === "ENOENT" ? "file not found" : String(e) } };
  }
  try {
    return { value: JSON.parse(text), error: null };
  } catch (e) {
    return { value: null, error: { file, path: "", message: `invalid JSON: ${(e as Error).message}` } };
  }
}

export function zodErrors(file: string, error: z.ZodError): DefinitionError[] {
  return error.issues.map((i) => ({ file, path: i.path.join("."), message: i.message }));
}

async function parseFile<S extends z.ZodType>(file: string, schema: S, prepare?: (value: unknown) => unknown): Promise<Loaded<z.infer<S>>> {
  const { value, error } = await readJson(file);
  if (error) return { value: null, errors: [error] };
  const r = schema.safeParse(prepare ? prepare(value) : value);
  return r.success ? { value: r.data, errors: [] } : { value: null, errors: zodErrors(file, r.error) };
}

export async function loadNodeFile(file: string): Promise<Loaded<Node>> {
  const loaded = await parseFile(file, Node);
  const node = loaded.value;
  if (!node) return loaded;
  const errors: DefinitionError[] = [];
  const dir = dirname(file);
  if (node.name !== basename(file, ".json")) errors.push({ file, path: "name", message: `name must match the file name ${basename(file, ".json")}` });
  const sidecars: [string, string][] = [];
  if (node.kind === "agent") sidecars.push(["prompt", node.prompt]);
  if (node.kind === "command") {
    if (node.script) sidecars.push(["script", node.script]);
    if (node.probe && !Array.isArray(node.probe)) sidecars.push(["probe.script", node.probe.script]);
    if (node.mergedCheck && !Array.isArray(node.mergedCheck)) sidecars.push(["mergedCheck.script", node.mergedCheck.script]);
  }
  if (node.kind === "source") {
    for (const key of ["list", "read", "comment", "replies"] as const) {
      const s = node[key].script;
      if (s) sidecars.push([`${key}.script`, s]);
    }
  }
  for (const [path, name] of sidecars) {
    if (!(await exists(join(dir, name)))) errors.push({ file, path, message: `${name} not found next to the node file` });
  }
  if (node.kind === "agent" && (await exists(join(dir, node.prompt)))) {
    const prompt = await readFile(join(dir, node.prompt), "utf8");
    for (const p of unknownPlaceholders(prompt)) errors.push({ file: join(dir, node.prompt), path: "", message: `unknown placeholder ${p}` });
  }
  return { value: errors.length ? null : node, errors };
}

export async function loadRecipeFile(file: string): Promise<Loaded<Recipe>> {
  const loaded = await parseFile(file, Recipe);
  if (loaded.value && loaded.value.name !== basename(file, ".json")) {
    return { value: null, errors: [{ file, path: "name", message: `name must match the file name ${basename(file, ".json")}` }] };
  }
  return loaded;
}

async function jsonFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir).catch(() => [] as string[]);
  return entries.filter((f) => f.endsWith(".json")).sort().map((f) => join(dir, f));
}

export type Definitions = {
  nodes: Map<string, Node>;
  recipes: Map<string, Recipe>;
  errors: DefinitionError[];
};

export async function loadDefinitions(dir: string, opts: { checkRecipes: boolean; remote: boolean }): Promise<Definitions> {
  const nodes = new Map<string, Node>();
  const recipes = new Map<string, Recipe>();
  const errors: DefinitionError[] = [];
  for (const file of await jsonFiles(join(dir, "nodes"))) {
    const r = await loadNodeFile(file);
    errors.push(...r.errors);
    if (r.value) nodes.set(r.value.name, r.value);
  }
  const recipeFiles = await jsonFiles(join(dir, "recipes"));
  for (const file of recipeFiles) {
    const r = await loadRecipeFile(file);
    errors.push(...r.errors);
    if (r.value) recipes.set(r.value.name, r.value);
  }
  if (opts.checkRecipes) {
    for (const file of recipeFiles) {
      const recipe = recipes.get(basename(file, ".json"));
      if (recipe) errors.push(...checkRecipe(recipe, nodes, opts.remote).map((e) => ({ file, ...e })));
    }
  }
  return { nodes, recipes, errors };
}

export function loadLibrary(libraryDir: string): Promise<Definitions> {
  return loadDefinitions(libraryDir, { checkRecipes: true, remote: true });
}

export type LoadedProject = Definitions & { project: Project | null };

export async function loadProject(projectDir: string): Promise<LoadedProject> {
  const file = join(projectDir, "project.json");
  const p = await parseFile(file, Project);
  const defs = await loadDefinitions(projectDir, { checkRecipes: true, remote: p.value?.repo !== null });
  const errors = [...p.errors, ...defs.errors];
  const project = p.value;
  if (project) {
    if (project.id !== basename(projectDir)) errors.push({ file, path: "id", message: `id must match the directory name ${basename(projectDir)}` });
    if (project.defaultRecipe !== null && !defs.recipes.has(project.defaultRecipe)) errors.push({ file, path: "defaultRecipe", message: `recipe ${project.defaultRecipe} not found in the project` });
    if (project.createRepo !== null && !defs.nodes.has(project.createRepo)) errors.push({ file, path: "createRepo", message: `node ${project.createRepo} not found in the project` });
    if (project.source !== null) {
      const s = defs.nodes.get(project.source.node);
      if (!s) errors.push({ file, path: "source.node", message: `node ${project.source.node} not found in the project` });
      else if (s.kind !== "source") errors.push({ file, path: "source.node", message: `node ${project.source.node} is not a source node` });
    }
  }
  return { ...defs, project, errors };
}

async function parseOptional<S extends z.ZodType>(file: string, schema: S, prepare?: (value: unknown) => unknown): Promise<Loaded<z.infer<S>>> {
  if (!(await exists(file))) {
    const r = schema.safeParse({});
    return r.success ? { value: r.data, errors: [] } : { value: null, errors: zodErrors(file, r.error) };
  }
  return parseFile(file, schema, prepare);
}

export type Global = { settings: Settings; accounts: Accounts; profiles: Profiles; tiers: Tiers };

export async function loadGlobal(home: string): Promise<{ value: Global | null; errors: DefinitionError[] }> {
  const [settings, accounts, profiles, tiers] = await Promise.all([
    parseOptional(join(home, "settings.json"), Settings, (value) => {
      if (value !== null && typeof value === "object") {
        for (const key of ["firstRunDone", "prices", "projectPaths", "programPaths"]) Reflect.deleteProperty(value, key);
        if ("limits" in value && value.limits !== null && typeof value.limits === "object") Reflect.deleteProperty(value.limits, "providers");
      }
      return value;
    }),
    parseOptional(join(home, "accounts.json"), Accounts),
    parseOptional(join(home, "profiles.json"), Profiles),
    parseOptional(join(home, "tiers.json"), Tiers),
  ]);
  const errors = [...settings.errors, ...accounts.errors, ...profiles.errors, ...tiers.errors];
  if (!settings.value || !accounts.value || !profiles.value || !tiers.value) return { value: null, errors };
  const g = { settings: settings.value, accounts: accounts.value, profiles: profiles.value, tiers: tiers.value };
  const accountIds = new Set(g.accounts.accounts.map((a) => a.id));
  const profileIds = new Set(g.profiles.profiles.map((p) => p.id));
  for (const [i, p] of g.profiles.profiles.entries()) {
    const acc = g.accounts.accounts.find((a) => a.id === p.account);
    if (!accountIds.has(p.account)) errors.push({ file: join(home, "profiles.json"), path: `profiles.${i}.account`, message: `account ${p.account} not found` });
    else if (acc?.kind !== "model") errors.push({ file: join(home, "profiles.json"), path: `profiles.${i}.account`, message: `account ${p.account} is not a model account` });
  }
  for (const [tier, list] of Object.entries(g.tiers.tiers)) {
    for (const [i, id] of list.entries()) {
      if (!profileIds.has(id)) errors.push({ file: join(home, "tiers.json"), path: `tiers.${tier}.${i}`, message: `profile ${id} not found` });
    }
  }
  return { value: errors.length ? null : g, errors };
}
