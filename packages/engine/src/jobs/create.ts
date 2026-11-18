import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { monotonicFactory } from "ulid";
import type { Artifact } from "@pecore/schemas";
import { checkRecipe } from "../definitions/recipe-check";
import type { ProjectContext } from "../graph/executor";
import { branchHead, jobBranch } from "../workdir/repo";

const ulid = monotonicFactory();

export class JobCreateError extends Error {}

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
  if (req.parentJobId) throw new JobCreateError("stacked jobs are not available yet");
  const baseBranch = req.baseBranch ?? ctx.project.baseBranch;
  const base = await branchHead(join(ctx.dir, "repo.git"), baseBranch);
  if (!base) throw new JobCreateError(`branch ${baseBranch} not found`);
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
      payload: { title: req.title, recipe, ticket, parentJobId: null, baseBranch, base, target: baseBranch, branch: jobBranch(id) },
    },
  ]);
  ctx.changed(id);
  return id;
}
