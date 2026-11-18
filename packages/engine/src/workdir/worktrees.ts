import { join } from "node:path";
import { gitWork, gitWorkResult } from "./git-as";
import { jobBranch } from "./repo";

export function workdirOf(projectDir: string, jobId: string): string {
  return join(projectDir, "work", jobId);
}

export async function addWorktree(user: string, projectDir: string, jobId: string, base: string): Promise<string> {
  const dir = workdirOf(projectDir, jobId);
  await gitWork(user, projectDir, [`--git-dir=${join(projectDir, "repo.git")}`, "worktree", "add", "-q", "-b", jobBranch(jobId), dir, base]);
  return dir;
}

export async function recreateWorktree(user: string, projectDir: string, jobId: string): Promise<string> {
  const dir = workdirOf(projectDir, jobId);
  await gitWork(user, projectDir, [`--git-dir=${join(projectDir, "repo.git")}`, "worktree", "prune"]);
  await gitWork(user, projectDir, [`--git-dir=${join(projectDir, "repo.git")}`, "worktree", "add", "-q", dir, jobBranch(jobId)]);
  return dir;
}

export async function removeWorktree(user: string, projectDir: string, dir: string): Promise<void> {
  const gitDir = `--git-dir=${join(projectDir, "repo.git")}`;
  await gitWorkResult(user, projectDir, [gitDir, "worktree", "remove", "--force", "--force", dir]);
  await gitWorkResult(user, projectDir, [gitDir, "worktree", "prune"]);
}
