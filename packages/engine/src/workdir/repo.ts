import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { gitApp, gitAppResult } from "./git-as";

const emptyTree = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export async function createLocalRepo(repoGit: string, baseBranch: string): Promise<string> {
  await mkdir(repoGit, { recursive: true });
  await gitApp(repoGit, ["init", "-q", "--bare", "-b", baseBranch]);
  const tree = (await gitApp(repoGit, ["mktree"], { input: "" })).trim();
  if (tree !== emptyTree) throw new Error(`unexpected empty tree ${tree}`);
  const commit = (await gitApp(repoGit, ["commit-tree", tree, "-m", "Initial commit"])).trim();
  await gitApp(repoGit, ["update-ref", `refs/heads/${baseBranch}`, commit]);
  await configureRepo(repoGit);
  return commit;
}

export async function configureRepo(repoGit: string): Promise<void> {
  await gitApp(repoGit, ["config", "core.sharedRepository", "group"]);
  await gitApp(repoGit, ["config", "gc.auto", "0"]);
  await gitApp(repoGit, ["config", "maintenance.auto", "false"]);
  await gitApp(repoGit, ["config", "extensions.worktreeConfig", "false"]);
  await mkdir(join(repoGit, "info"), { recursive: true });
  const exclude = join(repoGit, "info", "exclude");
  const current = await readFile(exclude, "utf8").catch(() => "");
  if (!current.split("\n").includes(".pecore/")) await appendFile(exclude, (current.endsWith("\n") || current === "" ? "" : "\n") + ".pecore/\n");
}

export async function branchHead(repoGit: string, branch: string): Promise<string | null> {
  const r = await gitAppResult(repoGit, ["rev-parse", "-q", "--verify", `refs/heads/${branch}^{commit}`]);
  return r.code === 0 ? r.stdout.trim() : null;
}

export async function deleteBranch(repoGit: string, branch: string): Promise<void> {
  await gitAppResult(repoGit, ["update-ref", "-d", `refs/heads/${branch}`]);
}

export function jobBranch(jobId: string): string {
  return `factory/${jobId}`;
}
