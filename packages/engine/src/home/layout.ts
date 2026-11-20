import { chmod, cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { jsonSchemas } from "@pecore/schemas";
import { commitDefinition, git } from "./git-commit";

export const homeGitignore = [
  "*.db",
  "*.db-wal",
  "*.db-shm",
  "projects/*/repo.git/",
  "projects/*/work/",
  "projects/*/artifacts/",
  "projects/*/logs/",
  "schemas/",
  "adapters/",
  "chat-attachments/",
  "run/",
  "",
].join("\n");

export function homePaths(home: string) {
  return {
    home,
    settings: join(home, "settings.json"),
    accounts: join(home, "accounts.json"),
    profiles: join(home, "profiles.json"),
    autoSetup: join(home, "auto-setup.json"),
    tiers: join(home, "tiers.json"),
    chatsDb: join(home, "chats.db"),
    library: join(home, "library"),
    libraryNodes: join(home, "library", "nodes"),
    libraryRecipes: join(home, "library", "recipes"),
    projects: join(home, "projects"),
    adapters: join(home, "adapters"),
    schemas: join(home, "schemas"),
    run: join(home, "run"),
    lock: join(home, "run", "lock"),
    apiFile: join(home, "run", "api.json"),
    themes: join(home, "themes"),
  };
}

export function projectPaths(projectDir: string) {
  return {
    dir: projectDir,
    project: join(projectDir, "project.json"),
    nodes: join(projectDir, "nodes"),
    recipes: join(projectDir, "recipes"),
    knowledge: join(projectDir, "knowledge"),
    db: join(projectDir, "pecore.db"),
    repo: join(projectDir, "repo.git"),
    work: join(projectDir, "work"),
    artifacts: join(projectDir, "artifacts"),
    logs: join(projectDir, "logs"),
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function addShippedLibraryFiles(shipped: string, library: string): Promise<string[]> {
  const added: string[] = [];
  for (const entry of await readdir(shipped, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path: string = relative(shipped, join(entry.parentPath, entry.name));
    const target: string = join(library, path);
    if (await exists(target)) continue;
    await mkdir(dirname(target), { recursive: true });
    await cp(join(shipped, path), target);
    added.push(target);
  }
  return added;
}

export async function initHome(home: string, opts: { library: string }): Promise<{ created: boolean }> {
  const p = homePaths(home);
  const created = !(await exists(join(home, ".git")));
  await mkdir(home, { recursive: true, mode: 0o700 });
  await mkdir(p.run, { recursive: true, mode: 0o700 });
  for (const dir of [p.libraryNodes, p.libraryRecipes, p.projects, p.themes]) await mkdir(dir, { recursive: true });
  await writeSchemas(home);
  if (!created) {
    const added: string[] = await addShippedLibraryFiles(opts.library, p.library);
    if (added.length) await commitDefinition(home, added, `library: add ${added.length} shipped ${added.length === 1 ? "file" : "files"}`);
    return { created };
  }
  await git(home, ["init", "-q", "-b", "main"]).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") throw new Error("Install Git to create PECORE_HOME, then reopen PeCore.");
    throw error;
  });
  await writeFile(join(home, ".gitignore"), homeGitignore);
  await cp(`${opts.library}/`, p.library, { recursive: true, force: false, errorOnExist: false, dereference: true });
  await git(home, ["add", "-A"]);
  await git(home, ["commit", "-q", "-m", "home: created"]);
  return { created };
}

export async function writeSchemas(home: string): Promise<void> {
  const dir = homePaths(home).schemas;
  await mkdir(dir, { recursive: true });
  for (const [file, schema] of Object.entries(jsonSchemas())) {
    await writeFile(join(dir, file), JSON.stringify(schema, null, 2) + "\n");
  }
}

export async function syncAdapters(home: string, opts: { source: string; appVersion: string; pinned: string[] }): Promise<boolean> {
  const dir = homePaths(home).adapters;
  const versionFile = join(dir, "version");
  const current = await readFile(versionFile, "utf8").catch(() => null);
  if (current?.trim() === opts.appVersion && (!(await exists(join(opts.source, "orchestrator-mcp.mjs"))) || (await exists(join(dir, "orchestrator-mcp.mjs"))))) return false;
  await mkdir(dir, { recursive: true });
  await cp(`${opts.source}/`, dir, { recursive: true, force: true, preserveTimestamps: true, dereference: true });
  const keep = new Set(["version", "node", "orchestrator-mcp.mjs", ...opts.pinned]);
  for (const entry of await readdir(dir)) {
    if (entry.startsWith("@")) {
      for (const inner of await readdir(join(dir, entry))) if (!keep.has(`${entry}/${inner}`)) await rm(join(dir, entry, inner), { recursive: true, force: true });
      if ((await readdir(join(dir, entry))).length === 0) await rm(join(dir, entry), { recursive: true, force: true });
    } else if (!keep.has(entry)) await rm(join(dir, entry), { recursive: true, force: true });
  }
  await chmod(dir, 0o755);
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    if (entry.isDirectory()) await chmod(path, 0o755);
    else if (entry.isFile()) await chmod(path, (await stat(path)).mode & 0o111 ? 0o755 : 0o644);
  }
  await writeFile(versionFile, opts.appVersion + "\n");
  return true;
}
