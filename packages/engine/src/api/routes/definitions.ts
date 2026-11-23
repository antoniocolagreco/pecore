import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { KnowledgeFileName, Name, Node, normalizeLegacyHumanNode, Project, projectManagerClash, Recipe, StoredNode } from "@pecore/schemas";
import type { DefinitionEntry, InstantiateBody, RouteOutput } from "@pecore/schemas";
import { validIcon } from "../../definitions/icon";
import { instantiateNode, instantiateRecipe } from "../../definitions/instantiate";
import { checkKnowledge, knowledgeLinks, knowledgeNames, removeBrokenKnowledgeLinks, renameKnowledgeLinks } from "../../definitions/knowledge";
import type { KnowledgeIssue } from "../../definitions/knowledge";
import { loadTemplates, loadProject, zodErrors } from "../../definitions/load";
import type { DefinitionError } from "../../definitions/load";
import { checkRecipe, remoteIssues } from "../../definitions/recipe-check";
import { isFinal } from "../../graph/job-machine";
import { commitDefinition, commitMessage, git } from "../../home/git-commit";
import { homePaths } from "../../home/layout";
import { NotFoundError } from "../../main";
import type { Engine } from "../../main";
import { forgeAccountOf, ProjectCreateError } from "../../projects/create";
import { projectDefaults } from "../../projects/defaults";
import { absoluteProjectFolder, changeProjectLocation, ProjectLocationConflict, sameRepository } from "../../projects/location";
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

async function commitFiles(home: string, projectDir: string | undefined, files: string[], message: string): Promise<void> {
  if (files.length === 0) return;
  const fromHome: string = relative(home, files[0]!);
  if (projectDir && (fromHome === ".." || fromHome.startsWith(`..${sep}`) || isAbsolute(fromHome))) {
    if (!(await lstatOrNull(join(projectDir, ".git")))) await git(projectDir, ["init", "-q"]);
    await commitDefinition(projectDir, files, message);
  } else {
    await commitDefinition(home, files, message);
  }
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
    if (id) {
      const ctx = projectContext(engine, id);
      if (definitionDirectory && ctx.project.recipes !== undefined) throw new HttpError("bad_request", "Edit nodes and recipes in Templates.");
    }
    const projectDir: string | undefined = id ? resolve(engine.projectDir(id)) : undefined;
    const root: string = projectDir ?? home.home;
    const dir: string = projectDir ? join(projectDir, ...parts.slice(2)) : homeDirectory!;
    const absPath: string = join(dir, file);
    return { id, projectDir, root, absPath, directory, kind, file };
  }

  function inspect(path: string, kind: DefinitionKind | undefined, id: string | undefined, content: string, reading = false): Pick<DefinitionEntry, "value" | "errors"> {
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
    const schema = kind === "node" ? (reading ? StoredNode : Node) : Project;
    const definition: unknown = kind === "node" && value && typeof value === "object" && !Array.isArray(value)
      ? normalizeLegacyHumanNode(value as Record<string, unknown>) : value;
    const result = schema.safeParse(reading ? value : definition);
    if (!result.success) return { value, errors: zodErrors(path, result.error) };
    const name: string = basename(path, ".json");
    if (kind === "node" && "name" in result.data && result.data.name !== name) {
      errors.push({ file: path, path: "name", message: `name must match the file name ${name}` });
    }
    if (kind === "project" && "id" in result.data && result.data.id !== id) {
      errors.push({ file: path, path: "id", message: `id must match the directory name ${id}` });
    }
    if (kind === "node" && "tags" in result.data) {
      const fields = definition as Record<string, unknown>;
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
    const { nodes } = await loadTemplates(home.templates);
    return { value: inspected.value, errors: checkRecipe(recipe, nodes, true).map((issue) => ({ file: path, ...issue })) };
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
            const target = location(path, false);
            await rejectSymlinks(target.root, target.absPath);
            const bytes: Buffer | null = await optionalBytes(target.absPath);
            if (!bytes) continue;
            entries.push({ path, sha256: sha256(bytes), ...inspect(path, "recipe", ctx.id, bytes.toString("utf8")) });
          }
          return entries;
        }
      }
      const target = location(dir, true);
      await rejectSymlinks(target.root, target.absPath);
      const files: string[] = await definitionFiles(target.absPath, target.directory);
      const entries: DefinitionEntry[] = [];
      for (const file of files.sort()) {
        const bytes: Buffer | null = await optionalBytes(join(target.absPath, file));
        if (!bytes) continue;
        const path: string = `${dir}/${file}`;
        entries.push({ path, sha256: sha256(bytes), ...inspect(path, fileKind(target.directory, basename(file)), target.id, bytes.toString("utf8"), true) });
      }
      return entries;
    },
    getDefinition: async ({ params: { path } }) => {
      const target = location(path, false);
      await rejectSymlinks(target.root, target.absPath);
      const bytes: Buffer | null = await optionalBytes(target.absPath);
      if (!bytes) throw new NotFoundError(`definition ${path} not found`);
      return { path, content: bytes.toString("utf8"), sha256: sha256(bytes) };
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
      await commitFiles(home.home, projectDir, [dir], commitMessage("knowledge", batch.join(", "), "created"));
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
      await commitFiles(home.home, projectDir, [dir], `knowledge ${from}: renamed to ${to}`);
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
      await commitFiles(home.home, projectDir, [dir], commitMessage("knowledge", name, "deleted"));
      engine.definitionChanged(`projects/${id}/knowledge/${name}`, null);
      return { ok: true as const };
    }),
    saveDefinition: ({ params: { path }, body: { content, baseSha256 } }) => mutate(async () =>
      /^projects\/[^/]+\/project\.json$/.test(path) ? engine.withGlobalFiles(() => save(path, content, baseSha256)) : save(path, content, baseSha256)),
    instantiate: ({ body }) => mutate(async () => {
      const { errors, ...result } = await instantiate(body);
      if (errors.length) throw new HttpError("bad_request", errors.map((error) => error.message).join("\n"));
      return result;
    }),
  } satisfies Partial<Handlers>;

  async function save(path: string, content: string, baseSha256: string | null): Promise<RouteOutput<"saveDefinition">> {
    const { root, absPath, kind, id, projectDir, file } = location(path, false);
    await rejectSymlinks(root, absPath);
    const before: Buffer | null = await optionalBytes(absPath);
    const bytes: Buffer = Buffer.from(content, "utf8");
    if ((before === null ? null : sha256(before)) !== baseSha256) {
      throw new HttpError("conflict", "the file changed since it was loaded");
    }
    const { errors, value } = await inspectWritable(path, kind, id, content);
    if (errors.length) throw new HttpError("bad_request", errors.map((error) => error.message).join("\n"));
    const name: string = kind === "project" ? id! : basename(file, extname(file));
    const persist = async (data: Buffer): Promise<void> => {
      await mkdir(dirname(absPath), { recursive: true });
      const stage: string = await mkdtemp(join(dirname(absPath), ".definition-"));
      try {
        const draft: string = join(stage, file);
        await writeFile(draft, data);
        await rename(draft, absPath);
      } finally {
        await rm(stage, { recursive: true, force: true });
      }
      await commitFiles(home.home, projectDir, [absPath], commitMessage(kind!, name, before === null ? "created" : "edited"));
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
        const templates = await loadTemplates(home.templates);
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
            const source = next.source && loaded.ctx.defs.nodes.get(next.source.node);
            if (!next.source?.account && source?.kind === "source" && source.credentials.includes("project.account")) next.source = null;
          }
          saved = Buffer.from(JSON.stringify(next, null, 2) + "\n");
          await changeProjectLocation(loaded.ctx, current, next, engine.global().accounts, async () => {
            try {
              await persist(saved);
            } catch (error) {
              if (before) await writeFile(absPath, before);
              throw error;
            }
            await engine.reloadProject(id);
          });
        } catch (error) {
          throw new HttpError(error instanceof ProjectLocationConflict ? "conflict" : "bad_request", (error as Error).message);
        }
        const hash: string = sha256(saved);
        engine.definitionChanged(path, hash);
        return { sha256: hash };
      }
    }
    await persist(saved);
    if (id) await engine.reloadProject(id);
    else if (kind === "node" || kind === "recipe" || kind === "prompt" || kind === "script") {
      for (const [projectId, project] of engine.projects) if (project.ctx.project.recipes !== undefined) await engine.reloadProject(projectId);
    }
    const hash: string = sha256(saved);
    engine.definitionChanged(path, hash);
    return { sha256: hash };
  }

  async function instantiate({ kind, name, project: id }: InstantiateBody): Promise<RouteOutput<"instantiate"> & { errors: DefinitionError[] }> {
    const { project } = projectContext(engine, id);
    const projectDir: string = resolve(engine.projectDir(id));
    if (project.recipes !== undefined) {
      const path: string = `templates/recipes/${name}.json`;
      if (kind === "node") return { created: [], kept: [], errors: [{ file: `templates/nodes/${name}.json`, path: "", message: "Add the node to a recipe in Templates." }] };
      if (project.recipes.includes(name)) return { created: [], kept: [path], errors: [] };
      const templates = await loadTemplates(home.templates);
      const recipe: Recipe | undefined = templates.recipes.get(name);
      const errors: DefinitionError[] = recipe
        ? checkRecipe(recipe, templates.nodes, project.repo !== null).map((issue) => ({ file: path, ...issue }))
        : [{ file: path, path: "name", message: `recipe template ${name} not found` }];
      if (errors.length > 0) return { created: [], kept: [], errors };
      const projectPath: string = `projects/${id}/project.json`;
      const target = location(projectPath, false);
      const before: Buffer | null = await optionalBytes(target.absPath);
      if (!before) throw new NotFoundError(`project ${id} not found`);
      const updated: Project = { ...Project.parse(JSON.parse(before.toString("utf8"))), recipes: [...project.recipes, name] };
      await save(projectPath, JSON.stringify(updated, null, 2) + "\n", sha256(before));
      return { created: [path], kept: [], errors: [] };
    }
    let rename: Record<string, string> = {};
    if (kind === "recipe" && project.repo !== null) {
      try {
        const account = forgeAccountOf(project, engine.global().accounts);
        ({ rename } = await projectDefaults(home.templates, project.repo, account?.forge ?? null));
      } catch (e) {
        if (e instanceof ProjectCreateError) throw new HttpError("bad_request", e.message);
        throw e;
      }
    }
    if (kind === "recipe" && project.repo === null) {
      const templates = await loadTemplates(home.templates);
      const recipe = templates.recipes.get(name);
      const errors: DefinitionError[] = recipe ? remoteIssues(recipe, templates.nodes).map((issue) => ({ file: `templates/recipes/${name}.json`, ...issue })) : [];
      if (errors.length) return { created: [], kept: [], errors };
    }
    const nodesDir: string = join(projectDir, "nodes");
    await rejectSymlinks(projectDir, nodesDir);
    if (kind === "recipe") await rejectSymlinks(projectDir, join(projectDir, "recipes"));
    const result = kind === "node"
      ? await instantiateNode(home.templates, projectDir, name)
      : await instantiateRecipe(home.templates, projectDir, name, rename, async (content) => {
        const file: string = `projects/${id}/recipes/${name}.json`;
        const { nodes } = await loadProject(projectDir);
        const recipe: Recipe = Recipe.parse(JSON.parse(content));
        return checkRecipe(recipe, nodes, project.repo !== null).map((issue) => ({ file, ...issue }));
      });
    await commitFiles(home.home, projectDir, result.written, commitMessage(kind, name, "created"));
    await engine.reloadProject(id);
    const layoutPath = (file: string): string => `projects/${id}/${relative(projectDir, file).split(sep).join("/")}`;
    for (const file of result.written) engine.definitionChanged(layoutPath(file), sha256(await readFile(file)));
    return { created: result.written.map(layoutPath), kept: result.kept.map(layoutPath), errors: result.errors };
  }

  return {
    handlers,
    removeProject: (id: string, validate?: () => void) => mutate(async () => {
      validate?.();
      await engine.deleteProject(id);
    }),
    write: (path: string, content: string) => mutate(async () => {
      const { root, absPath, kind, id } = location(path, false);
      await rejectSymlinks(root, absPath);
      const { errors, warnings = [] } = await inspectWritable(path, kind, id, content);
      if (errors.length) return { errors, warnings };
      const before: Buffer | null = await optionalBytes(absPath);
      const baseSha256: string | null = before === null ? null : sha256(before);
      return { errors, warnings, ...await save(path, content, baseSha256) };
    }),
    instantiate: (body: InstantiateBody) => mutate(async () => instantiate(body)),
  };
}
