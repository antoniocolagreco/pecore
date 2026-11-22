import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { Accounts, Project } from "@pecore/schemas";
import type { ProjectContext } from "../graph/executor";
import { credentialHelper, forgeEnv } from "../runners/forge-env";
import { gitApp, gitAppIn, gitAppResult } from "../workdir/git-as";
import { branchHead } from "../workdir/repo";
import { forgeAccountOf } from "./create";
import { loadForgeDefaults } from "./defaults";

const execFileAsync = promisify(execFile);
const readers: WeakMap<ProjectContext, number> = new WeakMap();
const changing: WeakSet<ProjectContext> = new WeakSet();

export class ProjectLocationConflict extends Error {}

export async function withProjectLocation<T>(ctx: ProjectContext, run: () => Promise<T>): Promise<T> {
  if (changing.has(ctx)) throw new ProjectLocationConflict("The project repository or folder is being changed. Try again after the save completes.");
  readers.set(ctx, (readers.get(ctx) ?? 0) + 1);
  try {
    return await run();
  } finally {
    readers.set(ctx, readers.get(ctx)! - 1);
  }
}

export function sameRepository(a: Project["repo"], b: Project["repo"]): boolean {
  return a?.url === b?.url && a?.account === b?.account;
}

export function absoluteProjectFolder(input: string | null): string | null {
  if (input === null) return null;
  const folder: string = input === "~" || input.startsWith("~/") ? join(homedir(), input.slice(1)) : input;
  if (!isAbsolute(folder) || folder.includes("\0")) throw new Error("Enter an absolute path for the project folder.");
  return resolve(folder);
}

function within(parent: string, path: string): boolean {
  const offset: string = relative(parent, path);
  return offset !== ".." && !offset.startsWith(`..${sep}`) && !isAbsolute(offset);
}

async function folderInfo(path: string) {
  return lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
}

async function moveFolder(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    await execFileAsync("mv", ["--no-target-directory", "--", from, to]);
  }
}

async function validateFolder(path: string, home: string): Promise<{ exists: boolean; empty: boolean }> {
  const info = await folderInfo(path);
  if (info && !info.isDirectory()) throw new Error(`${path} must be a folder and cannot be a symbolic link.`);
  const absolute: string = info ? await realpath(path) : join(await realpath(dirname(path)), basename(path));
  if (within(home, absolute) || within(absolute, home)) throw new Error("Choose a folder outside the application data directory.");
  return { exists: info !== null, empty: info === null || (await readdir(path)).length === 0 };
}

async function fetchHead(repo: string, next: Project, url: string, ctx: ProjectContext, accounts: Accounts): Promise<string> {
  const account = forgeAccountOf(next, accounts);
  const defaults = account ? await loadForgeDefaults(ctx.library, account.forge) : null;
  const config: string[] = defaults?.credentialHelper ? credentialHelper(defaults.credentialHelper) : [];
  await gitApp(repo, [...config, "fetch", "--no-tags", "--no-recurse-submodules", "--", url, `refs/heads/${next.baseBranch}`], { env: account ? await forgeEnv(account) : {} });
  return (await gitApp(repo, ["rev-parse", "FETCH_HEAD^{commit}"])).trim();
}

async function updateCheckoutOrigin(folder: string, before: string | null, after: string | null, undo: (() => Promise<unknown>)[]): Promise<void> {
  if (!(await folderInfo(join(folder, ".git")))?.isDirectory()) return;
  const origin: string = (await gitAppIn(folder, ["config", "--local", "--get-all", "remote.origin.url"], { allowFail: true })).trim();
  const push: string = (await gitAppIn(folder, ["config", "--local", "--get-all", "remote.origin.pushurl"], { allowFail: true })).trim();
  if (origin === (after ?? "") || (origin && origin !== before) || push) return;
  const path: string = join(folder, ".git", "config");
  const previous: Buffer = await readFile(path);
  undo.push(() => writeFile(path, previous));
  if (origin && after) await gitAppIn(folder, ["remote", "set-url", "origin", after]);
  else if (after) await gitAppIn(folder, ["remote", "add", "origin", after]);
  else await gitAppIn(folder, ["config", "--local", "--remove-section", "remote.origin"]);
}

export async function changeProjectLocation<T>(ctx: ProjectContext, current: Project, next: Project, accounts: Accounts, persist: () => Promise<T>): Promise<T> {
  if (readers.get(ctx) || changing.has(ctx)) throw new ProjectLocationConflict("The project's repository is in use. Try again in a moment.");
  changing.add(ctx);
  const undo: (() => Promise<unknown>)[] = [];
  let temporary: string | null = null;
  try {
    const repo: string = join(ctx.dir, "repo.git");
    const home: string = await realpath(dirname(dirname(ctx.dir)));
    const ref: string = `refs/heads/${next.baseBranch}`;
    if (next.repo && !sameRepository(current.repo, next.repo) && !/^(?:(?:https?|ssh|git):\/\/[^\s]+|[^\s@/:]+@[^\s/:]+:[^\s]+)$/.test(next.repo.url)) {
      throw new Error("Enter a Git repository URL using HTTPS, SSH or the Git protocol.");
    }
    await gitApp(repo, ["check-ref-format", ref]);
    const beforeHead: string | null = await branchHead(repo, next.baseBranch);
    const configured: string = (await gitAppResult(repo, ["config", "--local", "--get", "remote.origin.url"])).stdout.trim();
    const url: string | null = next.repo?.url ?? next.folder;
    const source: string | null = current.folder && await folderInfo(current.folder) ? current.folder : null;
    const folder: string | null = next.folder;
    const folderChanged: boolean = folder !== current.folder;
    const destination = folderChanged && folder ? await validateFolder(folder, home) : null;
    if (destination && source && folder) {
      const from: string = await realpath(source);
      const to: string = join(await realpath(dirname(folder)), basename(folder));
      if (within(from, to) || within(to, from)) throw new Error("Choose a destination separate from the current project folder.");
      if (!destination.empty) throw new Error("Choose an empty destination folder to move your project.");
      const top: string = (await gitAppIn(source, ["rev-parse", "--show-toplevel"])).trim();
      if (from !== top || !(await folderInfo(join(source, ".git")))?.isDirectory()) throw new Error("Only a standalone Git checkout can be moved.");
      await validateFolder(source, home);
    }
    if (destination && !destination.empty && folder && !source) {
      const top: string = (await gitAppIn(folder, ["rev-parse", "--show-toplevel"])).trim();
      if (top !== await realpath(folder)) throw new Error("Choose an empty folder or the root of a Git checkout.");
    }
    const localBase: string | null = folder && (source ?? (destination && !destination.empty ? folder : null));
    const fetchFrom: string | null = next.repo
      ? !sameRepository(current.repo, next.repo) || current.baseBranch !== next.baseBranch || !beforeHead ? next.repo.url : null
      : localBase;
    const head: string | null = fetchFrom ? await fetchHead(repo, next, fetchFrom, ctx, accounts) : beforeHead;
    if (!head) throw new Error(`Branch ${next.baseBranch} was not found.`);

    if (head !== beforeHead) {
      if (beforeHead) await gitApp(repo, ["update-ref", `refs/pecore/previous-bases/${beforeHead}`, beforeHead]);
      await gitApp(repo, ["update-ref", ref, head]);
      undo.push(() => gitApp(repo, beforeHead ? ["update-ref", ref, beforeHead, head] : ["update-ref", "-d", ref, head]));
    }
    if (destination && folder) {
      if (destination.exists && source) {
        const info = await folderInfo(folder);
        if (!info?.isDirectory() || (await readdir(folder)).length) throw new Error("The destination folder changed. Choose an empty folder.");
      }
      if (source) {
        await moveFolder(source, folder);
        undo.push(async () => {
          await moveFolder(folder, source);
          if (destination.exists) await mkdir(folder);
        });
      } else if (destination.empty) {
        temporary = await mkdtemp(join(dirname(folder), ".pecore-checkout-"));
        await gitAppIn(temporary, ["clone", "-q", "--no-hardlinks", "-b", next.baseBranch, "--", repo, "."]);
        if (next.repo) await gitAppIn(temporary, ["remote", "set-url", "origin", next.repo.url]);
        else await gitAppIn(temporary, ["remote", "remove", "origin"]);
        await moveFolder(temporary, folder);
        const staged: string = temporary;
        undo.push(async () => {
          await moveFolder(folder, staged);
          if (destination.exists) await mkdir(folder);
        });
      }
    }
    if ((url ?? "") !== configured) {
      const path: string = join(repo, "config");
      const previous: Buffer = await readFile(path);
      undo.push(() => writeFile(path, previous));
      await gitAppResult(repo, ["config", "--local", "--remove-section", "remote.origin"]);
      if (url) await gitApp(repo, ["remote", "add", "origin", url]);
    }
    if (folder && current.repo?.url !== next.repo?.url) await updateCheckoutOrigin(folder, current.repo?.url ?? null, next.repo?.url ?? null, undo);
    return await persist();
  } catch (error) {
    const failures: string[] = [];
    for (const restore of undo.reverse()) await restore().catch((failure: unknown) => failures.push((failure as Error).message));
    if (failures.length) throw new Error(`${(error as Error).message}\nCould not restore the previous project location. ${failures.join(". ")}`, { cause: error });
    throw error;
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true }).catch((error: unknown) => console.error("remove staged checkout:", error));
    changing.delete(ctx);
  }
}
