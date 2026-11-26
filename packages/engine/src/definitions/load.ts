import { projectDefaults, recipeForForge } from "../projects/defaults";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { z } from "zod";
import { Node, Project, Recipe, unknownPlaceholders, upgradeLegacyNode } from "@pecore/schemas";
import type { Accounts, AgentDefinitions, Profiles, Settings, Tiers } from "@pecore/schemas";
import { checkRecipe } from "./recipe-check";
import type { Catalog } from "../store/catalog";

export type DefinitionError = { file: string; path: string; message: string; line?: number; column?: number; length?: number };

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

export function nodeSidecars(node: Node): [string, string][] {
  const sidecars: [string, string][] = [];
  if (node.kind === "agent") sidecars.push(["prompt", node.prompt]);
  if (node.kind === "command" && node.script) sidecars.push(["script", node.script]);
  if (node.kind === "repository") {
    if (node.probe && !Array.isArray(node.probe)) sidecars.push(["repeat check", node.probe.script]);
    if (node.mergedCheck && !Array.isArray(node.mergedCheck)) sidecars.push(["merge check", node.mergedCheck.script]);
  }
  return sidecars;
}

export async function loadNodeFile(file: string): Promise<Loaded<Node>> {
  const { value, error } = await readJson(file);
  if (error) return { value: null, errors: [error] };
  const sidecars: Record<string, string> = {};
  if (value && typeof value === "object" && "runsAs" in value && value.runsAs === "engine" &&
      "script" in value && typeof value.script === "string" && /^[A-Za-z0-9._-]+\.sh$/.test(value.script)) {
    const body: string | undefined = await readFile(join(dirname(file), value.script), "utf8").catch(() => undefined);
    if (body !== undefined) sidecars[value.script] = body;
  }
  const result = Node.safeParse(upgradeLegacyNode(value, sidecars));
  const loaded: Loaded<Node> = result.success ? { value: result.data, errors: [] } : { value: null, errors: zodErrors(file, result.error) };
  const node = loaded.value;
  if (!node) return loaded;
  const errors: DefinitionError[] = [];
  const dir = dirname(file);
  if (node.name !== basename(file, ".json")) errors.push({ file, path: "name", message: `name must match the file name ${basename(file, ".json")}` });
  for (const [path, name] of nodeSidecars(node)) {
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
  nodeDir: string;
  nodes: Map<string, Node>;
  recipes: Map<string, Recipe>;
  sidecars?: Readonly<Record<string, string>>;
  errors: DefinitionError[];
};

function catalogDefinitions(dir: string, catalog: Catalog, opts: { checkRecipes: boolean; remote: boolean }): Definitions {
  const nodeDir: string = join(dir, "nodes");
  const errors: DefinitionError[] = [];
  const nodes: Map<string, Node> = new Map();
  const recipes: Map<string, Recipe> = new Map();
  const sidecars: Record<string, string> = Object.fromEntries(catalog.names("node_content").map((name) => [name, catalog.content(name)!]));
  for (const name of catalog.names("nodes")) {
    const node: Node = catalog.node(name)!;
    const file: string = join(nodeDir, `${name}.json`);
    const issues: DefinitionError[] = nodeSidecars(node).filter(([, name]) => !Object.hasOwn(sidecars, name))
      .map(([path, name]) => ({ file, path, message: `${name} has no saved content` }));
    if (node.kind === "agent" && Object.hasOwn(sidecars, node.prompt)) {
      for (const p of unknownPlaceholders(sidecars[node.prompt]!)) issues.push({ file, path: "prompt", message: `unknown placeholder ${p}` });
    }
    if (issues.length) errors.push(...issues);
    else nodes.set(name, node);
  }
  for (const name of catalog.names("recipes")) {
    const recipe: Recipe = catalog.recipe(name)!;
    if (opts.checkRecipes) {
      const file: string = join(dir, "recipes", `${name}.json`);
      errors.push(...checkRecipe(recipe, nodes, opts.remote).map((issue) => ({ file, ...issue })));
    }
    recipes.set(name, recipe);
  }
  return { nodeDir, nodes, recipes, sidecars, errors };
}

export async function loadDefinitions(dir: string, opts: { checkRecipes: boolean; remote: boolean; legacyProject?: boolean }): Promise<Definitions> {
  const nodes = new Map<string, Node>();
  const recipes = new Map<string, Recipe>();
  const errors: DefinitionError[] = [];
  for (const file of await jsonFiles(join(dir, "nodes"))) {
    if (opts.legacyProject) {
      const { value } = await readJson(file);
      if (value && typeof value === "object" && "kind" in value && value.kind === "source") continue;
    }
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
  return { nodeDir: join(dir, "nodes"), nodes, recipes, errors };
}

export async function loadTemplates(templatesDir: string, catalog?: Catalog): Promise<Definitions> {
  const options = { checkRecipes: true, remote: true };
  return catalog ? catalogDefinitions(templatesDir, catalog, options) : loadDefinitions(templatesDir, options);
}

export type LoadedProject = Definitions & { project: Project | null };

export async function loadProject(projectDir: string, templatesDir?: string, stored?: Project | null, catalogs?: { global: Catalog; project: Catalog }, forge?: string): Promise<LoadedProject> {
  const file = join(projectDir, "project.json");
  const p: Loaded<Project> = stored === undefined ? await parseFile(file, Project) :
    { value: stored, errors: stored === null ? [{ file, path: "", message: "project definition not found in pecore.db" }] : [] };
  const shared: boolean = templatesDir !== undefined && p.value?.recipes !== undefined;
  const root: string = shared ? templatesDir! : projectDir;
  const options = { checkRecipes: !shared, remote: p.value?.repo !== null };
  const defs: Definitions = catalogs
    ? catalogDefinitions(root, shared ? catalogs.global : catalogs.project, options)
    : await loadDefinitions(root, { ...options, legacyProject: !shared });
  const errors = shared ? [...p.errors] : [...p.errors, ...defs.errors];
  const project = p.value;
  if (project) {
    if (shared) {
      const available: Map<string, Recipe> = new Map(defs.recipes);
      defs.recipes.clear();
      const defaults = forge && project.repo ? await projectDefaults(templatesDir!, project.repo, forge) : null;
      for (const name of project.recipes ?? []) {
        const template: Recipe | undefined = available.get(name);
        const recipe: Recipe | undefined = template && recipeForForge(template, defaults?.rename ?? {});
        if (recipe) {
          defs.recipes.set(name, recipe);
          errors.push(...checkRecipe(recipe, defs.nodes, project.repo !== null).map((issue) => ({ file: join(templatesDir!, "recipes", `${name}.json`), ...issue })));
        } else errors.push({ file, path: "recipes", message: `recipe template ${name} not found` });
      }
    }
    if (project.id !== basename(projectDir)) errors.push({ file, path: "id", message: `id must match the directory name ${basename(projectDir)}` });
    if (project.createRepo !== null && !defs.nodes.has(project.createRepo)) errors.push({ file, path: "createRepo", message: `node ${project.createRepo} not found in the project` });
  }
  return { ...defs, project, errors };
}

export type Global = { settings: Settings; agents: AgentDefinitions; accounts: Accounts; profiles: Profiles; tiers: Tiers };

export function validateGlobal(g: Global): DefinitionError[] {
  const errors: DefinitionError[] = [];
  const accountIds = new Set(g.accounts.accounts.map((a) => a.id));
  const profileIds = new Set(g.profiles.profiles.map((p) => p.id));
  for (const [i, p] of g.profiles.profiles.entries()) {
    const acc = g.accounts.accounts.find((a) => a.id === p.account);
    if (!accountIds.has(p.account)) errors.push({ file: "profiles", path: `profiles.${i}.account`, message: `account ${p.account} not found` });
    else if (acc?.kind !== "model") errors.push({ file: "profiles", path: `profiles.${i}.account`, message: `account ${p.account} is not a model account` });
  }
  for (const [i, agent] of g.agents.agents.entries()) {
    if (agent.kind === "agent" && agent.model && !g.accounts.accounts.some(({ id, kind }) => id === agent.model?.account && kind === "model")) {
      errors.push({ file: "agents", path: `agents.${i}.model.account`, message: `model account ${agent.model.account} not found` });
    }
  }
  for (const [tier, list] of Object.entries(g.tiers.tiers)) {
    for (const [i, id] of list.entries()) {
      if (!profileIds.has(id)) errors.push({ file: "tiers", path: `tiers.${tier}.${i}`, message: `profile ${id} not found` });
    }
  }
  return errors;
}
