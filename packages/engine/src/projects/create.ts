import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { mkdir, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { Project } from "@pecore/schemas";
import type { Accounts, ForgeAccount, ProjectInput } from "@pecore/schemas";
import { protectedUser } from "../accounts/agents";
import { readSubject, recordConfirmation, subjectSha } from "../definitions/confirm";
import { instantiateNode } from "../definitions/instantiate";
import { loadNodeFile } from "../definitions/load";
import { commitDefinition, commitMessage } from "../home/git-commit";
import { homePaths, projectPaths } from "../home/layout";
import { checkHome } from "../osuser/home-check";
import type { HomeFinding } from "../osuser/home-check";
import { projectAccessScript } from "../osuser/script";
import { forgeEnv } from "../runners/forge-env";
import { appUser } from "../runners/process";
import { ProjectDb } from "../store/project-db";
import { gitApp, gitAppIn } from "../workdir/git-as";
import { cloneRepo, createLocalRepo, deleteBranch, jobBranch } from "../workdir/repo";
import { loadForgeDefaults } from "./defaults";

const execFileP = promisify(execFile);

export const setupJobId = "project-setup";

export type CreationStep = 1 | 3 | 4 | 5 | 6;
export type Creation = { step: CreationStep };
export type CreateOptions = { accounts: Accounts; protectedMode: boolean; admin?: (script: string) => Promise<void> };

export class ProjectCreateError extends Error {
  constructor(
    readonly step: number,
    message: string,
  ) {
    super(`step ${step}: ${message}`);
  }
}

const creatingFile = (dir: string) => join(dir, "creating.json");

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

export async function readCreation(dir: string): Promise<Creation | null> {
  const text = await readFile(creatingFile(dir), "utf8").catch(() => null);
  return text === null ? null : (JSON.parse(text) as Creation);
}

export async function writeCreation(dir: string, step: CreationStep): Promise<void> {
  await writeFile(creatingFile(dir), JSON.stringify({ step } satisfies Creation) + "\n");
}

export function repoHost(url: string): string | null {
  const scp = /^[^@/]+@([^:/]+):/.exec(url);
  if (scp) return scp[1]!;
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

export function forgeAccountOf(project: Project, accounts: Accounts): ForgeAccount | null {
  if (project.repo === null) return null;
  const account = accounts.accounts.find((a) => a.id === project.repo!.account);
  if (!account || account.kind !== "forge") throw new ProjectCreateError(1, `forge account ${project.repo.account} not found`);
  if (repoHost(project.repo.url) !== account.host) throw new ProjectCreateError(1, `account ${account.id} is for ${account.host}, not for ${project.repo.url}`);
  return account;
}

async function folderEmpty(folder: string): Promise<boolean> {
  const entries: string[] = await readdir(folder).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  return entries.length === 0;
}

async function checkFolder(input: string | null, project: Project): Promise<string | null> {
  if (input === null) return null;
  const expanded: string = input === "~" || input.startsWith("~/") ? join(homedir(), input.slice(1)) : input;
  if (!isAbsolute(expanded)) throw new ProjectCreateError(1, `the folder ${input} is not an absolute path`);
  const folder: string = resolve(expanded);
  const empty: boolean = await folderEmpty(folder).catch(() => {
    throw new ProjectCreateError(1, `${folder} is not a folder`);
  });
  if (empty) return folder;
  const top: string = (await gitAppIn(folder, ["rev-parse", "--show-toplevel"], { allowFail: true })).trim();
  if (top !== (await realpath(folder))) throw new ProjectCreateError(1, `the folder ${folder} is not empty and is not a Git repository`);
  if (project.repo === null || project.createRepo !== null) {
    const head: string = await gitAppIn(folder, ["rev-parse", "-q", "--verify", `refs/heads/${project.baseBranch}^{commit}`], { allowFail: true });
    if (!head.trim()) throw new ProjectCreateError(1, `the folder ${folder} has no branch ${project.baseBranch}`);
  }
  return folder;
}

async function setupFolder(repo: string, project: Project): Promise<void> {
  const folder: string | null = project.folder;
  if (folder === null) return;
  if (await folderEmpty(folder)) {
    await mkdir(folder, { recursive: true });
    await gitAppIn(folder, ["clone", "-q", "--no-hardlinks", "-b", project.baseBranch, "--", repo, "."]);
    if (project.repo === null) await gitAppIn(folder, ["remote", "remove", "origin"]);
    else await gitAppIn(folder, ["remote", "set-url", "origin", project.repo.url]);
  } else if (project.repo !== null && !(await gitAppIn(folder, ["remote"])).split("\n").includes("origin")) {
    await gitAppIn(folder, ["remote", "add", "origin", project.repo.url]);
  }
  if (project.repo === null) {
    await gitApp(repo, ["remote", "remove", "origin"], { allowFail: true });
    await gitApp(repo, ["remote", "add", "origin", folder]);
    await gitApp(repo, ["config", "--replace-all", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"]);
  }
}

function check<T>(step: number, r: { errors: { file: string; path: string; message: string }[] } & T): T {
  if (r.errors.length) throw new ProjectCreateError(step, r.errors.map((e) => `${e.file} ${e.path}: ${e.message}`).join("; "));
  return r;
}

export async function beginProject(home: string, input: ProjectInput, opts: CreateOptions, bundledLibrary: string): Promise<Project> {
  const parsed = Project.safeParse({ $schema: "../../schemas/project.json", ...input });
  if (!parsed.success) throw new ProjectCreateError(1, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const project: Project = { ...parsed.data, folder: await checkFolder(parsed.data.folder, parsed.data) };
  const account = forgeAccountOf(project, opts.accounts);
  const dir = join(homePaths(home).projects, project.id);
  try {
    if (mkdirSync(dir, { recursive: true, mode: 0o755 }) === undefined) throw new ProjectCreateError(1, `project ${project.id} already exists`);
  } catch (error) {
    if (error instanceof ProjectCreateError) throw error;
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new ProjectCreateError(1, `project ${project.id} already exists`);
    throw new ProjectCreateError(3, (error as Error).message);
  }
  const library = homePaths(home).library;
  const p = projectPaths(dir);
  try {
    for (const d of [p.nodes, p.recipes, p.knowledge, p.work, p.artifacts, p.logs]) await mkdir(d, { recursive: true });
    const forge = account ? await loadForgeDefaults(library, account.forge) : null;
    if (project.createRepo !== null && forge?.createRepo === null) {
      throw new ProjectCreateError(1, "This forge requires an existing repository.");
    }
    if (project.createRepo !== null) check(3, await instantiateNode(library, dir, project.createRepo));
    await writeFile(p.project, JSON.stringify(project, null, 2) + "\n");
    const db = new ProjectDb(p.db);
    try {
      if (account && (account.forge === "github" || account.forge === "gitlab") && project.createRepo === `${account.forge}-create-repo`) {
        const shippedDir: string = join(bundledLibrary, "nodes");
        const shipped = await loadNodeFile(join(shippedDir, `${project.createRepo}.json`));
        const installed = await loadNodeFile(join(p.nodes, `${project.createRepo}.json`));
        if (shipped.value?.kind === "command" && installed.value?.kind === "command") {
          const trusted = await readSubject(shippedDir, shipped.value);
          const subject = await readSubject(p.nodes, installed.value);
          const definition = { ...(trusted.definition as Record<string, unknown>), $schema: "../../../schemas/node.json" };
          if (subjectSha({ ...trusted, definition }) === subjectSha(subject)) recordConfirmation(db, subject);
        }
      }
    } finally {
      db.close();
    }
    await writeCreation(dir, 3);
    return project;
  } catch (e) {
    await rm(dir, { recursive: true, force: true });
    if (e instanceof ProjectCreateError) throw e;
    throw new ProjectCreateError(3, (e as Error).message);
  }
}

export async function prepareRepo(home: string, dir: string, project: Project, opts: CreateOptions): Promise<"ready" | "setup"> {
  const repo = projectPaths(dir).repo;
  try {
    if (project.repo === null || project.createRepo !== null) {
      if (!(await exists(repo))) {
        if (project.folder !== null && !(await folderEmpty(project.folder))) await cloneRepo(repo, project.folder, null, {});
        else await createLocalRepo(repo, project.baseBranch);
      }
      if (project.repo !== null) return "setup";
    } else {
      const account = forgeAccountOf(project, opts.accounts)!;
      const defaults = await loadForgeDefaults(homePaths(home).library, account.forge);
      await rm(repo, { recursive: true, force: true });
      await cloneRepo(repo, project.repo.url, defaults.credentialHelper, await forgeEnv(account));
    }
    await setupFolder(repo, project);
  } catch (e) {
    if (e instanceof ProjectCreateError) throw e;
    throw new ProjectCreateError(4, (e as Error).message);
  }
  await writeCreation(dir, 4);
  return "ready";
}

export async function repoCreated(dir: string, project: Project): Promise<void> {
  const repo = projectPaths(dir).repo;
  await gitApp(repo, ["remote", "remove", "origin"], { allowFail: true });
  await gitApp(repo, ["remote", "add", "origin", project.repo!.url]);
  await gitApp(repo, ["config", "--replace-all", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"]);
  await deleteBranch(repo, jobBranch(setupJobId));
  await setupFolder(repo, project);
  await writeCreation(dir, 4);
}

async function hasGroup(group: string): Promise<boolean> {
  const { stdout } = await execFileP("id", ["-Gn"]);
  return stdout.trim().split(/\s+/).includes(group);
}

export async function finishProject(home: string, dir: string, project: Project, opts: CreateOptions): Promise<HomeFinding[]> {
  const creation = (await readCreation(dir))!;
  let findings: HomeFinding[] = [];
  if (creation.step < 5) {
    try {
      findings = await checkHome();
      await commitDefinition(home, [dir], commitMessage("project", project.id, "created"));
    } catch (e) {
      throw new ProjectCreateError(5, (e as Error).message);
    }
    await writeCreation(dir, 5);
  }
  try {
    const script = projectAccessScript(dir, appUser, opts.protectedMode);
    if (opts.protectedMode && !(await hasGroup(protectedUser))) {
      if (!opts.admin) throw new Error("protected mode needs the admin prompt");
      await opts.admin(script);
    } else await execFileP("/bin/sh", ["-c", script]);
  } catch (e) {
    throw new ProjectCreateError(6, (e as Error).message);
  }
  await rm(creatingFile(dir), { force: true });
  return findings;
}

export async function cancelCreation(home: string, dir: string, id: string): Promise<void> {
  const creation = await readCreation(dir);
  await rm(dir, { recursive: true, force: true });
  if (creation && creation.step >= 5) await commitDefinition(home, [dir], commitMessage("project", id, "deleted"));
}
