import { matchesGlob } from "node:path";
import { gitWork, gitWorkResult } from "./git-as";
import { removeFilesAs } from "./fs-as";
import { jobBranch } from "./repo";

async function tempIndex(user: string, workdir: string, name: string): Promise<Record<string, string>> {
  const path = (await gitWork(user, workdir, ["rev-parse", "--path-format=absolute", "--git-path", `pecore-${name}.index`])).trim();
  return { GIT_INDEX_FILE: path };
}

export async function contentState(user: string, workdir: string): Promise<string> {
  const env = await tempIndex(user, workdir, "state");
  await gitWork(user, workdir, ["read-tree", "--empty"], { env });
  await gitWork(user, workdir, ["add", "-A", "--", "."], { env });
  await gitWork(user, workdir, ["rm", "-r", "-q", "--cached", "--ignore-unmatch", "--", ".pecore"], { env });
  return (await gitWork(user, workdir, ["write-tree"], { env })).trim();
}

export async function treeFiles(user: string, workdir: string, tree: string): Promise<Set<string>> {
  const out = await gitWork(user, workdir, ["ls-tree", "-r", "-z", "--name-only", tree]);
  return new Set(out.split("\0").filter(Boolean));
}

export async function deleteScratch(user: string, workdir: string, patterns: string[], before: string): Promise<string[]> {
  if (patterns.length === 0) return [];
  const known = await treeFiles(user, workdir, before);
  const out = await gitWork(user, workdir, ["ls-files", "-z", "--others", "--", ".", ":(exclude).pecore"]);
  const files = out.split("\0").filter((f) => f && !known.has(f) && patterns.some((p) => matchesGlob(f, p)));
  await removeFilesAs(user, workdir, files);
  return files;
}

export async function restoreState(user: string, workdir: string, tree: string): Promise<void> {
  const env = await tempIndex(user, workdir, "restore");
  await gitWork(user, workdir, ["read-tree", tree], { env });
  await gitWork(user, workdir, ["checkout-index", "-a", "-f"], { env });
  await gitWork(user, workdir, ["clean", "-f", "-d", "-q", "-e", ".pecore", "--", "."], { env });
  await gitWork(user, workdir, ["reset", "-q"]);
}

export type GitRecord = { branch: string | null; head: string | null };

async function revParse(user: string, workdir: string, ref: string): Promise<string | null> {
  const r = await gitWorkResult(user, workdir, ["rev-parse", "-q", "--verify", ref]);
  return r.code === 0 ? r.stdout.trim() : null;
}

export async function recordGit(user: string, workdir: string, jobId: string): Promise<GitRecord> {
  return {
    branch: await revParse(user, workdir, `refs/heads/${jobBranch(jobId)}`),
    head: await revParse(user, workdir, "HEAD"),
  };
}

export async function undoInterrupted(user: string, workdir: string, jobId: string, rec: GitRecord, contentBefore: string): Promise<void> {
  for (const op of [["rebase", "--abort"], ["merge", "--abort"], ["cherry-pick", "--abort"], ["revert", "--abort"], ["am", "--abort"]]) {
    await gitWorkResult(user, workdir, op);
  }
  const branch = `refs/heads/${jobBranch(jobId)}`;
  if (rec.branch) await gitWork(user, workdir, ["update-ref", branch, rec.branch]);
  await gitWork(user, workdir, ["symbolic-ref", "HEAD", branch]);
  if (rec.head && rec.head !== rec.branch) await gitWork(user, workdir, ["update-ref", "--no-deref", "HEAD", rec.head]);
  await restoreState(user, workdir, contentBefore);
}

export async function commitTree(user: string, workdir: string): Promise<string> {
  return (await gitWork(user, workdir, ["rev-parse", "HEAD^{tree}"])).trim();
}

export async function createCleanCheckout(user: string, workdir: string, tree: string, dir: string): Promise<void> {
  const parent = (await gitWork(user, workdir, ["rev-parse", "HEAD"])).trim();
  const commit = (await gitWork(user, workdir, ["commit-tree", tree, "-p", parent, "-m", "pecore clean checkout"])).trim();
  await gitWork(user, workdir, ["worktree", "add", "-q", "--detach", dir, commit]);
}

export async function removeCleanCheckout(user: string, workdir: string, dir: string): Promise<void> {
  await gitWorkResult(user, workdir, ["worktree", "remove", "--force", "--force", dir]);
  await gitWorkResult(user, workdir, ["worktree", "prune"]);
}
