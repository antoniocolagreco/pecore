import { createReadStream, lstatSync, renameSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { pipeline } from "node:stream/promises";
import { createZstdDecompress } from "node:zlib";
import { Unpack } from "tar";
import { monotonicFactory } from "ulid";
import { ImportProjectBody } from "@pecore/schemas";
import type { Accounts, ImportProjectResult, Project } from "@pecore/schemas";
import { runFiles } from "../definitions/confirm";
import type { ImportSubject } from "../definitions/confirm";
import { loadProject } from "../definitions/load";
import type { Definitions } from "../definitions/load";
import { homePaths } from "../home/layout";
import { forgeAccountOf, writeCreation } from "../projects/create";
import { subjectHash } from "../runners/human";
import { ProjectDb } from "../store/project-db";
import type { NewEvent } from "../store/project-db";
import { archivePath, definitionDirs, InvalidArchive, Manifest, ShareConflict } from "./archive";
import { migrateHistory, resetHistory } from "./history";

const ulid = monotonicFactory();
type AccountMapping = NonNullable<ImportProjectBody["accounts"]>;

export const importWarning: string = "This project was written by someone else. Its scripts and prompts run on this computer with your accounts: a script can read your logins and send them anywhere, and a prompt can tell an agent to do the same. Confirm only after you have read every script and prompt.";

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
      if (!("type" in entry)) return false;
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
  await pipeline(createReadStream(path), createZstdDecompress(), archive);
  if (invalid) throw invalid;
  return roots;
}

function checkId(dir: string, id: string, knownProject: (id: string) => boolean): void {
  if (knownProject(id) || lstatSync(dir, { throwIfNoEntry: false })) throw new ShareConflict(`project ${id} already exists`);
}

async function importEvent(dir: string, project: Project, definitions: Definitions): Promise<Extract<NewEvent, { type: "queue.added" }>> {
  const snapshots: ImportSubject["nodes"] = [];
  for (const node of definitions.nodes.values()) {
    const path: string = `nodes/${node.name}.json`;
    const names: string[] = node.kind === "agent" ? [node.prompt] : runFiles(node);
    const files: Record<string, string> = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await readFile(join(dir, "nodes", name), "utf8")] as const)));
    snapshots.push({ path, definition: node, files });
  }
  const knowledgeDir: string = join(dir, "knowledge");
  const subject: ImportSubject = {
    projectId: project.id,
    warning: importWarning,
    project,
    nodes: snapshots,
    recipes: [...definitions.recipes.values()].map((definition) => ({ path: `recipes/${definition.name}.json`, definition })),
    knowledge: (await readdir(knowledgeDir, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile()).map((entry) => relative(knowledgeDir, join(entry.parentPath, entry.name))).sort(),
  };
  return { jobId: null, type: "queue.added", payload: { itemId: ulid(), kind: "import", subject, subjectHash: subjectHash(subject), choices: ["confirm", "reject"] } };
}

export async function beginImport(home: string, input: ImportProjectBody, options: { accounts: Accounts; knownProject(id: string): boolean }): Promise<ImportProjectResult> {
  const body: ImportProjectBody = ImportProjectBody.parse(input);
  const stage: string = await mkdtemp(join(home, ".pecore-import-"));
  try {
    const dir: string = join(stage, "project");
    await mkdir(dir, { mode: 0o700 });
    const roots: Set<string> = await unpack(body.path, dir);
    const manifest: Manifest = Manifest.parse(JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")));
    if (manifest.history !== roots.has("pecore.db") || (!manifest.history && roots.has("artifacts")) || (!manifest.logs && roots.has("logs"))) {
      throw new InvalidArchive("archive files do not match the manifest's history and logs flags");
    }
    const original: string = join(stage, manifest.projectId);
    if (original !== dir) renameSync(dir, original);
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
    const event = await importEvent(original, project, loaded);
    const dbPath: string = join(original, "pecore.db");
    if (manifest.history) migrateHistory(dbPath);
    const db: ProjectDb = new ProjectDb(dbPath);
    try {
      if (manifest.history) resetHistory(db, original, [event]);
      else db.append([event]);
    } finally {
      db.close();
    }
    await writeCreation(original, 3);
    checkId(dest, id, options.knownProject);
    renameSync(original, dest);
    return { state: "imported", id, itemId: event.payload.itemId, warning: importWarning };
  } catch (error) {
    if (error instanceof InvalidArchive || error instanceof ShareConflict) throw error;
    throw new InvalidArchive((error as Error).message, { cause: error });
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
