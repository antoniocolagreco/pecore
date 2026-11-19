import type { CreationView, JobState, ProjectView } from "@pecore/schemas";
import type { Engine } from "../../main";
import { NotFoundError } from "../../main";
import { ProjectCreateError, setupJobId } from "../../projects/create";
import { InvalidArchive, ShareConflict } from "../../share/archive";
import { HttpError } from "../server";
import type { Handlers } from "../server";

function creationView(engine: Engine, id: string): CreationView | null {
  const c = engine.creating.get(id);
  if (!c) return null;
  const p = engine.projects.get(id);
  const job = p?.ctx.db.db.prepare("SELECT state, waiting_reason FROM jobs WHERE id = ?").get(setupJobId) as { state: JobState; waiting_reason: string | null } | undefined;
  const item = p?.ctx.db.db.prepare("SELECT id FROM human_queue WHERE job_id = ? AND state = 'open' ORDER BY id DESC LIMIT 1").get(setupJobId) as { id: string } | undefined;
  return { step: c.step, error: c.error, setupJob: job ? { state: job.state, waitingReason: job.waiting_reason } : null, setupItemId: item?.id ?? null };
}

function projectView(engine: Engine, id: string): ProjectView {
  const p = engine.projects.get(id);
  return { id, project: p?.ctx.project ?? null, creating: creationView(engine, id), errors: engine.projectErrors.get(id) ?? [] };
}

function known(engine: Engine, id: string): void {
  if (!engine.projects.has(id) && !engine.projectErrors.has(id) && !engine.creating.has(id)) throw new NotFoundError(`project ${id} not found`);
}

export function projectHandlers(engine: Engine) {
  return {
    listProjects: async () => [...new Set([...engine.projects.keys(), ...engine.projectErrors.keys(), ...engine.creating.keys()])].sort().map((id) => projectView(engine, id)),
    getProject: async ({ params }) => {
      known(engine, params.id);
      return projectView(engine, params.id);
    },
    createProject: async ({ body }) => {
      try {
        await engine.createProject(body.project, body.recipes);
      } catch (e) {
        if (e instanceof ProjectCreateError) throw new HttpError("bad_request", e.message);
        throw e;
      }
      return { id: body.project.id };
    },
    exportProject: async ({ params, body }) => {
      try {
        return await engine.exportProject(params.id, body);
      } catch (error) {
        if (error instanceof ShareConflict) throw new HttpError("conflict", error.message);
        throw error;
      }
    },
    importProject: async ({ body }) => {
      try {
        return await engine.importProject(body);
      } catch (error) {
        if (error instanceof ShareConflict) throw new HttpError("conflict", error.message);
        if (error instanceof InvalidArchive || error instanceof ProjectCreateError) throw new HttpError("bad_request", error.message);
        throw error;
      }
    },
    deleteProject: async ({ params }) => {
      if (!engine.projects.has(params.id)) throw new NotFoundError(`project ${params.id} not found`);
      try {
        await engine.deleteProject(params.id);
      } catch (e) {
        throw new HttpError("conflict", (e as Error).message);
      }
      return { ok: true };
    },
    getCreation: async ({ params }) => {
      known(engine, params.id);
      return creationView(engine, params.id) ?? { step: 6, error: null, setupJob: null, setupItemId: null };
    },
    retryCreation: async ({ params }) => {
      if (!engine.creating.has(params.id)) throw new HttpError("conflict", `project ${params.id} is not being created`);
      await engine.continueCreation(params.id);
      return { ok: true };
    },
    cancelCreation: async ({ params }) => {
      if (!engine.creating.has(params.id)) throw new HttpError("conflict", `project ${params.id} is not being created`);
      await engine.cancelCreation(params.id);
      return { ok: true };
    },
  } satisfies Partial<Handlers>;
}
