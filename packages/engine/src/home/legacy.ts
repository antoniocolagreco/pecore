import { chmod, lstat, mkdir, readdir, rename, rm } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { protectedUser } from "../accounts/agents";
import { privateDirectory } from "../osuser/acl";
import { appUser, baseEnv, run } from "../runners/process";
import { homePaths } from "./layout";

const legacyHarness = ".pecore-harness";
const legacyChats = ".pecore-chats";

async function exists(path: string): Promise<boolean> {
  return lstat(path).then(() => true, () => false);
}

const opened: RegExp[] = [/^adapters$/, /^chats$/, /^harness\/(?!.*\/)/, /^projects\/[^/]+\/(work|repo\.git)$/];

export async function closeHome(home: string): Promise<void> {
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const path: string = join(dir, entry.name);
      const rel: string = relative(home, path);
      if (entry.isSymbolicLink() || opened.some((pattern) => pattern.test(rel))) continue;
      const info = await lstat(path).catch(() => null);
      if (!info) continue;
      const mode: number = info.mode & 0o7777;
      const closed: number = entry.isDirectory() ? mode & ~0o007 : mode & ~0o077;
      if (closed !== mode) await chmod(path, closed);
      if (entry.isDirectory()) await walk(path);
    }
  };
  await walk(home);
}

export async function moveLegacyFolders(home: string, protectedUserExists: boolean): Promise<void> {
  const harness: string = homePaths(home).harness;
  const appHome: string = (await baseEnv(appUser)).HOME!;
  if (resolve(home) !== join(resolve(appHome), ".pecore")) return;
  const appTarget: string = join(harness, appUser);
  if (await exists(join(appHome, legacyHarness)) && !(await exists(appTarget))) {
    await mkdir(harness, { recursive: true, mode: 0o700 });
    await rename(join(appHome, legacyHarness), appTarget);
  }
  await rm(join(appHome, legacyChats), { recursive: true, force: true });
  if (!protectedUserExists) return;
  const env = await baseEnv(protectedUser);
  const agentHome: string = env.HOME!;
  const agentTarget: string = join(harness, protectedUser);
  const moved: boolean = await exists(agentTarget);
  await privateDirectory(agentTarget, protectedUser, home);
  const script: string = [
    `if [ ${moved ? "1" : "0"} = 0 ] && [ -d "$1" ] && [ ! -L "$1" ]; then cp -a -- "$1"/. "$2"/ && rm -rf -- "$1" || exit 1; fi`,
    'rm -rf -- "$3"',
  ].join("; ");
  const argv: string[] = ["/bin/sh", "-c", script, "sh", join(agentHome, legacyHarness), agentTarget, join(agentHome, legacyChats)];
  const result = await run({ user: protectedUser, argv, env, cwd: sep });
  if (result.code !== 0) throw new Error(`moving ${protectedUser}'s folders into ${home} failed: ${result.stderr.trim()}`);
}
