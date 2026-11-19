import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { monotonicFactory } from "ulid";
import { Recipe } from "@pecore/schemas";
import type { Artifact } from "@pecore/schemas";
import { blockingImportItem } from "../definitions/confirm";
import type { RecipeChangeSubject } from "../definitions/confirm";
import { checkRecipe, hasCommitNode } from "../definitions/recipe-check";
import type { JobRow, ProjectContext } from "../graph/executor";
import { jobBranch } from "../workdir/repo";
import { commitSha, fetchBase, latestArtifact } from "./stacked";

const ulid = monotonicFactory();

export class JobCreateError extends Error {}
export type JobAttachment = { name: string; data: Buffer };

function fail(e: unknown): never {
  throw new JobCreateError((e as Error).message);
}

export type CreateJob = {
  title: string;
  ticket: { text: string; source?: string; id?: string };
  recipe?: string;
  baseBranch?: string;
  parentJobId?: string | null;
  orderId?: string;
  orderKey?: string;
  attachments?: JobAttachment[];
  recipeConfirmationId?: string;
};

export function recipeForJob(ctx: ProjectContext, recipeName: string, confirmationId?: string): Recipe {
  let recipe: Recipe | undefined = ctx.defs.recipes.get(recipeName);
  if (confirmationId) {
    const item = ctx.db.db.prepare("SELECT subject FROM human_queue WHERE id = ? AND kind = 'recipe-change'").get(confirmationId) as { subject: string } | undefined;
    const subject: RecipeChangeSubject | undefined = item && JSON.parse(item.subject) as RecipeChangeSubject;
    if (subject?.path !== `projects/${ctx.id}/recipes/${recipeName}.json`) throw new JobCreateError(`no recipe change ${confirmationId} for ${recipeName}`);
    recipe = Recipe.parse(JSON.parse(subject.content));
  }
  if (!recipe) throw new JobCreateError(`recipe ${recipeName} not found in project ${ctx.id}`);
  const issues = checkRecipe(recipe, ctx.defs.nodes);
  if (issues.length) throw new JobCreateError(`recipe ${recipeName} is not valid: ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`);
  return recipe;
}

export async function createJob(ctx: ProjectContext, req: CreateJob): Promise<string> {
  if ((req.orderId === undefined) !== (req.orderKey === undefined)) throw new JobCreateError("orderId and orderKey must be set together");
  const recipe: Recipe = recipeForJob(ctx, req.recipe ?? ctx.project.defaultRecipe, req.recipeConfirmationId);
  const parent = req.parentJobId ? (ctx.db.db.prepare("SELECT * FROM jobs WHERE id = ?").get(req.parentJobId) as JobRow | undefined) : null;
  if (parent === undefined) throw new JobCreateError(`parent job ${req.parentJobId} not found`);
  let baseBranch = req.baseBranch ?? ctx.project.baseBranch;
  let target = baseBranch;
  let base: string;
  let reason: "parent_job" | "parent_failed" | "confirmation" | null = req.recipeConfirmationId ? "confirmation" : null;
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
  const attachments: Artifact[] = [];
  if (req.attachments?.length) {
    const attachmentDir: string = join(ctx.dir, "artifacts", id, "attachments");
    await mkdir(attachmentDir, { recursive: true });
    for (const { name, data } of req.attachments) {
      const file: string = join(attachmentDir, name);
      await writeFile(file, data, { mode: 0o600 });
      attachments.push({ type: "attachment", path: relative(ctx.dir, file), sha256: createHash("sha256").update(data).digest("hex"), contentState: null });
    }
  }
  if (blockingImportItem(ctx.db) !== null) reason = "confirmation";
  ctx.db.append([
    {
      jobId: id,
      type: "job.created",
      payload: { title: req.title, recipe, ticket, ...(attachments.length ? { attachments } : {}), recipeConfirmationId: req.recipeConfirmationId, parentJobId: parent?.id ?? null, baseBranch, base, target, branch: jobBranch(id), orderId: req.orderId, orderKey: req.orderKey },
    },
    ...(reason ? [{ jobId: id, type: "job.state_changed" as const, payload: { state: "queued" as const, reason } }] : []),
  ]);
  ctx.changed(id);
  return id;
}
