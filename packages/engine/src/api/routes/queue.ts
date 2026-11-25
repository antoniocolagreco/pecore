import type { QueueItemView } from "@pecore/schemas";
import type { Engine } from "../../main";
import { HttpError } from "../server";
import type { Handlers } from "../server";

type QueueDbRow = {
  id: string;
  job_id: string | null;
  kind: QueueItemView["kind"];
  subject: string;
  subject_hash: string;
  state: QueueItemView["state"];
  choices: string;
  choice: string | null;
  note: string | null;
  created_at: number;
  resolved_at: number | null;
};

const itemView = (projectId: string, r: QueueDbRow): QueueItemView => ({
  id: r.id,
  projectId,
  jobId: r.job_id,
  kind: r.kind,
  subject: JSON.parse(r.subject),
  subjectHash: r.subject_hash,
  choices: JSON.parse(r.choices) as string[],
  state: r.state,
  choice: r.choice,
  note: r.note,
  createdAt: r.created_at,
  resolvedAt: r.resolved_at,
});

export function queueHandlers(engine: Engine) {
  return {
    listQueue: async ({ query }) => {
      const out: QueueItemView[] = [];
      for (const [projectId, { ctx }] of engine.projects) {
        if (query.project !== undefined && query.project !== projectId) continue;
        const rows = (query.state === undefined ? ctx.db.db.prepare("SELECT * FROM human_queue ORDER BY id").all() : ctx.db.db.prepare("SELECT * FROM human_queue WHERE state = ? ORDER BY id").all(query.state)) as QueueDbRow[];
        out.push(...rows.map((r) => itemView(projectId, r)));
      }
      return out.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    },
    answerQueue: async ({ params, body }) => {
      const { ctx, executor } = engine.findQueueItem(params.id);
      const item = ctx.db.db.prepare("SELECT state, subject_hash, choices, kind FROM human_queue WHERE id = ?").get(params.id) as Pick<QueueDbRow, "state" | "subject_hash" | "choices" | "kind">;
      if (item.state !== "open" || item.subject_hash !== body.hash) throw new HttpError("conflict", "the item changed, was resolved or was cancelled since it was shown");
      if (!(JSON.parse(item.choices) as string[]).includes(body.choice)) throw new HttpError("bad_request", `${body.choice} is not a choice of this item`);
      if (item.kind === "agent-question" && !body.note?.trim()) throw new HttpError("bad_request", "an answer is required");
      await executor.answer(params.id, body.choice, body.note, body.hash);
      return { ok: true };
    },
  } satisfies Partial<Handlers>;
}
