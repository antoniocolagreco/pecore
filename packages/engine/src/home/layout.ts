import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { jsonSchemas } from "@pecore/schemas";
import { git } from "./git-commit";

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
  "run/",
  "",
].join("\n");

export function homePaths(home: string) {
  return {
    home,
    settings: join(home, "settings.json"),
    accounts: join(home, "accounts.json"),
    profiles: join(home, "profiles.json"),
    tiers: join(home, "tiers.json"),
    chatsDb: join(home, "chats.db"),
    library: join(home, "library"),
    libraryNodes: join(home, "library", "nodes"),
    libraryRecipes: join(home, "library", "recipes"),
    projects: join(home, "projects"),
    connectors: join(home, "connectors"),
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

export async function initHome(home: string, opts: { library: string }): Promise<{ created: boolean }> {
  const p = homePaths(home);
  const created = !(await exists(join(home, ".git")));
  await mkdir(home, { recursive: true, mode: 0o700 });
  await mkdir(p.run, { recursive: true, mode: 0o700 });
  for (const dir of [p.libraryNodes, p.libraryRecipes, p.projects, p.connectors, p.themes]) await mkdir(dir, { recursive: true });
  await writeSchemas(home);
  if (!created) return { created };
  await git(home, ["init", "-q", "-b", "main"]);
  await writeFile(join(home, ".gitignore"), homeGitignore);
  await cp(opts.library, p.library, { recursive: true, force: false, errorOnExist: false });
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
  if (current?.trim() === opts.appVersion) return false;
  await mkdir(dir, { recursive: true });
  await cp(opts.source, dir, { recursive: true, force: true, preserveTimestamps: true });
  const keep = new Set(["version", "node", ...opts.pinned]);
  for (const entry of await readdir(dir)) {
    if (!keep.has(entry)) await rm(join(dir, entry), { recursive: true, force: true });
  }
  await writeFile(versionFile, opts.appVersion + "\n");
  return true;
}
