import { createHash } from "node:crypto";
import { monotonicFactory } from "ulid";
import type { ProjectContext } from "../graph/executor";
import { HttpError } from "../api/server";
import { runSource } from "../sources/run";

const ulid = monotonicFactory();

export type OutboundSubject = { project: string; ticketId: string; orderId: string; text: string };

export function stageOutbound(ctx: ProjectContext, subject: OutboundSubject): string {
  const hash: string = createHash("sha256").update(JSON.stringify(subject)).digest("hex");
  const open = ctx.db.db.prepare("SELECT id FROM human_queue WHERE state = 'open' AND kind = 'outbound' AND json_extract(subject, '$.orderId') = ?").all(subject.orderId) as { id: string }[];
  const itemId: string = ulid();
  ctx.db.append([
    ...open.map(({ id }) => ({ jobId: null, type: "queue.resolved" as const, payload: { itemId: id, state: "cancelled" as const, choice: null, note: "the Project Manager wrote a newer request" } })),
    { jobId: null, type: "queue.added", payload: { itemId, kind: "outbound", subject, subjectHash: hash, choices: ["post", "reject"] } },
  ]);
  return itemId;
}

export async function answerOutbound(ctx: ProjectContext, id: string, choice: string, note: string | null): Promise<void> {
  const item = ctx.db.db.prepare("SELECT subject FROM human_queue WHERE id = ? AND kind = 'outbound' AND state = 'open'").get(id) as { subject: string } | undefined;
  if (!item) throw new HttpError("conflict", "the item changed or was resolved");
  if (choice === "post") {
    const { ticketId, orderId, text } = JSON.parse(item.subject) as OutboundSubject;
    const commentAt: number = Date.now();
    await runSource(ctx, { command: "comment", ticketId, comment: text });
    ctx.db.append([
      { jobId: null, type: "order.asked", payload: { orderId, commentAt } },
      { jobId: null, type: "queue.resolved", payload: { itemId: id, state: "resolved", choice, note } },
    ]);
    return;
  }
  ctx.db.append([{ jobId: null, type: "queue.resolved", payload: { itemId: id, state: "resolved", choice, note } }]);
}
