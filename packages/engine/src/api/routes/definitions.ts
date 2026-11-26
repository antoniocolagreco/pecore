import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { KnowledgeFileName, Name, Node, Project, projectManagerClash, Recipe } from "@pecore/schemas";
import type { DefinitionEntry, InstantiateBody, RouteOutput } from "@pecore/schemas";
import { validIcon } from "../../definitions/icon";
import { checkKnowledge, knowledgeLinks, knowledgeNames, removeBrokenKnowledgeLinks, renameKnowledgeLinks } from "../../definitions/knowledge";
import type { KnowledgeIssue } from "../../definitions/knowledge";
import { loadTemplates, nodeSidecars, zodErrors } from "../../definitions/load";
import type { DefinitionError } from "../../definitions/load";
import { checkRecipe } from "../../definitions/recipe-check";
import { isFinal } from "../../graph/job-machine";
import { homePaths } from "../../home/layout";
import { NotFoundError } from "../../main";
import type { Engine } from "../../main";
import { forgeAccountOf, ProjectCreateError } from "../../projects/create";
import { loadForgeDefaults, projectDefaults, recipeForForge } from "../../projects/defaults";
import { absoluteProjectFolder, changeProjectLocation, ProjectLocationConflict, sameRepository } from "../../projects/location";
import type { Catalog } from "../../store/catalog";
import { HttpError } from "../server";
import type { Handlers } from "../server";

type DefinitionKind = "node" | "recipe" | "project" | "knowledge" | "prompt" | "script" | "icon";
type Inspection = Pick<DefinitionEntry, "value" | "errors"> & { warnings?: DefinitionError[] };
const pendingDefinitions: WeakMap<Engine, Promise<unknown>> = new WeakMap();

function knowledgeInspection(path: string, content: string, names: ReadonlySet<string>): Inspection {
  const { errors, warnings, links } = checkKnowledge(content, names);
  const view = (issue: KnowledgeIssue): DefinitionError => ({
    file: path, path: "", message: `line ${issue.line}: ${issue.message}`, line: issue.line, column: issue.column, length: issue.length,
  });
  return { value: { links }, errors: errors.map(view), warnings: warnings.map(view) };
}

function pathParts(path: string): string[] {
  const parts: string[] = path.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.includes("\\") || part.includes("\0"))) {
    throw new HttpError("bad_request", `invalid definition path ${path}`);
  }
  return parts;
}

function fileKind(directory: string, file: string): DefinitionKind | undefined {
  const ext: string = extname(file);
  if (directory === "knowledge" && ext === ".md") return "knowledge";
  if (directory === "nodes" && ext === ".md") return "prompt";
  if (directory === "nodes" && ext === ".sh") return "script";
  if (directory === "icons" && ext === ".svg" && Name.safeParse(basename(file, ext)).success) return "icon";
  if (ext !== ".json" || !Name.safeParse(basename(file, ext)).success) return;
  if (directory === "nodes") return "node";
  if (directory === "recipes") return "recipe";
}

function projectContext(engine: Engine, id: string) {
  const project = engine.projects.get(id);
  if (!project) throw new NotFoundError(`project ${id} not found`);
  return project.ctx;
}

async function optionalBytes(file: string): Promise<Buffer | null> {
  try {
    return await readFile(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function lstatOrNull(path: string) {
  return lstat(path).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return null;
    throw e;
  });
}

async function rejectSymlinks(root: string, file: string): Promise<void> {
  let current: string = root;
  for (const part of relative(root, file).split(sep)) {
    current = join(current, part);
    const info = await lstatOrNull(current);
    if (!info) return;
    if (info.isSymbolicLink()) throw new HttpError("bad_request", "definition paths cannot include symbolic links");
  }
}

async function definitionFiles(dir: string, directory: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return [];
    throw e;
  });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.includes("\\")) continue;
    if (directory === "knowledge" && !KnowledgeFileName.safeParse(entry.name).success) continue;
    if (entry.isFile() && fileKind(directory, entry.name)) files.push(entry.name);
  }
  return files;
}

export function definitionHandlers(engine: Engine) {
  return definitionOperations(engine).handlers;
}

export function definitionOperations(engine: Engine) {
  const home = homePaths(resolve(engine.opts.home));

  function mutate<T>(action: () => Promise<T>): Promise<T> {
    const result: Promise<T> = (pendingDefinitions.get(engine) ?? Promise.resolve()).then(action);
    pendingDefinitions.set(engine, result.catch(() => undefined));
    return result;
  }

  function location(path: string, listing: boolean) {
    const parts: string[] = pathParts(path);
    const file: string = listing ? "" : parts.pop()!;
    const [scope, subdir, projectSection, ...nested] = parts;
    const id: string | undefined = scope === "projects" ? subdir : undefined;
    const directory: string = (id ? projectSection : scope === "templates" ? subdir : scope) ?? "";
    const projectFile: boolean = !!id && parts.length === 2 && file === "project.json";
    const definitionDirectory: boolean = directory === "nodes" || directory === "recipes";
    const projectDirectory: boolean = !!id && (
      (definitionDirectory && parts.length === 3) ||
      (directory === "knowledge" && nested.length === 0)
    );
    const homeDirectory: string | undefined =
      scope === "templates" && parts.length === 2 && (definitionDirectory || directory === "icons")
        ? join(home.templates, directory)
        : undefined;
    const kind: DefinitionKind | undefined = projectFile ? "project" : fileKind(directory, file);
    if ((!projectFile && !projectDirectory && !homeDirectory) || (!listing && !kind)) {
      throw new HttpError("bad_request", `invalid definition path ${path}`);
    }
    const knowledgeName = kind === "knowledge" ? KnowledgeFileName.safeParse(file) : undefined;
    if (knowledgeName && !knowledgeName.success) {
      throw new HttpError("bad_request", `invalid knowledge file name ${file}: ${knowledgeName.error.issues[0]?.message ?? "invalid"}`);
    }
    let catalog: Catalog | undefined = homeDirectory ? engine.catalog : undefined;
    if (id) {
      const ctx = projectContext(engine, id);
      if (definitionDirectory && ctx.project.recipes !== undefined) throw new HttpError("bad_request", "Edit nodes and recipes in Templates.");
      if (definitionDirectory) catalog = ctx.db.catalog;
    }
    const projectDir: string | undefined = id ? resolve(engine.projectDir(id)) : undefined;
    const root: string = projectDir ?? home.home;
    const dir: string = projectDir ? join(projectDir, ...parts.slice(2)) : homeDirectory!;
    const absPath: string = join(dir, file);
    return { id, projectDir, root, absPath, directory, kind, file, catalog };
  }

  async function definitionBytes(target: ReturnType<typeof location>): Promise<Buffer | null> {
    if (target.kind === "project" && target.id) {
      const stored: Project | null = projectContext(engine, target.id).db.definition.read();
      return stored === null ? null : Buffer.from(JSON.stringify(stored, null, 2) + "\n");
    }
    if (target.catalog) {
      const { catalog, kind, file } = target;
      const stored: Node | Recipe | string | null = kind === "node" ? catalog.node(basename(file, ".json"))
        : kind === "recipe" ? catalog.recipe(basename(file, ".json")) : kind === "icon" ? catalog.icon(file) : catalog.content(file);
      return stored === null ? null : Buffer.from(typeof stored === "string" ? stored : JSON.stringify(stored, null, 2) + "\n");
    }
    await rejectSymlinks(target.root, target.absPath);
    return optionalBytes(target.absPath);
  }

  function inspect(path: string, kind: DefinitionKind | undefined, id: string | undefined, content: string): Pick<DefinitionEntry, "value" | "errors"> {
    const errors: DefinitionError[] = [];
    if (kind === "knowledge") return { value: { links: knowledgeLinks(content) }, errors };
    if (kind === "prompt" || kind === "script") return { value: null, errors };
    if (kind === "icon") return validIcon(content)
      ? { value: content, errors }
      : { value: null, errors: [{ file: path, path: "", message: "Use an SVG with a viewBox and basic shapes only." }] };
    let value: unknown;
    try {
      value = JSON.parse(content);
    } catch (e) {
      return { value: null, errors: [{ file: path, path: "", message: `invalid JSON: ${(e as Error).message}` }] };
    }
    if (kind === "recipe") {
      const result = Recipe.safeParse(value);
      if (!result.success) return { value, errors: zodErrors(path, result.error) };
      if (result.data.name !== basename(path, ".json")) errors.push({ file: path, path: "name", message: `name must match the file name ${basename(path, ".json")}` });
      if (id) {
        const ctx = projectContext(engine, id);
        errors.push(...checkRecipe(result.data, ctx.defs.nodes, ctx.project.repo !== null).map((issue) => ({ file: path, ...issue })));
      }
      return { value, errors };
    }
    const schema = kind === "node" ? Node : Project;
    const result = schema.safeParse(value);
    if (!result.success) return { value, errors: zodErrors(path, result.error) };
    const name: string = basename(path, ".json");
    if (kind === "node" && "name" in result.data && result.data.name !== name) {
      errors.push({ file: path, path: "name", message: `name must match the file name ${name}` });
    }
    if (kind === "project" && "id" in result.data && result.data.id !== id) {
      errors.push({ file: path, path: "id", message: `id must match the directory name ${id}` });
    }
    if (kind === "node" && "tags" in result.data) {
      const fields = value as Record<string, unknown>;
      return { value: Array.isArray(fields.tags) ? { ...fields, tags: result.data.tags } : fields, errors };
    }
    return { value, errors };
  }

  function knowledgeDir(id: string): string {
    projectContext(engine, id);
    return join(resolve(engine.projectDir(id)), "knowledge");
  }

  async function inspectWritable(path: string, kind: DefinitionKind | undefined, id: string | undefined, content: string): Promise<Inspection> {
    if (kind === "knowledge" && id) {
      const names = new Set<string>(await knowledgeNames(knowledgeDir(id)));
      names.add(basename(path));
      return knowledgeInspection(path, content, names);
    }
    const inspected = inspect(path, kind, id, content);
    if (kind !== "recipe" || id || inspected.errors.length) return inspected;
    const recipe: Recipe = Recipe.parse(inspected.value);
    if (recipe.ends === undefined) return inspected;
    const { nodes } = await loadTemplates(home.templates, engine.catalog);
    return { value: inspected.value, errors: checkRecipe(recipe, nodes, true).map((issue) => ({ file: path, ...issue })) };
  }

  async function nodeTemplateUsers(name: string): Promise<string[]> {
    const users: string[] = [];
    for (const recipe of engine.catalog.names("recipes")) {
      if (Object.values(engine.catalog.recipe(recipe)!.nodes).some(({ use }) => use === name)) users.push(`recipe ${recipe}`);
    }
    for (const { ctx } of engine.projects.values()) {
      if (ctx.project.recipes !== undefined) {
        if (ctx.project.createRepo === name) users.push(`project ${ctx.id}`);
      } else {
        for (const recipe of ctx.defs.recipes.values()) {
          if (Object.values(recipe.nodes).some((step) => step.use === name)) users.push(`recipe ${recipe.name} in project ${ctx.id}`);
        }
      }
    }
    const forges: string[] = await readdir(join(engine.opts.templates, "forges")).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    for (const file of forges.filter((entry) => entry.endsWith(".json")).sort()) {
      const forge: string = basename(file, ".json");
      const { delivery, comment, createRepo } = await loadForgeDefaults(engine.opts.templates, forge);
      if ([delivery, comment, createRepo].includes(name)) users.push(`forge ${forge}`);
    }
    return users;
  }

  const handlers = {
    listDefinitions: async ({ query: { dir } }) => {
      const projectRecipes: RegExpExecArray | null = /^projects\/([^/]+)\/recipes$/.exec(dir);
      if (projectRecipes) {
        const ctx = projectContext(engine, projectRecipes[1]!);
        if (ctx.project.recipes !== undefined) {
          const entries: DefinitionEntry[] = [];
          for (const name of ctx.project.recipes) {
            const path: string = `templates/recipes/${name}.json`;
            const bytes: Buffer | null = await definitionBytes(location(path, false));
            if (!bytes) continue;
            entries.push({ path, sha256: sha256(bytes), ...inspect(path, "recipe", ctx.id, bytes.toString("utf8")) });
          }
          return entries;
        }
      }
      const target = location(dir, true);
      const { catalog, directory } = target;
      let files: string[];
      if (catalog) {
        if (directory === "icons") files = catalog.names("icons");
        else if (directory === "recipes") files = catalog.names("recipes").map((name) => `${name}.json`);
        else files = [...catalog.names("nodes").map((name) => `${name}.json`), ...catalog.names("node_content")];
      } else {
        await rejectSymlinks(target.root, target.absPath);
        files = await definitionFiles(target.absPath, directory);
      }
      const entries: DefinitionEntry[] = [];
      for (const file of files.sort()) {
        const path: string = `${dir}/${file}`;
        const bytes: Buffer | null = await definitionBytes(location(path, false));
        if (!bytes) continue;
        entries.push({ path, sha256: sha256(bytes), ...inspect(path, fileKind(target.directory, basename(file)), target.id, bytes.toString("utf8")) });
      }
      return entries;
    },
    getDefinition: async ({ params: { path } }) => {
      const target = location(path, false);
      const bytes: Buffer | null = await definitionBytes(target);
      if (!bytes) throw new NotFoundError(`definition ${path} not found`);
      const approval = target.kind === "node" && engine.global().settings.protectedMode ? target.catalog?.chatNode(basename(target.file, ".json")) : null;
      return { path, content: bytes.toString("utf8"), sha256: sha256(bytes),
        ...(approval ? { chatApproval: { hash: approval.hash, approved: approval.approved, checks: approval.checks } } : {}),
      };
    },
    validateDefinition: async ({ body: { path, content } }) => {
      const { kind, id } = location(path, false);
      const { errors, warnings } = await inspectWritable(path, kind, id, content);
      return { errors, warnings: warnings ?? [] };
    },
    uploadKnowledge: ({ params: { id }, body: { files } }) => mutate(async () => {
      const dir: string = knowledgeDir(id);
      const projectDir: string = resolve(engine.projectDir(id));
      const existing: string[] = await knowledgeNames(dir);
      const batch: string[] = files.map(({ name }) => name);
      const twice: string | undefined = batch.find((name, index) => batch.indexOf(name) !== index);
      if (twice) throw new HttpError("bad_request", `${twice} is uploaded twice`);
      const taken: string[] = batch.filter((name) => existing.includes(name));
      if (taken.length) throw new HttpError("conflict", `${taken.join(", ")} already ${taken.length === 1 ? "exists" : "exist"}: rename or delete ${taken.length === 1 ? "it" : "them"} first`);
      const names = new Set<string>([...existing, ...batch]);
      const cleaned = files.map(({ name, content }) => ({ name, ...removeBrokenKnowledgeLinks(content, names) }));
      await rejectSymlinks(projectDir, dir);
      await mkdir(dir, { recursive: true });
      for (const { name, content } of cleaned) await writeFile(join(dir, name), content, { flag: "wx" });
      const saved: string[] = batch.map((name) => `projects/${id}/knowledge/${name}`);
      for (const [index, { content }] of cleaned.entries()) engine.definitionChanged(saved[index]!, sha256(Buffer.from(content, "utf8")));
      return { saved, removedLinks: cleaned.flatMap(({ name, removed }) => removed.map((link) => ({ file: name, link }))) };
    }),
    renameKnowledge: ({ params: { id }, body: { from, to } }) => mutate(async () => {
      if (from === to) return { updated: [] };
      const dir: string = knowledgeDir(id);
      const projectDir: string = resolve(engine.projectDir(id));
      await rejectSymlinks(projectDir, dir);
      const names: string[] = await knowledgeNames(dir);
      if (!names.includes(from)) throw new NotFoundError(`knowledge file ${from} not found`);
      if (names.includes(to)) throw new HttpError("conflict", `${to} already exists`);
      await rename(join(dir, from), join(dir, to));
      const updated: string[] = [];
      for (const name of names.map((name) => name === from ? to : name)) {
        const content: string = await readFile(join(dir, name), "utf8");
        const next: string = renameKnowledgeLinks(content, from, to);
        if (next === content) continue;
        await writeFile(join(dir, name), next);
        if (name !== to) updated.push(name);
      }
      engine.definitionChanged(`projects/${id}/knowledge/${from}`, null);
      for (const name of [to, ...updated]) engine.definitionChanged(`projects/${id}/knowledge/${name}`, sha256(await readFile(join(dir, name))));
      return { updated: updated.map((name) => `projects/${id}/knowledge/${name}`) };
    }),
    deleteKnowledge: ({ params: { id, name } }) => mutate(async () => {
      const dir: string = knowledgeDir(id);
      const projectDir: string = resolve(engine.projectDir(id));
      await rejectSymlinks(projectDir, dir);
      if (!(await knowledgeNames(dir)).includes(name)) throw new NotFoundError(`knowledge file ${name} not found`);
      await rm(join(dir, name));
      engine.definitionChanged(`projects/${id}/knowledge/${name}`, null);
      return { ok: true as const };
    }),
    approveChatNode: ({ params: { path }, body: { hash } }) => mutate(async () => {
      const target = location(path, false);
      if (!engine.global().settings.protectedMode || target.kind !== "node" || !target.catalog?.approveChatNode(basename(target.file, ".json"), hash)) {
        throw new HttpError("conflict", "The script changed or no longer needs approval. Reopen the node.");
      }
      return { ok: true as const };
    }),
    saveDefinition: ({ params: { path }, body: { content, baseSha256 } }) => mutate(async () =>
      /^projects\/[^/]+\/project\.json$/.test(path) ? engine.withConfiguration(() => save(path, content, baseSha256, true)) : save(path, content, baseSha256, true)),
    getNodeTemplateUsage: ({ params: { name } }) => nodeTemplateUsers(name),
    deleteTemplate: ({ params: { path }, body: { baseSha256 } }) => mutate(() => engine.withConfiguration(async () => {
      const target: ReturnType<typeof location> = location(path, false);
      const { kind, file } = target;
      if (!path.startsWith("templates/") || (kind !== "node" && kind !== "recipe")) {
        throw new HttpError("bad_request", "Only node and recipe templates can be deleted here.");
      }
      const bytes: Buffer | null = await definitionBytes(target);
      if (!bytes) throw new NotFoundError(`definition ${path} not found`);
      if (sha256(bytes) !== baseSha256) throw new HttpError("conflict", "The template changed since it was loaded. Reopen it before deleting.");

      const name: string = basename(file, ".json");
      const projects: Project[] = [...engine.projects.values()].map(({ ctx }) => ctx.project).filter(({ recipes }) => recipes !== undefined);
      const users: string[] = kind === "node" ? await nodeTemplateUsers(name)
        : projects.filter((project) => project.recipes?.includes(name)).map(({ id }) => `project ${id}`);
      if (users.length) throw new HttpError("conflict", `This template is used by ${users.join(", ")}.`);

      engine.catalog.delete(kind === "node" ? "nodes" : "recipes", name);
      for (const { id } of projects) await engine.reloadProject(id);
      engine.definitionChanged(path, null);
      return { ok: true as const };
    })),
    instantiate: ({ body }) => mutate(async () => {
      const { errors, ...result } = await instantiate(body);
      if (errors.length) throw new HttpError("bad_request", errors.map((error) => error.message).join("\n"));
      return result;
    }),
  } satisfies Partial<Handlers>;

  async function save(path: string, content: string, baseSha256: string | null, userSave = false): Promise<RouteOutput<"saveDefinition">> {
    const target: ReturnType<typeof location> = location(path, false);
    const { absPath, catalog, kind, id, file } = target;
    const before: Buffer | null = await definitionBytes(target);
    const bytes: Buffer = Buffer.from(content, "utf8");
    if ((before === null ? null : sha256(before)) !== baseSha256) {
      throw new HttpError("conflict", "the file changed since it was loaded");
    }
    const { errors, value } = await inspectWritable(path, kind, id, content);
    if (errors.length) throw new HttpError("bad_request", errors.map((error) => error.message).join("\n"));
    const persist = async (data: Buffer): Promise<void> => {
      if (catalog) {
        if (kind === "node") catalog.db.transaction(() => {
          const node: Node = Node.parse(value);
          catalog.saveNode(node);
          const approval = userSave ? catalog.chatNode(node.name) : null;
          if (approval) catalog.approveChatNode(node.name, approval.hash);
        })();
        else if (kind === "recipe") catalog.saveRecipe(Recipe.parse(value));
        else if (kind === "icon") catalog.saveIcon(file, content);
        else catalog.saveContent(file, content);
        return;
      }
      await mkdir(dirname(absPath), { recursive: true });
      const stage: string = await mkdtemp(join(dirname(absPath), ".definition-"));
      try {
        const draft: string = join(stage, file);
        await writeFile(draft, data);
        await rename(draft, absPath);
      } finally {
        await rm(stage, { recursive: true, force: true });
      }
    };
    let saved: Buffer = bytes;
    if (kind === "node" && JSON.stringify(value) !== JSON.stringify(JSON.parse(content))) {
      saved = Buffer.from(JSON.stringify(value, null, 2) + "\n");
    }
    if (kind === "project" && id) {
      const loaded = engine.project(id);
      const current: Project = loaded.ctx.project;
      const next: Project = Project.parse(value);
      if (current.recipes !== undefined && next.recipes === undefined) throw new HttpError("bad_request", "Keep the list of selected recipe templates.");
      const missing: string[] = (next.recipes ?? []).filter((name) => !loaded.ctx.defs.recipes.has(name));
      if (missing.length > 0) {
        const templates = await loadTemplates(home.templates, engine.catalog);
        for (const name of missing) {
          const recipe: Recipe | undefined = templates.recipes.get(name);
          if (!recipe) throw new HttpError("bad_request", `recipe template ${name} not found`);
          const issues = checkRecipe(recipe, templates.nodes, next.repo !== null);
          if (issues.length) throw new HttpError("bad_request", issues.map(({ message }) => message).join("\n"));
        }
      }
      if (!next.pm && current.pm) throw new HttpError("bad_request", "Choose a Project Manager.");
      const clash = next.pm && JSON.stringify(next.pm) !== JSON.stringify(current.pm) && projectManagerClash(next.pm, engine.projectManagers(id));
      if (clash) throw new HttpError("bad_request", `Another project's Project Manager already uses this ${clash === "name" ? "name" : "colour"}.`);
      if (next.pm?.agentId && next.pm.agentId !== current.pm?.agentId && engine.projectManagers(id).some(({ agentId }) => agentId === next.pm?.agentId)) {
        throw new HttpError("bad_request", "This Project Manager already belongs to another project.");
      }
      if (current.folder !== next.folder || !sameRepository(current.repo, next.repo)) {
        if (engine.creating.has(id) || loaded.deleting || loaded.executor.jobs().some(({ state }) => !isFinal(state))) {
          throw new HttpError("conflict", "Finish or stop this project's jobs before changing its repository or folder.");
        }
        try {
          if (next.folder !== current.folder) next.folder = absoluteProjectFolder(next.folder);
          if (next.repo?.url !== current.repo?.url) {
            next.createRepo = null;
          }
          await changeProjectLocation(loaded.ctx, current, next, engine.global().accounts, async () => {
            loaded.ctx.db.definition.write(next);
            try {
              await engine.reloadProject(id);
            } catch (error) {
              loaded.ctx.db.definition.write(current);
              await engine.reloadProject(id);
              throw error;
            }
          });
        } catch (error) {
          throw new HttpError(error instanceof ProjectLocationConflict ? "conflict" : "bad_request", (error as Error).message);
        }
      } else {
        loaded.ctx.db.definition.write(next);
        await engine.reloadProject(id);
      }
      const hash: string = sha256((await definitionBytes(target))!);
      engine.definitionChanged(path, hash);
      return { sha256: hash };
    }
    await persist(saved);
    if (id) await engine.reloadProject(id);
    else if (kind === "node" || kind === "recipe" || kind === "prompt" || kind === "script") {
      for (const [projectId, project] of engine.projects) if (project.ctx.project.recipes !== undefined) await engine.reloadProject(projectId);
    }
    const hash: string = sha256((await definitionBytes(target))!);
    engine.definitionChanged(path, hash);
    return { sha256: hash };
  }

  async function instantiate({ kind, name, project: id }: InstantiateBody): Promise<RouteOutput<"instantiate"> & { errors: DefinitionError[] }> {
    const { project, db } = projectContext(engine, id);
    if (project.recipes !== undefined) {
      const path: string = `templates/recipes/${name}.json`;
      if (kind === "node") return { created: [], kept: [], errors: [{ file: `templates/nodes/${name}.json`, path: "", message: "Add the node to a recipe in Templates." }] };
      if (project.recipes.includes(name)) return { created: [], kept: [path], errors: [] };
      const templates = await loadTemplates(home.templates, engine.catalog);
      const template: Recipe | undefined = templates.recipes.get(name);
      const account = project.repo && forgeAccountOf(project, engine.global().accounts);
      const defaults = account ? await projectDefaults(engine.opts.templates, project.repo, account.forge) : null;
      const recipe: Recipe | undefined = template && recipeForForge(template, defaults?.rename ?? {});
      const errors: DefinitionError[] = recipe
        ? checkRecipe(recipe, templates.nodes, project.repo !== null).map((issue) => ({ file: path, ...issue }))
        : [{ file: path, path: "name", message: `recipe template ${name} not found` }];
      if (errors.length > 0) return { created: [], kept: [], errors };
      const projectPath: string = `projects/${id}/project.json`;
      const target = location(projectPath, false);
      const before: Buffer | null = await definitionBytes(target);
      if (!before) throw new NotFoundError(`project ${id} not found`);
      const updated: Project = { ...Project.parse(JSON.parse(before.toString("utf8"))), recipes: [...project.recipes, name] };
      await save(projectPath, JSON.stringify(updated, null, 2) + "\n", sha256(before));
      return { created: [path], kept: [], errors: [] };
    }
    let rename: Record<string, string> = {};
    if (kind === "recipe" && project.repo !== null) {
      try {
        const account = forgeAccountOf(project, engine.global().accounts);
        ({ rename } = await projectDefaults(engine.opts.templates, project.repo, account?.forge ?? null));
      } catch (e) {
        if (e instanceof ProjectCreateError) throw new HttpError("bad_request", e.message);
        throw e;
      }
    }
    const template: Recipe | null = kind === "recipe" ? engine.catalog.recipe(name) : null;
    const recipe: Recipe | null = template && recipeForForge(template, rename);
    const errors: DefinitionError[] = [];
    if (kind === "recipe" && !recipe) {
      return { created: [], kept: [], errors: [{ file: `templates/recipes/${name}.json`, path: "", message: `recipe template ${name} not found` }] };
    }
    const created: string[] = [];
    const kept: string[] = [];
    const nodes: Map<string, Node> = new Map();
    const additions: Node[] = [];
    const contents: Map<string, string> = new Map();
    const names: Set<string> = new Set(recipe ? Object.values(recipe.nodes).map(({ use }) => use) : [name]);
    for (const use of names) {
      const existing: Node | null = db.catalog.node(use);
      const file: string = `projects/${id}/nodes/${use}.json`;
      const node: Node | null = existing ?? engine.catalog.node(use);
      if (!node) {
        errors.push({ file, path: "", message: `node template ${use} not found` });
        continue;
      }
      nodes.set(use, node);
      if (existing) {
        kept.push(file);
        continue;
      }
      for (const [path, key] of nodeSidecars(node)) {
        const body: string | null = engine.catalog.content(key);
        if (body === null) errors.push({ file, path, message: `${key} has no saved content` });
        else contents.set(key, body);
      }
      additions.push(node);
      created.push(file);
    }
    const recipePath: string = `projects/${id}/recipes/${name}.json`;
    const existingRecipe: boolean = recipe !== null && db.catalog.recipe(name) !== null;
    if (recipe && !existingRecipe) errors.push(...checkRecipe(recipe, nodes, project.repo !== null).map((issue) => ({ file: recipePath, ...issue })));
    if (errors.length) return { created: [], kept, errors };
    db.db.transaction(() => {
      for (const [key, body] of contents) {
        if (db.catalog.content(key) !== null) continue;
        db.catalog.saveContent(key, body);
        created.push(`projects/${id}/nodes/${key}`);
      }
      for (const node of additions) {
        db.catalog.saveNode(node);
        const approval = engine.catalog.chatNode(node.name);
        if (approval?.approved) db.catalog.approveChatNode(node.name, approval.hash);
      }
      if (recipe) {
        if (existingRecipe) kept.push(recipePath);
        else {
          db.catalog.saveRecipe(recipe);
          created.push(recipePath);
        }
      }
    })();
    await engine.reloadProject(id);
    for (const path of created) engine.definitionChanged(path, sha256((await definitionBytes(location(path, false)))!));
    return { created, kept, errors };
  }

  return {
    handlers,
    removeProject: (id: string, validate?: () => void) => mutate(async () => {
      validate?.();
      await engine.deleteProject(id);
    }),
    write: (path: string, content: string) => mutate(async () => {
      const target: ReturnType<typeof location> = location(path, false);
      const { kind, id } = target;
      const { errors, warnings = [] } = await inspectWritable(path, kind, id, content);
      if (errors.length) return { errors, warnings };
      const before: Buffer | null = await definitionBytes(target);
      const baseSha256: string | null = before === null ? null : sha256(before);
      return { errors, warnings, ...await save(path, content, baseSha256) };
    }),
    instantiate: (body: InstantiateBody) => mutate(async () => instantiate(body)),
  };
}
