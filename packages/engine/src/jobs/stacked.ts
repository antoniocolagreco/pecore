import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Artifact, ForgeAccount, Project, StoredEvent } from "@pecore/schemas";
import { loadForgeDefaults } from "../projects/defaults";
import { forgeEnv } from "../runners/forge-env";
import { branchHead, fetchBranch } from "../workdir/repo";

export function reentryPending(events: StoredEvent[], onBaseChanged: string | undefined): boolean {
  if (onBaseChanged === undefined) return false;
  let started = false;
  let pending = false;
  for (const e of events) {
    if (e.type === "node_run.created") {
      if (started && e.payload.node === onBaseChanged && e.payload.viaEdge === null) pending = false;
      started = true;
    }
    if (e.type === "job.base_changed" && started) pending = true;
  }
  return pending;
}

export function latestArtifact(events: StoredEvent[], type: Artifact["type"]): Artifact | undefined {
  let found: Artifact | undefined;
  for (const e of events) if (e.type === "node_run.completed") for (const a of e.payload.artifacts) if (a.type === type) found = a;
  return found;
}

export async function commitSha(projectDir: string, artifact: Artifact | undefined): Promise<string | null> {
  if (!artifact) return null;
  return (JSON.parse(await readFile(join(projectDir, artifact.path), "utf8")) as { sha: string }).sha;
}

export async function fetchBase(
  ctx: { dir: string; project: Project; templates: string; forgeAccount(id: string): ForgeAccount | undefined },
  branch: string,
): Promise<string> {
  const repoGit = join(ctx.dir, "repo.git");
  if (ctx.project.repo !== null) {
    const account = ctx.forgeAccount(ctx.project.repo.account);
    if (!account) throw new Error(`forge account ${ctx.project.repo.account} not found`);
    const defaults = await loadForgeDefaults(ctx.templates, account.forge);
    await fetchBranch(repoGit, branch, defaults.credentialHelper, await forgeEnv(account));
  } else if (ctx.project.folder !== null) {
    await fetchBranch(repoGit, branch, null, {}).catch(() => undefined);
  }
  const head = await branchHead(repoGit, branch);
  if (!head) throw new Error(`branch ${branch} not found`);
  return head;
}
