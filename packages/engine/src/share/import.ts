import { createReadStream, lstatSync, renameSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createZstdDecompress } from "node:zlib";
import { Unpack } from "tar";
import { ImportProjectBody } from "@pecore/schemas";
import type { Accounts, ImportProjectResult, Project } from "@pecore/schemas";
import { loadProject } from "../definitions/load";
import { homePaths } from "../home/layout";
import { forgeAccountOf, writeCreation } from "../projects/create";
import { ProjectDb } from "../store/project-db";
import { archivePath, definitionDirs, InvalidArchive, Manifest, ShareConflict } from "./archive";
import { migrateHistory, resetHistory } from "./history";

type AccountMapping = NonNullable<ImportProjectBody["accounts"]>;

type ArchiveLimits = { entries: number; bytes: number };

async function unpack(path: string, dir: string, limits?: ArchiveLimits): Promise<Set<string>> {
  const entries: Set<string> = new Set();
  const roots: Set<string> = new Set();
  let invalid: InvalidArchive | undefined;
  let bytes: number = 0;
  const decoder = createZstdDecompress();
  const archive: Unpack = new Unpack({
    cwd: dir,
    preserveOwner: false,
    noMtime: true,
    dmode: 0o700,
    filter: (path, entry) => {
      if (invalid || !("type" in entry)) return false;
      const name: string | null = archivePath(path);
      const [root, ...parts]: string[] = name?.split("/") ?? [];
      const directory: boolean = entry.type === "Directory";
      const file: boolean = entry.type === "File" || entry.type === "OldFile";
      const allowed: boolean = root !== undefined && (definitionDirs.includes(root) || root === "artifacts" || root === "logs"
        ? parts.length > 0 || directory
        : ["manifest.json", "project.json", "pecore.db"].includes(root) && parts.length === 0 && file);
      const nestedDefinition: boolean = (root === "nodes" || root === "recipes") && parts.length > 1 && name?.endsWith(".json") === true;
      if (name === null || !allowed || nestedDefinition || entry.linkpath || !(directory || file) || entries.has(name)) {
        invalid ??= new InvalidArchive(`invalid archive entry ${JSON.stringify(path)} (${entry.type})`);
        return false;
      }
      bytes += entry.size ?? 0;
      if (limits && (entries.size >= limits.entries || bytes > limits.bytes)) {
        invalid = new InvalidArchive("The archive exceeds the security review size limit");
        decoder.destroy(invalid);
        return false;
      }
      entries.add(name);
      roots.add(root!);
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
  if (limits) {
    let decompressed: number = 0;
    const limit = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      decompressed += chunk.length;
      if (decompressed > limits.bytes + 8 * 1024 * 1024) callback(new InvalidArchive("The archive exceeds the security review size limit"));
      else callback(null, chunk);
    } });
    await pipeline(createReadStream(path), decoder, limit, archive);
  } else {
    await pipeline(createReadStream(path), decoder, archive);
  }
  if (invalid) throw invalid;
  return roots;
}

function checkId(dir: string, id: string, knownProject: (id: string) => boolean): void {
  if (knownProject(id) || lstatSync(dir, { throwIfNoEntry: false })) throw new ShareConflict(`project ${id} already exists`);
}

export async function withProjectArchive<T>(home: string, path: string, use: (dir: string, manifest: Manifest) => Promise<T>, limits?: ArchiveLimits): Promise<T> {
  const stage: string = await mkdtemp(join(home, ".pecore-import-"));
  try {
    const dir: string = join(stage, "project");
    await mkdir(dir, { mode: 0o700 });
    const roots: Set<string> = await unpack(path, dir, limits);
    const manifest: Manifest = Manifest.parse(JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")));
    if (manifest.history !== roots.has("pecore.db") || (!manifest.history && roots.has("artifacts")) || (!manifest.logs && roots.has("logs"))) {
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

export async function beginImport(home: string, input: ImportProjectBody, options: { accounts: Accounts; knownProject(id: string): boolean }): Promise<ImportProjectResult> {
  const body: ImportProjectBody = ImportProjectBody.parse(input);
  return withProjectArchive(home, body.path, async (original, manifest) => {
    const loaded = await loadProject(original);
    if (loaded.errors.length > 0 || !loaded.project) throw new InvalidArchive(loaded.errors.map(({ file, path, message }) => `${file.slice(original.length + 1)} ${path}: ${message}`).join("; "));
    const project: Project = loaded.project;
    const id: string = body.id ?? manifest.projectId;
    const dest: string = join(homePaths(home).projects, id);
    checkId(dest, id, options.knownProject);
    const ids: Set<string> = new Set();
    if (project.repo) ids.add(project.repo.account);
    for (const node of loaded.nodes.values()) {
      if (node.kind !== "command" && node.kind !== "source") continue;
      for (const credential of node.credentials) {
        if (credential !== "project.account") ids.add(credential);
        else if (!project.repo) throw new InvalidArchive(`node ${node.name} uses project.account without a repo`);
      }
    }
    const accounts: AccountMapping = body.accounts ?? {};
    const missing: { id: string; kind: "forge" }[] = [...ids].filter((id) => !Object.hasOwn(accounts, id)).sort().map((id) => ({ id, kind: "forge" }));
    if (missing.length > 0) return { state: "needs-accounts", accounts: missing };
    for (const from of ids) {
      const target: string = accounts[from]!;
      if (!options.accounts.accounts.some((account) => account.id === target && account.kind === "forge")) throw new InvalidArchive(`forge account ${target} not found`);
    }
    if (project.repo) project.repo.account = accounts[project.repo.account]!;
    forgeAccountOf(project, options.accounts);
    project.id = id;
    project.createRepo = null;
    project.folder = null;
    await writeFile(join(original, "project.json"), JSON.stringify(project, null, 2) + "\n");
    for (const node of loaded.nodes.values()) {
      if (node.kind === "command" || node.kind === "source") {
        node.credentials = node.credentials.map((id) => id === "project.account" ? id : accounts[id]!);
      }
      await writeFile(join(original, "nodes", `${node.name}.json`), JSON.stringify(node, null, 2) + "\n");
    }
    await rm(join(original, "manifest.json"));
    for (const name of [...definitionDirs, "artifacts", "logs", "work"]) await mkdir(join(original, name), { recursive: true, mode: 0o700 });
    const dbPath: string = join(original, "pecore.db");
    if (manifest.history) migrateHistory(dbPath);
    const db: ProjectDb = new ProjectDb(dbPath);
    try {
      if (manifest.history) resetHistory(db, original);
    } finally {
      db.close();
    }
    await writeCreation(original, 3);
    checkId(dest, id, options.knownProject);
    renameSync(original, dest);
    return { state: "imported", id };
  });
}
