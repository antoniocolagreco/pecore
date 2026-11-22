import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { Project, ProjectId } from "@pecore/schemas";
import type { ChatConfirmationRow } from "@pecore/schemas";
import { definitionOperations } from "../api/routes/definitions";
import type { Engine } from "../main";
import { validateBaseBranch } from "./project-creation";

const text = z.string().trim().min(1);
export const ProjectSelection = z.strictObject({ project: ProjectId });
export const ProjectUpdate = ProjectSelection.extend({
  changes: z.strictObject({
    name: text.optional(),
    baseBranch: text.optional(),
    services: text.refine((path) => !isAbsolute(path) && !path.split("/").some((part) => part === "." || part === "..") && !path.includes("\0"),
      "Enter a Compose path relative to the repository root.").nullable().optional(),
  }).refine((changes) => Object.keys(changes).length > 0, "Provide at least one setting to change."),
});

export async function projectUpdateRows(engine: Engine, { project, changes }: z.infer<typeof ProjectUpdate>): Promise<ChatConfirmationRow[]> {
  const loaded = engine.project(project);
  if (engine.creating.has(project) || loaded.deleting) throw new Error("Wait for project setup or deletion to finish.");
  if (changes.baseBranch !== undefined) await validateBaseBranch(engine.opts.home, changes.baseBranch);
  const current: Project = loaded.ctx.project;
  Project.parse({ ...current, ...changes });
  const compose = (path: string | null): string => path ?? "Detected automatically";
  return [
    { label: "Project", value: current.name },
    { label: "Project ID", value: project },
    ...(changes.name !== undefined ? [{ label: "Name", value: `${current.name} → ${changes.name}` }] : []),
    ...(changes.baseBranch !== undefined ? [{ label: "Base branch", value: `${current.baseBranch} → ${changes.baseBranch}` }] : []),
    ...(changes.services !== undefined ? [{ label: "Compose file", value: `${compose(current.services)} → ${compose(changes.services)}` }] : []),
  ];
}

export async function updateProject(engine: Engine, { project, changes }: z.infer<typeof ProjectUpdate>): Promise<void> {
  const loaded = engine.project(project);
  if (engine.creating.has(project) || loaded.deleting) throw new Error("Wait for project setup or deletion to finish.");
  const definitions = definitionOperations(engine).handlers;
  const path: string = `projects/${project}/project.json`;
  const file = await definitions.getDefinition({ params: { path }, body: undefined, query: undefined });
  if (changes.baseBranch !== undefined) await validateBaseBranch(engine.opts.home, changes.baseBranch);
  const current: Project = Project.parse(JSON.parse(file.content));
  const next: Project = Project.parse({ ...current, ...changes });
  if (engine.project(project) !== loaded || loaded.deleting) throw new Error("The project changed. Try again with its current settings.");
  if (JSON.stringify(current) === JSON.stringify(next)) return;
  await definitions.saveDefinition({ params: { path }, query: undefined, body: { content: JSON.stringify(next, null, 2) + "\n", baseSha256: file.sha256 } });
}

export const ProjectDeletion = ProjectSelection.extend({ identity: z.string().min(1) });

export function projectDeletion(engine: Engine, project: string): { identity: string; rows: ChatConfirmationRow[] } {
  const loaded = engine.project(project);
  if (engine.creating.has(project) || loaded.deleting) throw new Error("Wait for project setup or deletion to finish.");
  if (loaded.executor.jobs().some(({ state }) => state === "running")) throw new Error("Stop the running jobs first.");
  const { dev, ino, birthtimeNs } = statSync(loaded.ctx.dir, { bigint: true });
  const { name, repo, folder } = loaded.ctx.project;
  const rows: ChatConfirmationRow[] = [
    { label: "Project", value: name },
    { label: "Project ID", value: project },
    { label: "Data to delete", value: "<PE/CORE>’s repository copy, work folders, artifacts, logs, database, definitions and service containers." },
    ...(folder ? [{ label: "Project folder kept", value: folder }] : []),
    ...(repo ? [{ label: "Remote repository and pull requests kept", value: repo.url }] : []),
  ];
  const identity: string = createHash("sha256").update(JSON.stringify([String(dev), String(ino), String(birthtimeNs), rows])).digest("hex");
  return { identity, rows };
}
