import { join } from "node:path";
import { recipeStart, ReferenceArtifact } from "@pecore/schemas";
import type { Artifact, ForgeAccount, Project, StoredEvent } from "@pecore/schemas";
import { loadForgeDefaults } from "../projects/defaults";
import { forgeEnv } from "../runners/forge-env";
import type { ProjectDb } from "../store/project-db";
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

export type JobArtifact = { artifact: Artifact; node: string | null };

export function nodeOfRun(nodeRunId: string): string {
  return nodeRunId.slice(nodeRunId.indexOf("/") + 1, nodeRunId.lastIndexOf("#"));
}

export function jobArtifacts(events: StoredEvent[]): JobArtifact[] {
  const out: JobArtifact[] = [];
  for (const e of events) {
    if (e.type === "job.created") {
      if (e.payload.ticket) out.push({ artifact: e.payload.ticket, node: recipeStart });
      for (const artifact of e.payload.attachments ?? []) out.push({ artifact, node: null });
    }
    if (e.type === "node_run.completed") for (const artifact of e.payload.artifacts) out.push({ artifact, node: nodeOfRun(e.payload.nodeRunId) });
    if (e.type === "job.ci_check" && e.payload.log) out.push({ artifact: e.payload.log, node: nodeOfRun(e.payload.runId) });
  }
  return out;
}

export function readReference(db: ProjectDb, artifact: Artifact): ReferenceArtifact {
  return ReferenceArtifact.parse(JSON.parse(db.requireArtifact(artifact).toString("utf8")));
}

export function latestReference(db: ProjectDb, artifacts: JobArtifact[], has: (reference: ReferenceArtifact, node: string | null) => boolean): (JobArtifact & { reference: ReferenceArtifact }) | undefined {
  for (const found of artifacts.toReversed()) {
    if (found.artifact.type !== "reference") continue;
    const reference: ReferenceArtifact = readReference(db, found.artifact);
    if (has(reference, found.node)) return { ...found, reference };
  }
  return undefined;
}

export function jobCommit(db: ProjectDb, events: StoredEvent[]): string | null {
  return latestReference(db, jobArtifacts(events), (reference) => reference.sha !== undefined)?.reference.sha ?? null;
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
