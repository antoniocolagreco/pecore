import { monotonicFactory } from "ulid";
import type { Artifact, JobDefinitions, Recipe } from "@pecore/schemas";
import { checkRecipe, hasCommitNode, recipeParameterIssues } from "../definitions/recipe-check";
import { definitionHash, jobDefinitions, jobNodes, snapshotDefinitions } from "../definitions/snapshot";
import type { JobRow, ProjectContext } from "../graph/executor";
import { ProjectLocationConflict, withProjectLocation } from "../projects/location";
import { jobBranch } from "../workdir/repo";
import { fetchBase, jobCommit } from "./stacked";

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
};

export function jobRecipeName(ctx: ProjectContext, requested: string | undefined): string {
  if (requested !== undefined) return requested;
  const names: string[] = [...ctx.defs.recipes.keys()];
  if (names.length === 1) return names[0]!;
  throw new JobCreateError(names.length === 0 ? `project ${ctx.id} has no recipes; add one` : `project ${ctx.id} has ${names.length} recipes; choose one`);
}

export function recipeForJob(ctx: ProjectContext, recipeName: string): Recipe {
  const template: Recipe | undefined = ctx.defs.recipes.get(recipeName);
  if (!template) throw new JobCreateError(`recipe ${recipeName} not found in project ${ctx.id}`);
  const vars: Record<string, unknown> = ctx.project.variables ?? {};
  const recipe: Recipe = {
    ...template,
    nodes: Object.fromEntries(Object.entries(template.nodes).map(([id, step]) => {
      if (!step.params) return [id, step];
      const params: Record<string, unknown> = Object.fromEntries(Object.entries(step.params).map(([name, value]) => {
        const variable: string | undefined = typeof value === "string" ? /^\{project\.vars\.([a-zA-Z][\w-]*)\}$/.exec(value)?.[1] : undefined;
        if (!variable) return [name, value];
        if (!Object.hasOwn(vars, variable)) throw new JobCreateError(`recipe ${recipeName}, step ${id}: project variable ${variable} is missing`);
        return [name, vars[variable]];
      }));
      return [id, { ...step, params }];
    })),
  };
  const issues = [...checkRecipe(recipe, ctx.defs.nodes, ctx.project.repo !== null), ...recipeParameterIssues(recipe, ctx.defs.nodes)];
  if (issues.length) throw new JobCreateError(`recipe ${recipeName} is not valid: ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`);
  return recipe;
}

export async function createJob(ctx: ProjectContext, req: CreateJob): Promise<string> {
  return withProjectLocation(ctx, () => createJobInProject(ctx, req)).catch((error: unknown) => {
    if (error instanceof ProjectLocationConflict) fail(error);
    throw error;
  });
}

async function createJobInProject(ctx: ProjectContext, req: CreateJob): Promise<string> {
  if ((req.orderId === undefined) !== (req.orderKey === undefined)) throw new JobCreateError("orderId and orderKey must be set together");
  const recipe: Recipe = recipeForJob(ctx, jobRecipeName(ctx, req.recipe));
  const recipeHash: string = definitionHash(ctx.defs.recipes.get(recipe.name));
  const definitions: JobDefinitions = await snapshotDefinitions(recipe, ctx.defs.nodes, ctx.defs.nodeDir, ctx.defs.sidecars).catch(fail);
  definitions.recipeHash = recipeHash;
  const knowledgeByRecipe = ctx.project.recipeKnowledge;
  if (knowledgeByRecipe && Object.hasOwn(knowledgeByRecipe, recipe.name)) definitions.knowledgeByStep = knowledgeByRecipe[recipe.name];
  const parent = req.parentJobId ? (ctx.db.db.prepare("SELECT * FROM jobs WHERE id = ?").get(req.parentJobId) as JobRow | undefined) : null;
  if (parent === undefined) throw new JobCreateError(`parent job ${req.parentJobId} not found`);
  let baseBranch = req.baseBranch ?? ctx.project.baseBranch;
  let target = baseBranch;
  let base: string;
  let reason: "parent_job" | "parent_failed" | null = null;
  if (parent) {
    if (!hasCommitNode(JSON.parse(parent.recipe) as Recipe, jobNodes(jobDefinitions(ctx.db, parent.id), ctx.defs.nodes))) throw new JobCreateError(`the recipe of parent job ${parent.id} has no commit node`);
    baseBranch = parent.base_branch;
    target = parent.merged_at === null ? parent.branch : parent.target;
    const sha: string | null = jobCommit(ctx.db, ctx.db.events(parent.id));
    if (parent.merged_at !== null) base = await fetchBase(ctx, target).catch((e: unknown) => fail(e));
    else if (parent.state === "succeeded" && sha) base = sha;
    else {
      base = parent.base;
      reason = parent.state === "not_delivered" || parent.state === "failed" || parent.state === "stopped" ? "parent_failed" : "parent_job";
    }
  } else base = await fetchBase(ctx, baseBranch).catch((e: unknown) => fail(e));
  const id = ulid();
  const content = JSON.stringify({ title: req.title, body: req.ticket.text, source: req.ticket.source ?? null, id: req.ticket.id ?? null }, null, 2);
  ctx.db.db.transaction(() => {
    const ticket: Artifact = ctx.db.saveArtifact(id, "ticket", "ticket.json", "document", content, null);
    const attachments: Artifact[] = (req.attachments ?? []).map(({ name, data }) => ctx.db.saveArtifact(id, "attachments", name, "attachment", data, null));
    ctx.db.append([
      {
        jobId: id,
        type: "job.created",
        payload: { title: req.title, recipe, definitions, ticket, ...(attachments.length ? { attachments } : {}), parentJobId: parent?.id ?? null, baseBranch, base, target, branch: jobBranch(id), orderId: req.orderId, orderKey: req.orderKey },
      },
      ...(reason ? [{ jobId: id, type: "job.state_changed" as const, payload: { state: "queued" as const, reason } }] : []),
    ]);
  })();
  ctx.changed(id);
  return id;
}
