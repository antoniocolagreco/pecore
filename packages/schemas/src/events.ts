import { z } from "zod";
import { Artifact } from "./artifacts";
import { AuthKind, FailureReason, JobState, JobWaitingReason, NodeRunState, PauseReason, WaitingReason } from "./errors";
import { JobDefinitions } from "./job-definitions";
import { AgentSession } from "./node";

const Tokens = z.object({
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  cacheRead: z.number().int().nonnegative(),
  cacheWrite: z.number().int().nonnegative(),
});

const QueueKind = z.enum([
  "human-node",
  "ci-head",
  "agent-question",
  "engine-node",
  "source-node",
  "recipe-change",
  "import",
  "ticket",
  "services",
  "round-limit",
  "budget",
  "outbound",
]);
export type QueueKind = z.infer<typeof QueueKind>;
export { QueueKind };

export const TicketSnapshot = z.object({
  title: z.string(),
  body: z.string(),
  author: z.string().nullish().transform((name) => name ?? null),
  labeledBy: z.string().nullish().transform((name) => name ?? null),
  attachments: z.array(z.string()).default([]),
});
export type TicketSnapshot = z.infer<typeof TicketSnapshot>;

export const TicketReply = z.object({ id: z.string().optional(), body: z.string(), author: z.string().nullable(), createdAt: z.string() });
export type TicketReply = z.infer<typeof TicketReply>;

export const OrderPlan = z.array(z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  recipe: z.string().min(1).optional(),
  ticketText: z.string(),
  dependsOn: z.array(z.string().min(1)).max(1),
  baseBranch: z.string().min(1).optional(),
  attachmentIds: z.array(z.ulid()).optional(),
}).strict());
export type OrderPlan = z.infer<typeof OrderPlan>;

const StoredOrderPlan = z.array(OrderPlan.element.extend({ recipeConfirmationId: z.ulid().optional() }));
const OrderId = z.string().min(1);
const ev = <T extends string, P extends z.ZodType>(type: T, payload: P) => z.object({ type: z.literal(type), payload });

export const EventBody = z.discriminatedUnion("type", [
  ev(
    "job.created",
    z.object({
      title: z.string(),
      recipe: z.unknown(),
      definitions: JobDefinitions.optional(),
      ticket: Artifact.nullable(),
      attachments: z.array(Artifact).optional(),
      recipeConfirmationId: z.ulid().optional(),
      parentJobId: z.string().nullable(),
      baseBranch: z.string(),
      base: z.string().nullable(),
      target: z.string(),
      branch: z.string(),
      orderId: OrderId.optional(),
      orderKey: z.string().min(1).optional(),
    }),
  ),
  ev("job.definitions_saved", JobDefinitions),
  ev("job.ci_check", z.object({
    runId: z.string(),
    commit: z.string().regex(/^[a-f0-9]{40}$/i),
    pullRequest: z.number().int().positive(),
    deadline: z.number().int(),
    nextCheck: z.number().int(),
    corrections: z.number().int().nonnegative(),
    result: z.enum(["pending", "ci_passed", "ci_failed", "ci_exhausted", "ci_timeout"]),
    log: Artifact.optional(),
  })),
  ev("job.state_changed", z.object({ state: JobState, reason: z.union([JobWaitingReason, PauseReason, z.string()]).nullable(), detail: z.string().optional() })),
  ev(
    "job.base_changed",
    z.object({ cause: z.enum(["parent_commit", "parent_merged", "realign", "fetched"]), base: z.string(), oldBase: z.string(), target: z.string() }),
  ),
  ev(
    "job.base_change_requested",
    z.object({ cause: z.enum(["parent_commit", "parent_merged", "realign"]), base: z.string().nullable(), target: z.string() }),
  ),
  ev("job.delivery_merged", z.object({ url: z.string() })),
  ev("job.archived", z.object({})),
  ev("job.unarchived", z.object({})),
  ev("node_run.created", z.object({ nodeRunId: z.string(), node: z.string(), round: z.number().int().nonnegative(), viaEdge: z.number().int().nonnegative().nullable().default(null) })),
  ev(
    "node_run.state_changed",
    z.object({
      nodeRunId: z.string(),
      state: NodeRunState,
      waitingReason: WaitingReason.nullable(),
      resetAt: z.number().nullable().optional(),
      queueItemId: z.string().nullable().optional(),
      auth: z.object({ account: z.string(), osUser: z.string(), kind: AuthKind }).nullable().optional(),
      pgid: z.number().int().nullable().optional(),
      osUser: z.string().nullable().optional(),
    }),
  ),
  ev(
    "node_run.git_recorded",
    z.object({ nodeRunId: z.string(), branch: z.string().nullable(), head: z.string().nullable() }),
  ),
  ev(
    "node_run.completed",
    z.object({ nodeRunId: z.string(), outcome: z.string(), contentBefore: z.string().nullable(), contentAfter: z.string().nullable(), artifacts: z.array(Artifact) }),
  ),
  ev("node_run.failed", z.object({ nodeRunId: z.string(), reason: FailureReason })),
  ev(
    "attempt.started",
    z.object({
      attemptId: z.string(),
      nodeRunId: z.string(),
      profile: z.string().nullable(),
      connector: z.string().nullable(),
      harnessVersion: z.string().nullable(),
      connectorVersion: z.string().nullable(),
      account: z.string().nullable(),
      osUser: z.string(),
      agentId: z.string().optional(),
      agentSession: AgentSession.optional(),
    }),
  ),
  ev("attempt.session_started", z.object({ attemptId: z.string(), sessionId: z.string(), resumed: z.boolean() })),
  ev(
    "attempt.ended",
    z.object({
      attemptId: z.string(),
      endReason: z.string(),
      model: z.string().nullable(),
      account: z.string().nullable(),
      tokens: Tokens,
      cost: z.number().nonnegative().nullable(),
    }),
  ),
  ev("effect.requested", z.object({ nodeRunId: z.string(), node: z.string(), commandHash: z.string() })),
  ev("effect.completed", z.object({ nodeRunId: z.string(), node: z.string(), commandHash: z.string(), result: z.unknown() })),
  ev("effect.failed", z.object({ nodeRunId: z.string(), node: z.string(), commandHash: z.string(), result: z.unknown() })),
  ev(
    "queue.added",
    z.object({ itemId: z.string(), kind: QueueKind, subject: z.unknown(), subjectHash: z.string(), choices: z.array(z.string()) }),
  ),
  ev(
    "queue.resolved",
    z.object({ itemId: z.string(), state: z.enum(["resolved", "cancelled"]), choice: z.string().nullable(), note: z.string().nullable() }),
  ),
  ev("confirmation.recorded", z.object({ path: z.string(), sha256: z.string() })),
  ev("ticket.seen", z.object({ source: z.string(), ticketId: z.string(), orderId: z.ulid() })),
  ev("order.read", z.object({ orderId: OrderId, ticket: TicketSnapshot, trusted: z.boolean() })),
  ev("order.handed", z.object({ orderId: OrderId, replies: z.array(TicketReply).optional(), askId: z.ulid().nullish() })),
  ev("order.asked", z.object({ orderId: OrderId, commentAt: z.number().int().nonnegative() })),
  ev("order.planned", z.object({ orderId: OrderId, plan: StoredOrderPlan })),
  ev("order.done", z.object({ orderId: OrderId })),
  ev("order.dropped", z.object({ orderId: OrderId, reason: z.string() })),
]);
export type EventBody = z.infer<typeof EventBody>;
export type EventType = EventBody["type"];

export type StoredEvent = EventBody & { id: string; jobId: string | null; at: number };
