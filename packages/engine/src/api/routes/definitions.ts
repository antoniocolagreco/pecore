import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Name, Node, Project, Recipe } from "@pecore/schemas";
import type { DefinitionEntry, InstantiateBody, RouteOutput } from "@pecore/schemas";
import { ensureConfirmed, needsConfirmation, runFiles, stageRecipeChange } from "../../definitions/confirm";
import type { RecipeChangeSubject } from "../../definitions/confirm";
import { sourceScope } from "../../sources/run";
import { instantiateNode, instantiateRecipe } from "../../definitions/instantiate";
import { loadLibrary, zodErrors } from "../../definitions/load";
import type { DefinitionError } from "../../definitions/load";
import { checkRecipe, remoteIssues } from "../../definitions/recipe-check";
import { commitDefinition, commitMessage, git } from "../../home/git-commit";
import { homePaths } from "../../home/layout";
import { NotFoundError } from "../../main";
import type { Engine } from "../../main";
import { forgeAccountOf, ProjectCreateError } from "../../projects/create";
import { projectDefaults } from "../../projects/defaults";
import { HttpError } from "../server";
import type { Handlers } from "../server";

type DefinitionKind = "node" | "recipe" | "project" | "knowledge" | "prompt" | "script";
const pendingDefinitions: WeakMap<Engine, Promise<unknown>> = new WeakMap();

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
    if (entry.isDirectory() && directory === "knowledge") {
      for (const file of await definitionFiles(join(dir, entry.name), directory)) files.push(`${entry.name}/${file}`);
    }
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

async function confirmNodes(engine: Engine, id: string, nodesDir: string, affects: (node: Node) => boolean): Promise<string[]> {
  const ctx = projectContext(engine, id);
  const itemIds: string[] = [];
  for (const node of ctx.defs.nodes.values()) {
    if (!needsConfirmation(node) || !affects(node)) continue;
    const result = await ensureConfirmed(ctx.db, null, nodesDir, node, node.kind === "source" ? sourceScope(ctx, node.name) : undefined);
    if (!result.confirmed) itemIds.push(result.itemId);
  }
  return itemIds;
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
    const directory: string = (id ? projectSection : scope === "library" ? subdir : scope) ?? "";
    const projectFile: boolean = !!id && parts.length === 2 && file === "project.json";
    const definitionDirectory: boolean = directory === "nodes" || directory === "recipes";
    const projectDirectory: boolean = !!id && (
      (definitionDirectory && parts.length === 3) ||
      (directory === "knowledge" && (!listing || nested.length === 0))
    );
    const homeDirectory: string | undefined =
      scope === "library" && parts.length === 2 && definitionDirectory
        ? directory === "nodes" ? home.libraryNodes : home.libraryRecipes
        : undefined;
    const kind: DefinitionKind | undefined = projectFile ? "project" : fileKind(directory, file);
    if ((!projectFile && !projectDirectory && !homeDirectory) || (!listing && !kind)) {
      throw new HttpError("bad_request", `invalid definition path ${path}`);
    }
    if (id) projectContext(engine, id);
    const projectDir: string | undefined = id ? resolve(engine.projectDir(id)) : undefined;
    const root: string = projectDir ?? home.home;
    const dir: string = projectDir ? join(projectDir, ...parts.slice(2)) : homeDirectory!;
    const absPath: string = join(dir, file);
    return { id, projectDir, root, absPath, directory, kind, file };
  }

  function inspect(path: string, kind: DefinitionKind | undefined, id: string | undefined, content: string): Pick<DefinitionEntry, "value" | "errors"> {
    const errors: DefinitionError[] = [];
    if (kind === "knowledge" || kind === "prompt" || kind === "script") return { value: null, errors };
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
    const schema: typeof Node | typeof Project = kind === "node" ? Node : Project;
    const result = schema.safeParse(value);
    if (!result.success) return { value, errors: zodErrors(path, result.error) };
    const name: string = basename(path, ".json");
    if (kind === "node" && "name" in result.data && result.data.name !== name) {
      errors.push({ file: path, path: "name", message: `name must match the file name ${name}` });
    }
    if (kind === "project" && "id" in result.data && result.data.id !== id) {
      errors.push({ file: path, path: "id", message: `id must match the directory name ${id}` });
    }
    return { value, errors };
  }

  const handlers = {
    listDefinitions: async ({ query: { dir } }) => {
      const target = location(dir, true);
      await rejectSymlinks(target.root, target.absPath);
      const files: string[] = await definitionFiles(target.absPath, target.directory);
      const entries: DefinitionEntry[] = [];
      for (const file of files.sort()) {
        const bytes: Buffer | null = await optionalBytes(join(target.absPath, file));
        if (!bytes) continue;
        const path: string = `${dir}/${file}`;
        entries.push({ path, sha256: sha256(bytes), ...inspect(path, fileKind(target.directory, basename(file)), target.id, bytes.toString("utf8")) });
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
      return { errors: inspect(path, kind, id, content).errors };
    },
    saveDefinition: ({ params: { path }, body: { content, baseSha256 } }) => mutate(async () => save(path, content, baseSha256)),
    instantiate: ({ body }) => mutate(async () => instantiate(body, false)),
  } satisfies Partial<Handlers>;

  async function save(path: string, content: string, baseSha256: string | null, approving = false): Promise<RouteOutput<"saveDefinition">> {
    const { root, absPath, kind, id, projectDir, file } = location(path, false);
    await rejectSymlinks(root, absPath);
    const before: Buffer | null = await optionalBytes(absPath);
    const bytes: Buffer = Buffer.from(content, "utf8");
    if ((before === null ? null : sha256(before)) !== baseSha256 && !(approving && before?.equals(bytes))) {
      throw new HttpError("conflict", "the file changed since it was loaded");
    }
    const { errors } = inspect(path, kind, id, content);
    if (errors.length) throw new HttpError("bad_request", errors.map((error) => error.message).join("\n"));
    const hash: string = sha256(bytes);
    const name: string = kind === "project" ? id! : basename(file, extname(file));
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, bytes);
    await commitFiles(home.home, projectDir, [absPath], commitMessage(kind!, name, before === null ? "created" : "edited"));
    if (id) await engine.reloadProject(id);
    engine.definitionChanged(path, hash);
    const confirmItemIds: string[] = id && projectDir && (kind === "node" || kind === "prompt" || kind === "script")
      ? await confirmNodes(engine, id, join(projectDir, "nodes"), (node) => kind === "node" ? node.name === name : runFiles(node).includes(file))
      : [];
    return { sha256: hash, confirmItemIds };
  }

  async function instantiate({ kind, name, project: id }: InstantiateBody, stage: boolean): Promise<RouteOutput<"instantiate"> & { errors?: DefinitionError[] }> {
    const { project } = projectContext(engine, id);
    const projectDir: string = resolve(engine.projectDir(id));
    let rename: Record<string, string> = {};
    if (kind === "recipe" && project.repo !== null) {
      try {
        const account = forgeAccountOf(project, engine.global().accounts);
        ({ rename } = await projectDefaults(home.library, project.repo, account?.forge ?? null));
      } catch (e) {
        if (e instanceof ProjectCreateError) throw new HttpError("bad_request", e.message);
        throw e;
      }
    }
    if (kind === "recipe" && project.repo === null) {
      const library = await loadLibrary(home.library);
      const recipe = library.recipes.get(name);
      const errors: DefinitionError[] = recipe ? remoteIssues(recipe, library.nodes).map((issue) => ({ file: `library/recipes/${name}.json`, ...issue })) : [];
      if (errors.length && stage) return { created: [], kept: [], confirmItemIds: [], errors };
      if (errors.length) throw new HttpError("bad_request", errors.map((error) => error.message).join("\n"));
    }
    const nodesDir: string = join(projectDir, "nodes");
    await rejectSymlinks(projectDir, nodesDir);
    if (kind === "recipe") await rejectSymlinks(projectDir, join(projectDir, "recipes"));
    const result = kind === "node"
      ? await instantiateNode(home.library, projectDir, name)
      : await instantiateRecipe(home.library, projectDir, name, rename, stage);
    if (result.errors.length) {
      if (stage) return { created: [], kept: [], confirmItemIds: [], errors: result.errors };
      throw new HttpError("bad_request", result.errors.map((error) => error.message).join("\n"));
    }
    await commitFiles(home.home, projectDir, result.written, commitMessage(kind, name, "created"));
    await engine.reloadProject(id);
    const layoutPath = (file: string): string => `projects/${id}/${relative(projectDir, file).split(sep).join("/")}`;
    for (const file of result.written) engine.definitionChanged(layoutPath(file), sha256(await readFile(file)));
    const written: Set<string> = new Set(result.written);
    const confirmItemIds: string[] = await confirmNodes(engine, id, nodesDir, (node) => written.has(join(nodesDir, `${node.name}.json`)));
    if (result.stagedRecipe) {
      const path: string = layoutPath(result.stagedRecipe.path);
      const content: string = result.stagedRecipe.content;
      const { errors } = inspect(path, "recipe", id, content);
      if (errors.length) return { created: result.written.map(layoutPath), kept: result.kept.map(layoutPath), confirmItemIds, errors };
      await rejectSymlinks(projectDir, result.stagedRecipe.path);
      const ctx = projectContext(engine, id);
      confirmItemIds.push(stageRecipeChange(ctx.db, { path, content, baseSha256: null }));
      ctx.released();
    }
    return { created: result.written.map(layoutPath), kept: result.kept.map(layoutPath), confirmItemIds };
  }

  return {
    handlers,
    write: (path: string, content: string) => mutate(async () => {
      const { root, absPath, kind, id } = location(path, false);
      await rejectSymlinks(root, absPath);
      const { errors } = inspect(path, kind, id, content);
      if (errors.length) return { errors };
      const before: Buffer | null = await optionalBytes(absPath);
      const baseSha256: string | null = before === null ? null : sha256(before);
      if (kind === "recipe" && id) {
        const ctx = projectContext(engine, id);
        const itemId: string = stageRecipeChange(ctx.db, { path, content, baseSha256 });
        ctx.released();
        return { errors, confirmItemIds: [itemId] };
      }
      return { errors, ...await save(path, content, baseSha256) };
    }),
    stageInstantiation: (body: InstantiateBody) => mutate(async () => instantiate(body, true)),
    answerRecipeChange: (id: string, projectId: string, choice: string, note: string | null, hash: string) => mutate(async () => {
      const ctx = projectContext(engine, projectId);
      const { db } = ctx;
      const item = db.db.prepare("SELECT state, subject, subject_hash FROM human_queue WHERE id = ? AND kind = 'recipe-change'").get(id) as
        { state: string; subject: string; subject_hash: string } | undefined;
      if (item?.state !== "open" || item.subject_hash !== hash) throw new HttpError("conflict", "the item changed or was resolved");
      if (choice === "confirm") {
        const { path, content, baseSha256 } = JSON.parse(item.subject) as RecipeChangeSubject;
        await save(path, content, baseSha256, true);
      }
      db.append([{ jobId: null, type: "queue.resolved", payload: { itemId: id, state: "resolved", choice, note } }]);
      ctx.released();
    }),
  };
}
