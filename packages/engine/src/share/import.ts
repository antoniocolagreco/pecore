import { createHash } from "node:crypto";
import { constants, createReadStream, lstatSync, renameSync } from "node:fs";
import { lstat, mkdir, mkdtemp, open, opendir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { createZstdDecompress } from "node:zlib";
import { Unpack } from "tar";
import { appName, ImportProjectBody, projectIdCandidate } from "@pecore/schemas";
import type { Accounts, ImportProjectPreview, ImportProjectResult, Project } from "@pecore/schemas";
import { loadProject } from "../definitions/load";
import { importCatalog, saveLegacyJobDefinitions } from "../definitions/catalog";
import { homePaths } from "../home/layout";
import { forgeAccountOf, repoHost, writeCreation } from "../projects/create";
import { ProjectDb } from "../store/project-db";
import type { Catalog } from "../store/catalog";
import { archivePath, definitionDirs, InvalidArchive, Manifest, ShareConflict } from "./archive";
import { migrateHistory, resetHistory } from "./history";

type AccountMapping = NonNullable<ImportProjectBody["accounts"]>;

type ImportOptions = { accounts: Accounts; catalog: Catalog; knownProject(id: string): boolean };
type LoadedProject = Awaited<ReturnType<typeof loadProject>> & { project: Project };

function allowedEntry(name: string, directory: boolean): boolean {
  const [root, ...parts]: string[] = name.split("/");
  if ((root === "nodes" || root === "recipes") && parts.length > 1 && name.endsWith(".json")) return false;
  if (definitionDirs.includes(root!)) return parts.length > 0 || directory;
  return ["manifest.json", "project.json", "pecore.db"].includes(root!) && parts.length === 0 && !directory;
}

async function unpack(path: string, dir: string): Promise<Set<string>> {
  const entries: Set<string> = new Set();
  const roots: Set<string> = new Set();
  let invalid: InvalidArchive | undefined;
  const archive: Unpack = new Unpack({
    cwd: dir,
    preserveOwner: false,
    noMtime: true,
    dmode: 0o700,
    filter: (path, entry) => {
      if (invalid || !("type" in entry)) return false;
      const name: string | null = archivePath(path);
      const directory: boolean = entry.type === "Directory";
      const file: boolean = entry.type === "File" || entry.type === "OldFile";
      if (name === null || !allowedEntry(name, directory) || entry.linkpath || !(directory || file) || entries.has(name)) {
        invalid ??= new InvalidArchive(`invalid archive entry ${JSON.stringify(path)} (${entry.type})`);
        return false;
      }
      entries.add(name);
      roots.add(name.split("/")[0]!);
      entry.mode = directory ? 0o700 : 0o600 | ((entry.mode ?? 0) & 0o100);
      return true;
    },
  });
  archive.on("warn", (_code: string, message: string) => {
    invalid ??= new InvalidArchive(message);
  });
  archive.on("ignoredEntry", () => {
    invalid ??= new InvalidArchive("archive contains an unsupported entry");
  });
  await pipeline(createReadStream(path), createZstdDecompress(), archive);
  if (invalid) throw invalid;
  return roots;
}

async function copyFolder(path: string, dir: string): Promise<Set<string>> {
  const root: string = await realpath(path);
  const roots: Set<string> = new Set();
  const visit = async (prefix: string): Promise<void> => {
    const from: string = join(root, prefix);
    if (await realpath(from) !== from) throw new InvalidArchive("The project folder changed while it was being read");
    for await (const entry of await opendir(from)) {
      const name: string = prefix ? `${prefix}/${entry.name}` : entry.name;
      const source: string = join(root, name);
      const destination: string = join(dir, name);
      const info = await lstat(source);
      if (archivePath(name) !== name || !allowedEntry(name, info.isDirectory()) || !(info.isDirectory() || (info.isFile() && info.nlink === 1))) {
        throw new InvalidArchive(`invalid project entry ${JSON.stringify(name)}`);
      }
      if (!prefix) roots.add(name);
      if (info.isDirectory()) {
        await mkdir(destination, { mode: 0o700 });
        await visit(name);
        continue;
      }
      const handle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const opened = await handle.stat();
        if (!opened.isFile() || opened.nlink !== 1 || opened.ino !== info.ino || opened.dev !== info.dev || await realpath(source) !== source) {
          throw new InvalidArchive("The project folder changed while it was being read");
        }
        const content: Buffer = Buffer.alloc(opened.size + 1);
        let offset: number = 0;
        while (offset < content.length) {
          const { bytesRead } = await handle.read(content, offset, content.length - offset, offset);
          if (bytesRead === 0) break;
          offset += bytesRead;
        }
        if (offset !== opened.size) throw new InvalidArchive("The project folder changed while it was being read");
        await writeFile(destination, content.subarray(0, offset), { mode: 0o600 | (opened.mode & 0o100), flag: "wx" });
      } finally {
        await handle.close();
      }
    }
  };
  await visit("");
  return roots;
}

async function unpackSource(path: string, dir: string): Promise<Set<string>> {
  const expanded: string = path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
  if (!isAbsolute(expanded)) throw new InvalidArchive(`Choose a local ${appName} export`);
  const source: string = resolve(expanded);
  const info = await lstat(source).catch(() => null);
  if (info?.isDirectory()) return copyFolder(source, dir);
  if (!info?.isFile() || !source.endsWith(".tar.zst")) throw new InvalidArchive(`Choose a ${appName} export file or its extracted folder`);
  return unpack(source, dir);
}

function idTaken(dir: string, id: string, knownProject: ImportOptions["knownProject"]): boolean {
  return knownProject(id) || lstatSync(dir, { throwIfNoEntry: false }) !== undefined;
}

function checkId(dir: string, id: string, knownProject: ImportOptions["knownProject"]): void {
  if (idTaken(dir, id, knownProject)) throw new ShareConflict(`project ${id} already exists`);
}

export async function withProjectArchive<T>(home: string, path: string, use: (dir: string, manifest: Manifest) => Promise<T>, source: "archive" | "local" = "archive"): Promise<T> {
  const stage: string = await mkdtemp(join(home, ".pecore-import-"));
  try {
    const dir: string = join(stage, "project");
    await mkdir(dir, { mode: 0o700 });
    const roots: Set<string> = source === "local" ? await unpackSource(path, dir) : await unpack(path, dir);
    const manifest: Manifest = Manifest.parse(JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")));
    if (manifest.history !== roots.has("pecore.db")) {
      throw new InvalidArchive("archive files do not match the manifest's history and logs flags");
    }
    const original: string = join(stage, manifest.projectId);
    if (original !== dir) renameSync(dir, original);
    return await use(original, manifest);
  } catch (error) {
    if (error instanceof InvalidArchive || error instanceof ShareConflict) throw error;
    throw new InvalidArchive((error as Error).message, { cause: error });
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

async function loadImport(dir: string): Promise<LoadedProject> {
  const loaded = await loadProject(dir);
  if (loaded.errors.length > 0 || !loaded.project) throw new InvalidArchive(loaded.errors.map(({ file, path, message }) => `${file.slice(dir.length + 1)} ${path}: ${message}`).join("; "));
  return { ...loaded, project: loaded.project };
}

function requiredAccounts(loaded: LoadedProject): Set<string> {
  const ids: Set<string> = new Set();
  if (loaded.project.repo) ids.add(loaded.project.repo.account);
  if (loaded.project.source?.account) ids.add(loaded.project.source.account);
  for (const id of Object.values(loaded.project.credentials ?? {})) ids.add(id);
  for (const node of loaded.nodes.values()) {
    if (node.kind !== "command" && node.kind !== "source") continue;
    for (const credential of node.credentials) {
      if (credential !== "project.account") ids.add(loaded.project.credentials && Object.hasOwn(loaded.project.credentials, credential) ? loaded.project.credentials[credential]! : credential);
      else if (!loaded.project.repo && !(node.kind === "source" && loaded.project.source?.account)) {
        throw new InvalidArchive(`node ${node.name} uses project.account without an account`);
      }
    }
  }
  return ids;
}

function accountChoices(ids: Set<string>, project: Project, accounts: Accounts): ImportProjectPreview["accounts"] {
  const repoAccount: string | undefined = project.repo?.account;
  const host: string | null = project.repo ? repoHost(project.repo.url) : null;
  return [...ids].sort().map((id) => ({
    id,
    choices: accounts.accounts.flatMap((account) => account.kind === "forge" && (repoAccount !== id || account.host === host)
      ? [{ id: account.id, label: `${account.id} · ${account.host}` }] : []),
  }));
}

async function sourceDigest(dir: string): Promise<string> {
  const hash = createHash("sha256");
  const paths: string[] = (await readdir(dir, { recursive: true })).sort();
  for (const path of paths) {
    const entry: string = join(dir, path);
    const info = await lstat(entry);
    const content: string | null = info.isFile() ? createHash("sha256").update(await readFile(entry)).digest("hex") : null;
    hash.update(JSON.stringify([path.split(sep).join("/"), info.mode & 0o100, content]));
  }
  return hash.digest("hex");
}

export async function previewImport(
  home: string,
  path: string,
  options: ImportOptions,
  review: (dir: string, manifest: Manifest) => Promise<ImportProjectPreview["review"]>,
): Promise<ImportProjectPreview> {
  return withProjectArchive(home, path, async (dir, manifest) => {
    const loaded: LoadedProject = await loadImport(dir);
    const accounts: ImportProjectPreview["accounts"] = accountChoices(requiredAccounts(loaded), loaded.project, options.accounts);
    const digest: string = await sourceDigest(dir);
    const projects: string = homePaths(home).projects;
    let suggestedId: string | null = null;
    if (idTaken(join(projects, manifest.projectId), manifest.projectId, options.knownProject)) {
      let index: number = 2;
      do {
        suggestedId = projectIdCandidate(manifest.projectId, index++);
      } while (idTaken(join(projects, suggestedId), suggestedId, options.knownProject));
    }
    return { review: await review(dir, manifest), digest, suggestedId, accounts };
  }, "local");
}

export async function beginImport(home: string, input: ImportProjectBody, options: ImportOptions, digest?: string): Promise<ImportProjectResult> {
  const body: ImportProjectBody = ImportProjectBody.parse(input);
  return withProjectArchive(home, body.path, async (original, manifest) => {
    if (digest !== undefined && await sourceDigest(original) !== digest) throw new ShareConflict("The shared project changed. Review it again before importing.");
    const loaded: LoadedProject = await loadImport(original);
    const project: Project = loaded.project;
    const id: string = body.id ?? manifest.projectId;
    const dest: string = join(homePaths(home).projects, id);
    checkId(dest, id, options.knownProject);
    const ids: Set<string> = requiredAccounts(loaded);
    const accounts: AccountMapping = body.accounts ?? {};
    const missing: { id: string; kind: "forge" }[] = [...ids].filter((id) => !Object.hasOwn(accounts, id)).sort().map((id) => ({ id, kind: "forge" }));
    if (missing.length > 0) return { state: "needs-accounts", accounts: missing };
    for (const from of ids) {
      const target: string = accounts[from]!;
      if (!options.accounts.accounts.some((account) => account.id === target && account.kind === "forge")) throw new InvalidArchive(`forge account ${target} not found`);
    }
    if (project.repo) project.repo.account = accounts[project.repo.account]!;
    if (project.source?.account) project.source.account = accounts[project.source.account]!;
    forgeAccountOf(project, options.accounts);
    const aliases: Record<string, string> = project.credentials ?? {};
    const mapped: Record<string, string> = Object.fromEntries([
      ...Object.entries(aliases).map(([key, account]) => [key, accounts[account]!]),
      ...[...loaded.nodes.values()].flatMap((node) => {
        if (node.kind !== "command" && node.kind !== "source") return [];
        return node.credentials.filter((name) => name !== "project.account").map((name) => [name, accounts[Object.hasOwn(aliases, name) ? aliases[name]! : name]!]);
      }),
    ]);
    if (Object.keys(mapped).length > 0) project.credentials = mapped;
    else delete project.credentials;
    project.recipes ??= [...loaded.recipes.keys()];
    project.id = id;
    project.createRepo = null;
    project.folder = null;
    await rm(join(original, "project.json"));
    await rm(join(original, "manifest.json"));
    for (const name of ["knowledge", "work"]) await mkdir(join(original, name), { recursive: true, mode: 0o700 });
    const dbPath: string = join(original, "pecore.db");
    if (manifest.history) migrateHistory(dbPath, manifest.logs);
    const db: ProjectDb = new ProjectDb(dbPath);
    try {
      if (manifest.history) {
        resetHistory(db);
        await saveLegacyJobDefinitions(loaded, db);
      }
      db.definition.write(project);
    } finally {
      db.close();
    }
    await writeCreation(original, 3);
    checkId(dest, id, options.knownProject);
    const differences: string[] = await importCatalog(options.catalog, loaded);
    for (const name of ["nodes", "recipes"]) await rm(join(original, name), { recursive: true, force: true });
    renameSync(original, dest);
    return { state: "imported", id, ...(differences.length ? { differences } : {}) };
  }, digest === undefined ? "archive" : "local");
}
