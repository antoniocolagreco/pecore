import { monotonicFactory } from "ulid";
import { z } from "zod";
import { TicketReply, TicketSnapshot } from "@pecore/schemas";
import type { StoredEvent } from "@pecore/schemas";
import { blockingImportItem } from "../definitions/confirm";
import type { ProjectContext } from "../graph/executor";
import type { TicketOrder } from "../jobs/plan";
import { subjectHash } from "../runners/human";
import { paramsWithDefaults } from "../runners/placeholders";
import type { NewEvent } from "../store/project-db";
import { runSource } from "./run";

const ulid = monotonicFactory();
const TicketList = z.array(z.object({ id: z.string().min(1), title: z.string() }));

export interface OrderSink {
  hand(projectId: string, order: {
    id: string;
    ticket: TicketSnapshot & { id: string; source: string; replies?: TicketReply[] };
    alreadyDone: StoredEvent[];
  }): Promise<void>;
}

type TicketSubject = { orderId: string; source: string; ticketId: string; ticket: TicketSnapshot };

export function resolveTicketOrder(ctx: ProjectContext, itemId: string, orderId: string, choice: string, note: string | null): void {
  const events: NewEvent[] = [{ jobId: null, type: "queue.resolved", payload: { itemId, state: "resolved", choice, note } }];
  if (choice === "reject") events.push({ jobId: null, type: "order.dropped", payload: { orderId, reason: note?.trim() || "ticket rejected" } });
  ctx.db.append(events);
}

function interval(ctx: ProjectContext): number {
  const source = ctx.project.source;
  const node = source && ctx.defs.nodes.get(source.node);
  const seconds: unknown = node?.kind === "source" ? paramsWithDefaults(node.params, source?.params).pollSec : undefined;
  return typeof seconds === "number" && Number.isSafeInteger(seconds) && seconds > 0 ? Math.min(seconds * 1000, 2_147_483_647) : 300_000;
}

async function poll(ctx: ProjectContext, sink: OrderSink, rehand: Set<string>, active: () => boolean): Promise<void> {
  const source = ctx.project.source;
  if (!source || blockingImportItem(ctx.db) !== null) return;
  const current = (): boolean => active() && ctx.project.source === source;
  const db = ctx.db.db;
  const warn = (error: unknown): void => console.error(`source of project ${ctx.id}:`, error);
  try {
    const listed = await runSource(ctx, { command: "list" });
    if (listed.kind === "completed" && current()) {
      const seen: Set<string> = new Set((db.prepare("SELECT ticket_id FROM tickets_seen WHERE source = ?").all(source.node) as { ticket_id: string }[]).map((row) => row.ticket_id));
      const fresh: NewEvent[] = [];
      for (const { id } of TicketList.parse(listed.data)) {
        if (seen.has(id)) continue;
        fresh.push({ jobId: null, type: "ticket.seen", payload: { source: source.node, ticketId: id } });
        seen.add(id);
      }
      if (fresh.length > 0) ctx.db.append(fresh);
    }
  } catch (error) {
    warn(error);
  }

  if (!current()) return;
  const pending = db.prepare("SELECT order_id, source, ticket_id, state FROM tickets_seen WHERE source = ? AND order_id IS NOT NULL AND state IN ('received', 'confirming', 'asking', 'handed') ORDER BY order_id").all(source.node) as TicketOrder[];
  for (const order of pending) {
    if (!current()) return;
    try {
      await pollOrder(ctx, sink, order, rehand, current);
    } catch (error) {
      warn(error);
    }
  }
}

async function pollOrder(ctx: ProjectContext, sink: OrderSink, order: TicketOrder, rehand: Set<string>, current: () => boolean): Promise<void> {
  const { order_id: orderId, source, ticket_id: ticketId, state } = order;
  if (state === "handed" && !rehand.has(orderId)) return;
  const history: StoredEvent[] = ctx.db.orderEvents(orderId);
  let ticket: TicketSnapshot | undefined = history.findLast((event) => event.type === "order.read")?.payload.ticket;

  if (state === "received") {
    const read = await runSource(ctx, { command: "read", ticketId });
    if (read.kind !== "completed" || !current()) return;
    ticket = TicketSnapshot.parse(read.data);
    const trusted: boolean = [ticket.author, ticket.labeledBy].some((name) => name !== null && read.trusted.includes(name));
    const events: NewEvent[] = [{ jobId: null, type: "order.read", payload: { orderId, ticket, trusted } }];
    if (!trusted) {
      const subject: TicketSubject = { orderId, source, ticketId, ticket };
      events.push({ jobId: null, type: "queue.added", payload: { itemId: ulid(), kind: "ticket", subject, subjectHash: subjectHash(subject), choices: ["confirm", "reject"] } });
    }
    ctx.db.append(events);
    if (!trusted) return;
  } else if (state === "confirming") {
    const item = ctx.db.db.prepare(
      "SELECT subject FROM human_queue WHERE kind = 'ticket' AND state = 'resolved' AND choice = 'confirm' AND json_extract(subject, '$.orderId') = ? ORDER BY id DESC LIMIT 1",
    ).get(orderId) as { subject: string } | undefined;
    if (!item) return;
    ticket = (JSON.parse(item.subject) as TicketSubject).ticket;
  }

  if (!ticket) throw new Error(`order ${orderId} has no ticket snapshot`);
  let replies: TicketReply[] | undefined;
  let askId: string | null = null;
  if (state === "asking") {
    const asked = history.findLast((event) => event.type === "order.asked");
    if (!asked) return;
    const since: number = asked.payload.commentAt;
    const result = await runSource(ctx, { command: "replies", ticketId, since });
    if (result.kind !== "completed" || !current()) return;
    replies = TicketReply.array().parse(result.data).filter((reply) => Date.parse(reply.createdAt) > since);
    if (replies.length === 0) return;
    askId = asked.id;
  } else if (state === "handed") {
    replies = history.findLast((event) => event.type === "order.handed")?.payload.replies;
  }

  const currentState = ctx.db.db.prepare("SELECT state FROM tickets_seen WHERE order_id = ?").get(orderId) as { state: TicketOrder["state"] } | undefined;
  if (!current() || currentState?.state !== state) return;
  await sink.hand(ctx.id, {
    id: orderId,
    ticket: { ...ticket, id: ticketId, source, ...(replies ? { replies } : {}) },
    alreadyDone: history.filter((event) => event.type !== "order.read"),
  });
  ctx.db.append([{ jobId: null, type: "order.handed", payload: { orderId, replies, askId } }]);
  rehand.delete(orderId);
}

export function startSourcePolling(ctx: ProjectContext, sink: OrderSink, resumed: TicketOrder[]): { wake(): void; close(): Promise<void> } {
  const rehand: Set<string> = new Set(resumed.filter((order) => order.state === "handed").map((order) => order.order_id));
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<void> | undefined;
  let stopped = false;
  let woken = false;

  const schedule = (delay: number): void => {
    clearTimeout(timer);
    if (stopped || !ctx.project.source) return;
    timer = setTimeout(() => {
      inFlight = poll(ctx, sink, rehand, () => !stopped).catch((error: unknown) => console.error(`source of project ${ctx.id}:`, error)).finally(() => {
        inFlight = undefined;
        const delay: number = woken ? 0 : interval(ctx);
        woken = false;
        schedule(delay);
      });
    }, delay);
  };
  schedule(0);
  return {
    wake() {
      if (inFlight) woken = true;
      else schedule(0);
    },
    async close() {
      stopped = true;
      clearTimeout(timer);
      await inFlight;
    },
  };
}
