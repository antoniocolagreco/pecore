import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Connector, Name, Node, Project, Recipe } from "@pecore/schemas";
import type { DefinitionEntry } from "@pecore/schemas";
import { ensureConfirmed, needsConfirmation, runFiles } from "../../definitions/confirm";
import { sourceScope } from "../../sources/run";
import { instantiateNode, instantiateRecipe } from "../../definitions/instantiate";
import { zodErrors } from "../../definitions/load";
import type { DefinitionError } from "../../definitions/load";
import { checkRecipe } from "../../definitions/recipe-check";
import { commitDefinition, commitMessage, git } from "../../home/git-commit";
import { homePaths } from "../../home/layout";
import { NotFoundError } from "../../main";
import type { Engine } from "../../main";
import { forgeAccountOf, ProjectCreateError } from "../../projects/create";
import { projectDefaults } from "../../projects/defaults";
import { HttpError } from "../server";
import type { Handlers } from "../server";

type DefinitionKind = "node" | "recipe" | "project" | "connector" | "knowledge" | "prompt" | "script";

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
  if (directory === "connectors") return "connector";
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
  const home = homePaths(resolve(engine.opts.home));
  let pending: Promise<unknown> = Promise.resolve();

  function mutate<T>(action: () => Promise<T>): Promise<T> {
    const result: Promise<T> = pending.then(action);
    pending = result.catch(() => undefined);
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
      scope === "connectors" && parts.length === 1 ? home.connectors :
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
      if (id) errors.push(...checkRecipe(result.data, projectContext(engine, id).defs.nodes).map((issue) => ({ file: path, ...issue })));
      return { value, errors };
    }
    const schema: typeof Node | typeof Project | typeof Connector = kind === "node" ? Node : kind === "project" ? Project : Connector;
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

  return {
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
    saveDefinition: ({ params: { path }, body: { content, baseSha256 } }) => mutate(async () => {
      const { root, absPath, kind, id, projectDir, file } = location(path, false);
      await rejectSymlinks(root, absPath);
      const before: Buffer | null = await optionalBytes(absPath);
      if ((before === null ? null : sha256(before)) !== baseSha256) throw new HttpError("conflict", "the file changed since it was loaded");
      const { errors } = inspect(path, kind, id, content);
      if (errors.length) throw new HttpError("bad_request", errors.map((error) => error.message).join("\n"));
      const bytes: Buffer = Buffer.from(content, "utf8");
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
    }),
    instantiate: ({ body: { kind, name, project: id } }) => mutate(async () => {
      const { project } = projectContext(engine, id);
      const projectDir: string = resolve(engine.projectDir(id));
      let rename: Record<string, string> = {};
      if (kind === "recipe" && project.repo !== null) {
        try {
          const account = forgeAccountOf(project, engine.global().accounts);
          ({ rename } = await projectDefaults(home.library, project.repo, account?.forge ?? null, []));
        } catch (e) {
          if (e instanceof ProjectCreateError) throw new HttpError("bad_request", e.message);
          throw e;
        }
      }
      const nodesDir: string = join(projectDir, "nodes");
      await rejectSymlinks(projectDir, nodesDir);
      if (kind === "recipe") await rejectSymlinks(projectDir, join(projectDir, "recipes"));
      const result = kind === "node"
        ? await instantiateNode(home.library, projectDir, name)
        : await instantiateRecipe(home.library, projectDir, name, rename);
      if (result.errors.length) throw new HttpError("bad_request", result.errors.map((error) => error.message).join("\n"));
      await commitFiles(home.home, projectDir, result.written, commitMessage(kind, name, "created"));
      await engine.reloadProject(id);
      const layoutPath = (file: string): string => `projects/${id}/${relative(projectDir, file).split(sep).join("/")}`;
      for (const file of result.written) engine.definitionChanged(layoutPath(file), sha256(await readFile(file)));
      const written: Set<string> = new Set(result.written);
      const confirmItemIds: string[] = await confirmNodes(engine, id, nodesDir, (node) => written.has(join(nodesDir, `${node.name}.json`)));
      return { created: result.written.map(layoutPath), kept: result.kept.map(layoutPath), confirmItemIds };
    }),
  } satisfies Partial<Handlers>;
}
