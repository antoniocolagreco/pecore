import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { Project } from "@pecore/schemas";
import type { Accounts, ForgeAccount, ProjectInput } from "@pecore/schemas";
import { protectedUser } from "../accounts/agents";
import { readSubject, recordConfirmation, subjectSha } from "../definitions/confirm";
import { instantiateNode, instantiateRecipe } from "../definitions/instantiate";
import { loadNodeFile } from "../definitions/load";
import { commitDefinition, commitMessage } from "../home/git-commit";
import { homePaths, projectPaths } from "../home/layout";
import { checkHome } from "../osuser/home-check";
import type { HomeFinding } from "../osuser/home-check";
import { projectAccessScript } from "../osuser/script";
import { forgeEnv } from "../runners/forge-env";
import { appUser } from "../runners/process";
import { ProjectDb } from "../store/project-db";
import { gitApp } from "../workdir/git-as";
import { cloneRepo, createLocalRepo, deleteBranch, jobBranch } from "../workdir/repo";
import { loadForgeDefaults, projectDefaults } from "./defaults";
import type { DefaultRecipe } from "./defaults";

const execFileP = promisify(execFile);

export const setupJobId = "project-setup";

export type CreationStep = 1 | 3 | 4 | 5 | 6;
export type Creation = { step: CreationStep; recipes: string[] };
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

export async function writeCreation(dir: string, step: CreationStep, recipes: string[]): Promise<void> {
  await writeFile(creatingFile(dir), JSON.stringify({ step, recipes } satisfies Creation) + "\n");
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

function check<T>(step: number, r: { errors: { file: string; path: string; message: string }[] } & T): T {
  if (r.errors.length) throw new ProjectCreateError(step, r.errors.map((e) => `${e.file} ${e.path}: ${e.message}`).join("; "));
  return r;
}

export async function beginProject(home: string, input: ProjectInput, recipes: string[], opts: CreateOptions, bundledLibrary: string): Promise<Project> {
  const parsed = Project.safeParse({ $schema: "../../schemas/project.json", ...input });
  if (!parsed.success) throw new ProjectCreateError(1, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const project = parsed.data;
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
    const defaults = await projectDefaults(library, project.repo, account?.forge ?? null, recipes.filter((r): r is DefaultRecipe => ["feature", "bugfix", "local-only"].includes(r)));
    if (project.createRepo !== null && defaults.forge?.createRepo === null) {
      throw new ProjectCreateError(1, "This forge requires an existing repository.");
    }
    for (const name of recipes) check(3, await instantiateRecipe(library, dir, name, defaults.rename));
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
    await writeCreation(dir, 3, recipes);
    return project;
  } catch (e) {
    await rm(dir, { recursive: true, force: true });
    if (e instanceof ProjectCreateError) throw e;
    throw new ProjectCreateError(3, (e as Error).message);
  }
}

export async function prepareRepo(home: string, dir: string, project: Project, opts: CreateOptions): Promise<"ready" | "setup"> {
  const repo = projectPaths(dir).repo;
  const creation = (await readCreation(dir))!;
  try {
    if (project.repo === null || project.createRepo !== null) {
      if (!(await exists(repo))) await createLocalRepo(repo, project.baseBranch);
      if (project.repo !== null) return "setup";
    } else {
      const account = forgeAccountOf(project, opts.accounts)!;
      const defaults = await loadForgeDefaults(homePaths(home).library, account.forge);
      await rm(repo, { recursive: true, force: true });
      await cloneRepo(repo, project.repo.url, defaults.credentialHelper, await forgeEnv(account));
    }
  } catch (e) {
    if (e instanceof ProjectCreateError) throw e;
    throw new ProjectCreateError(4, (e as Error).message);
  }
  await writeCreation(dir, 4, creation.recipes);
  return "ready";
}

export async function repoCreated(dir: string, project: Project): Promise<void> {
  const repo = projectPaths(dir).repo;
  const creation = (await readCreation(dir))!;
  await gitApp(repo, ["remote", "remove", "origin"], { allowFail: true });
  await gitApp(repo, ["remote", "add", "origin", project.repo!.url]);
  await gitApp(repo, ["config", "--replace-all", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"]);
  await deleteBranch(repo, jobBranch(setupJobId));
  await writeCreation(dir, 4, creation.recipes);
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
    await writeCreation(dir, 5, creation.recipes);
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
