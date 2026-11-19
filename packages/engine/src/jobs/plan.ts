import { OrderPlan } from "@pecore/schemas";
import type { Recipe, StoredEvent } from "@pecore/schemas";
import { hasCommitNode } from "../definitions/recipe-check";
import type { ProjectContext } from "../graph/executor";
import { createJob, JobCreateError, recipeForJob } from "./create";

export type TicketOrder = {
  order_id: string;
  source: string;
  ticket_id: string;
  state: "received" | "confirming" | "handed" | "asking" | "planned" | "done" | "dropped";
};

export type OrderPlanResult = { accepted: boolean; plan: OrderPlan; jobIds: Record<string, string> };

type PlannedOrder = Extract<StoredEvent, { type: "order.planned" }>["payload"];
const creating: WeakMap<ProjectContext, Map<string, Promise<void>>> = new WeakMap();

function orderJobs(ctx: ProjectContext, orderId: string): Map<string, string> {
  const rows = ctx.db.db.prepare("SELECT id, order_key FROM jobs WHERE order_id = ?").all(orderId) as { id: string; order_key: string }[];
  return new Map(rows.map(({ id, order_key }) => [order_key, id]));
}

function ticketOrder(ctx: ProjectContext, orderId: string): TicketOrder | undefined {
  return ctx.db.db.prepare("SELECT order_id, source, ticket_id, state FROM tickets_seen WHERE order_id = ?").get(orderId) as TicketOrder | undefined;
}

function validatePlan(ctx: ProjectContext, plan: OrderPlan): OrderPlan {
  const recipes: Map<string, Recipe> = new Map();
  return OrderPlan.parse(plan).map((entry) => {
    if (recipes.has(entry.key)) throw new JobCreateError(`duplicate order key ${entry.key}`);
    const parentKey: string | undefined = entry.dependsOn[0];
    if (parentKey !== undefined) {
      const parent: Recipe | undefined = recipes.get(parentKey);
      if (!parent) throw new JobCreateError(`${entry.key} must depend on an earlier key`);
      if (!hasCommitNode(parent, ctx.defs.nodes)) throw new JobCreateError(`the recipe for parent key ${parentKey} has no commit node`);
    }
    const recipe: string = entry.recipe ?? ctx.project.defaultRecipe;
    recipes.set(entry.key, recipeForJob(ctx, recipe));
    return { ...entry, recipe };
  });
}

async function createMissing(ctx: ProjectContext, { orderId, plan }: PlannedOrder): Promise<void> {
  const ids: Map<string, string> = orderJobs(ctx, orderId);
  const ticket: TicketOrder | undefined = ticketOrder(ctx, orderId);
  try {
    for (const entry of plan) {
      if (ids.has(entry.key)) continue;
      const parentKey: string | undefined = entry.dependsOn[0];
      const parentJobId: string | null | undefined = parentKey === undefined ? null : ids.get(parentKey);
      if (parentJobId === undefined) throw new JobCreateError(`no job exists for parent key ${parentKey}`);
      const id: string = await createJob(ctx, {
        title: entry.title,
        ticket: { text: entry.ticketText, source: ticket?.source, id: ticket?.ticket_id },
        recipe: entry.recipe,
        baseBranch: entry.baseBranch,
        parentJobId,
        orderId,
        orderKey: entry.key,
      });
      ids.set(entry.key, id);
    }
    const existing: Map<string, string> = orderJobs(ctx, orderId);
    if (!plan.every((entry) => existing.has(entry.key))) throw new JobCreateError(`order ${orderId} is missing jobs`);
    ctx.db.append([{ jobId: null, type: "order.done", payload: { orderId } }]);
  } finally {
    ctx.released();
  }
}

function finishPlan(ctx: ProjectContext, planned: PlannedOrder): Promise<void> {
  const active: Map<string, Promise<void>> = creating.get(ctx) ?? new Map();
  creating.set(ctx, active);
  const pending: Promise<void> | undefined = active.get(planned.orderId);
  if (pending) return pending;
  const completion: Promise<void> = Promise.resolve().then(() => createMissing(ctx, planned)).finally(() => active.delete(planned.orderId));
  active.set(planned.orderId, completion);
  return completion;
}

export async function planOrder(ctx: ProjectContext, orderId: string, plan: OrderPlan): Promise<OrderPlanResult> {
  const events: StoredEvent[] = ctx.db.orderEvents(orderId);
  const stored = events.find((event) => event.type === "order.planned");
  if (stored) {
    await creating.get(ctx)?.get(orderId)?.catch(() => undefined);
    return { accepted: false, plan: stored.payload.plan, jobIds: Object.fromEntries(orderJobs(ctx, orderId)) };
  }
  if (events.some((event) => event.type === "order.dropped")) throw new JobCreateError(`order ${orderId} was dropped`);
  const validated: OrderPlan = validatePlan(ctx, plan);
  const payload: PlannedOrder = { orderId, plan: validated };
  ctx.db.append([{ jobId: null, type: "order.planned", payload }]);
  await finishPlan(ctx, payload);
  return { accepted: true, plan: validated, jobIds: Object.fromEntries(orderJobs(ctx, orderId)) };
}

export async function resumeOrders(ctx: ProjectContext): Promise<TicketOrder[]> {
  const orders = ctx.db.db.prepare("SELECT order_id, source, ticket_id, state FROM tickets_seen WHERE state IN ('received', 'handed', 'planned') AND order_id IS NOT NULL ORDER BY order_id").all() as TicketOrder[];
  for (const order of orders) {
    if (order.state !== "planned") continue;
    const planned = ctx.db.orderEvents(order.order_id).find((event) => event.type === "order.planned");
    if (planned) await finishPlan(ctx, planned.payload).catch((error: unknown) => console.error(`order ${order.order_id}:`, error));
  }
  return orders.filter((order) => order.state !== "planned");
}
