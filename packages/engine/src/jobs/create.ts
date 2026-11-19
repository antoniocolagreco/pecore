import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { monotonicFactory } from "ulid";
import type { Artifact, Recipe } from "@pecore/schemas";
import { checkRecipe, hasCommitNode } from "../definitions/recipe-check";
import type { JobRow, ProjectContext } from "../graph/executor";
import { jobBranch } from "../workdir/repo";
import { commitSha, fetchBase, latestArtifact } from "./stacked";

const ulid = monotonicFactory();

export class JobCreateError extends Error {}

function fail(e: unknown): never {
  throw new JobCreateError((e as Error).message);
}

export type CreateJob = {
  title: string;
  ticket: { text: string; source?: string; id?: string };
  recipe?: string;
  baseBranch?: string;
  parentJobId?: string | null;
};

export async function createJob(ctx: ProjectContext, req: CreateJob): Promise<string> {
  const recipeName = req.recipe ?? ctx.project.defaultRecipe;
  const recipe = ctx.defs.recipes.get(recipeName);
  if (!recipe) throw new JobCreateError(`recipe ${recipeName} not found in project ${ctx.id}`);
  const issues = checkRecipe(recipe, ctx.defs.nodes);
  if (issues.length) throw new JobCreateError(`recipe ${recipeName} is not valid: ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`);
  const parent = req.parentJobId ? (ctx.db.db.prepare("SELECT * FROM jobs WHERE id = ?").get(req.parentJobId) as JobRow | undefined) : null;
  if (parent === undefined) throw new JobCreateError(`parent job ${req.parentJobId} not found`);
  let baseBranch = req.baseBranch ?? ctx.project.baseBranch;
  let target = baseBranch;
  let base: string;
  let reason: "parent_job" | "parent_failed" | null = null;
  if (parent) {
    if (!hasCommitNode(JSON.parse(parent.recipe) as Recipe, ctx.defs.nodes)) throw new JobCreateError(`the recipe of parent job ${parent.id} has no commit node`);
    baseBranch = parent.base_branch;
    target = parent.merged_at === null ? parent.branch : parent.target;
    const sha = await commitSha(ctx.dir, latestArtifact(ctx.db.events(parent.id), "commit"));
    if (parent.merged_at !== null) base = await fetchBase(ctx, target).catch((e: unknown) => fail(e));
    else if (parent.state === "succeeded" && sha) base = sha;
    else {
      base = parent.base;
      reason = parent.state === "not_delivered" || parent.state === "failed" || parent.state === "stopped" ? "parent_failed" : "parent_job";
    }
  } else base = await fetchBase(ctx, baseBranch).catch((e: unknown) => fail(e));
  const id = ulid();
  const dir = join(ctx.dir, "artifacts", id, "ticket");
  await mkdir(dir, { recursive: true });
  const content = JSON.stringify({ untrusted: true, title: req.title, text: req.ticket.text, source: req.ticket.source ?? null, id: req.ticket.id ?? null }, null, 2);
  const path = join(dir, "ticket.json");
  await writeFile(path, content);
  const ticket: Artifact = { type: "ticket", path: relative(ctx.dir, path), sha256: createHash("sha256").update(content).digest("hex"), contentState: null };
  ctx.db.append([
    {
      jobId: id,
      type: "job.created",
      payload: { title: req.title, recipe, ticket, parentJobId: parent?.id ?? null, baseBranch, base, target, branch: jobBranch(id) },
    },
    ...(reason ? [{ jobId: id, type: "job.state_changed" as const, payload: { state: "queued" as const, reason } }] : []),
  ]);
  ctx.changed(id);
  return id;
}
