import { chmod, cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

export function homePaths(home: string) {
  return {
    home,
    chatsDb: join(home, "chats.db"),
    chats: join(home, "chats"),
    harness: join(home, "harness"),
    templates: join(home, "templates"),
    templateNodes: join(home, "templates", "nodes"),
    templateRecipes: join(home, "templates", "recipes"),
    projects: join(home, "projects"),
    test: join(home, "test"),
    adapters: join(home, "adapters"),
    run: join(home, "run"),
    lock: join(home, "run", "lock"),
    apiFile: join(home, "run", "api.json"),
  };
}

export function projectPaths(projectDir: string) {
  return {
    dir: projectDir,
    nodes: join(projectDir, "nodes"),
    recipes: join(projectDir, "recipes"),
    knowledge: join(projectDir, "knowledge"),
    db: join(projectDir, "pecore.db"),
    repo: join(projectDir, "repo.git"),
    work: join(projectDir, "work"),
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

export async function initHome(home: string): Promise<void> {
  const paths: ReturnType<typeof homePaths> = homePaths(home);
  await mkdir(home, { recursive: true, mode: 0o700 });
  await mkdir(paths.run, { recursive: true, mode: 0o700 });
  await mkdir(paths.projects, { recursive: true, mode: 0o700 });
}

export async function syncAdapters(home: string, opts: { source: string; appVersion: string; pinned: string[] }): Promise<boolean> {
  const dir = homePaths(home).adapters;
  const versionFile = join(dir, "version");
  const current = await readFile(versionFile, "utf8").catch(() => null);
  if (current?.trim() === opts.appVersion) {
    const chatMcp: boolean = !(await exists(join(opts.source, "chat-mcp.mjs"))) || (await exists(join(dir, "chat-mcp.mjs")));
    const adapters: boolean[] = await Promise.all(opts.pinned.map((entry) => exists(join(dir, entry))));
    if (chatMcp && adapters.every(Boolean)) return false;
  }
  await mkdir(dir, { recursive: true });
  await cp(`${opts.source}/`, dir, { recursive: true, force: true, preserveTimestamps: true, dereference: true });
  const keep = new Set(["version", "node", "chat-mcp.mjs", ...opts.pinned]);
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
