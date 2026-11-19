import { z } from "zod";
import { Artifact } from "./artifacts";
import { Name } from "./common";
import { AuthKind, JobState, NodeRunState } from "./errors";
import { QueueKind } from "./events";
import { Project, ProjectId } from "./project";

export const CreateProjectBody = z
  .object({
    project: Project,
    recipes: z.array(Name).default(["feature", "bugfix", "local-only"]),
  })
  .strict();
export type CreateProjectBody = z.infer<typeof CreateProjectBody>;

export const CreateJobBody = z
  .object({
    project: ProjectId,
    recipe: Name.optional(),
    title: z.string().min(1),
    ticket: z.object({ text: z.string(), source: z.string().optional(), id: z.string().optional() }).strict(),
    parentJobId: z.string().nullable().default(null),
    baseBranch: z.string().min(1).optional(),
  })
  .strict();
export type CreateJobBody = z.infer<typeof CreateJobBody>;

export const QueueChoiceBody = z
  .object({
    choice: z.string().min(1),
    note: z.string().nullable().default(null),
    input: z.unknown().optional(),
    hash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export type QueueChoiceBody = z.infer<typeof QueueChoiceBody>;

export const ProtectedModeBody = z
  .object({ on: z.boolean(), removeUser: z.boolean().default(false) })
  .strict()
  .refine((b) => !(b.on && b.removeUser), { message: "removeUser only with on: false", path: ["removeUser"] });
export type ProtectedModeBody = z.infer<typeof ProtectedModeBody>;

export const StartLoginBody = z.object({ account: z.string().min(1), osUser: z.string().min(1) }).strict();
export type StartLoginBody = z.infer<typeof StartLoginBody>;

export const LoginCodeBody = z.object({ code: z.string().min(1) }).strict();
export type LoginCodeBody = z.infer<typeof LoginCodeBody>;

export const RealignBody = z.object({ target: z.string().min(1).optional() }).strict();
export type RealignBody = z.infer<typeof RealignBody>;

export const LiveClientMessage = z.union([
  z.object({ auth: z.string().min(1) }).strict(),
  z.object({ subscribe: z.string().min(1) }).strict(),
  z.object({ unsubscribe: z.string().min(1) }).strict(),
]);
export type LiveClientMessage = z.infer<typeof LiveClientMessage>;

export const liveAuthFailed = 4401;

export const LogEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string(), at: z.number() }),
  z.object({ type: z.literal("tool_call"), toolCallId: z.string(), title: z.string(), kind: z.string(), status: z.string(), at: z.number() }),
  z.object({ type: z.literal("permission"), toolCallId: z.string(), optionId: z.string().nullable(), at: z.number() }),
  z.object({ type: z.literal("stderr"), text: z.string(), at: z.number() }),
  z.object({ type: z.literal("output"), text: z.string(), at: z.number() }),
]);
export type LogEvent = z.infer<typeof LogEvent>;

export const LiveMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("job.updated"), jobId: z.string(), projectId: ProjectId }),
  z.object({ type: z.literal("node_run.updated"), jobId: z.string(), nodeRunId: z.string(), projectId: ProjectId }),
  z.object({ type: z.literal("queue.updated"), itemId: z.string(), projectId: ProjectId }),
  z.object({ type: z.literal("project.updated"), projectId: ProjectId }),
  z.object({ type: z.literal("definition.changed"), path: z.string(), sha256: z.string().nullable() }),
  z.object({ type: z.literal("log.line"), attemptId: z.string(), event: LogEvent }),
  z.object({ type: z.literal("login.progress"), loginId: z.string(), text: z.string(), url: z.string().nullable(), done: z.boolean() }),
  z.object({ type: z.literal("chat.message"), chatId: z.string(), messageId: z.string() }),
  z.object({ type: z.literal("chat.action"), chatId: z.string(), actionId: z.string() }),
  z.object({ type: z.literal("notify"), kind: z.string(), title: z.string(), body: z.string() }),
]);
export type LiveMessage = z.infer<typeof LiveMessage>;

export const ApiErrorCode = z.enum(["bad_request", "unauthorized", "forbidden", "not_found", "conflict", "gone", "engine_error"]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

export const apiErrorStatus: Record<ApiErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  gone: 410,
  engine_error: 500,
};

export const ApiErrorBody = z.object({ error: ApiErrorCode, message: z.string() });
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

const Ok = z.object({ ok: z.literal(true) });
const IdParams = z.object({ id: z.string().min(1) });

export const DefinitionErrorView = z.object({ file: z.string(), path: z.string(), message: z.string() });

export const CreationView = z.object({
  step: z.number().int().min(0).max(6),
  error: z.string().nullable(),
  setupJob: z.object({ state: JobState, waitingReason: z.string().nullable() }).nullable(),
  setupItemId: z.string().nullable(),
});
export type CreationView = z.infer<typeof CreationView>;

export const ProjectView = z.object({
  id: z.string(),
  project: Project.nullable(),
  creating: CreationView.nullable(),
  errors: z.array(DefinitionErrorView),
});
export type ProjectView = z.infer<typeof ProjectView>;

export const JobView = z.object({
  id: z.string(),
  projectId: ProjectId,
  title: z.string(),
  recipe: z.string(),
  state: JobState,
  waitingReason: z.string().nullable(),
  failureReason: z.string().nullable(),
  parentJobId: z.string().nullable(),
  baseBranch: z.string(),
  base: z.string().nullable(),
  target: z.string(),
  branch: z.string(),
  archived: z.boolean(),
  mergedAt: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type JobView = z.infer<typeof JobView>;

export const NodeRunView = z.object({
  id: z.string(),
  node: z.string(),
  round: z.number().int(),
  state: NodeRunState,
  outcome: z.string().nullable(),
  waitingReason: z.string().nullable(),
  resetAt: z.number().nullable(),
  queueItemId: z.string().nullable(),
  auth: z.object({ account: z.string(), osUser: z.string(), kind: AuthKind }).nullable(),
  failureReason: z.string().nullable(),
  startedAt: z.number().nullable(),
  endedAt: z.number().nullable(),
});
export type NodeRunView = z.infer<typeof NodeRunView>;

export const AttemptView = z.object({
  id: z.string(),
  nodeRunId: z.string(),
  profile: z.string().nullable(),
  model: z.string().nullable(),
  account: z.string().nullable(),
  tokens: z.object({ input: z.number(), output: z.number(), cacheRead: z.number(), cacheWrite: z.number() }),
  cost: z.number().nullable(),
  endReason: z.string().nullable(),
  startedAt: z.number(),
  endedAt: z.number().nullable(),
});
export type AttemptView = z.infer<typeof AttemptView>;

export const JobDetail = z.object({
  job: JobView,
  nodeRuns: z.array(NodeRunView),
  attempts: z.array(AttemptView),
  artifacts: z.array(Artifact),
});
export type JobDetail = z.infer<typeof JobDetail>;

export const WhyReason = z.object({
  reason: z.string(),
  text: z.string(),
  nodeRunId: z.string().nullable(),
  until: z.number().nullable(),
  queueItemId: z.string().nullable(),
  account: z.string().nullable(),
  jobId: z.string().nullable(),
});
export type WhyReason = z.infer<typeof WhyReason>;

export const WhyView = z.object({ jobId: z.string(), state: JobState, reasons: z.array(WhyReason) });
export type WhyView = z.infer<typeof WhyView>;

export const QueueItemView = z.object({
  id: z.string(),
  projectId: ProjectId,
  jobId: z.string().nullable(),
  kind: QueueKind,
  subject: z.unknown(),
  subjectHash: z.string(),
  choices: z.array(z.string()),
  state: z.enum(["open", "resolved", "cancelled"]),
  choice: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.number(),
  resolvedAt: z.number().nullable(),
});
export type QueueItemView = z.infer<typeof QueueItemView>;

export const StatusView = z.object({
  version: z.string(),
  globalPause: z.boolean(),
  interrupted: z.number().int(),
  inbox: z.number().int(),
  homeFindings: z.array(z.object({ path: z.string(), fix: z.array(z.string()) })),
});
export type StatusView = z.infer<typeof StatusView>;

export const NotificationView = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  target: z.object({ project: z.string().nullable(), job: z.string().nullable() }).nullable(),
  createdAt: z.number(),
});
export type NotificationView = z.infer<typeof NotificationView>;

const ListJobsQuery = z.object({ project: ProjectId.optional(), archived: z.enum(["true", "false"]).optional() });
const ListQueueQuery = z.object({ project: ProjectId.optional(), state: z.enum(["open", "resolved", "cancelled"]).optional() });
const LogQuery = z.object({ view: z.enum(["events", "raw"]).default("raw") });

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type RouteDef = {
  method: Method;
  path: string;
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
  response: z.ZodType;
};

const control = (name: string) => ({ method: "POST", path: `/jobs/:id/${name}`, params: IdParams, response: Ok }) as const;

export const routes = {
  listProjects: { method: "GET", path: "/projects", response: z.array(ProjectView) },
  createProject: { method: "POST", path: "/projects", body: CreateProjectBody, response: z.object({ id: ProjectId }) },
  getProject: { method: "GET", path: "/projects/:id", params: IdParams, response: ProjectView },
  getCreation: { method: "GET", path: "/projects/:id/creation", params: IdParams, response: CreationView },
  retryCreation: { method: "POST", path: "/projects/:id/creation/retry", params: IdParams, response: Ok },
  cancelCreation: { method: "POST", path: "/projects/:id/creation/cancel", params: IdParams, response: Ok },
  listJobs: { method: "GET", path: "/jobs", query: ListJobsQuery, response: z.array(JobView) },
  getJob: { method: "GET", path: "/jobs/:id", params: IdParams, response: JobDetail },
  whyJob: { method: "GET", path: "/jobs/:id/why", params: IdParams, response: WhyView },
  createJob: { method: "POST", path: "/jobs", body: CreateJobBody, response: z.object({ id: z.string() }) },
  stopJob: control("stop"),
  pauseJob: control("pause"),
  playJob: control("play"),
  resumeJob: control("resume"),
  archiveJob: control("archive"),
  deleteJob: control("delete"),
  realignJob: { method: "POST", path: "/jobs/:id/realign", params: IdParams, body: RealignBody, response: Ok },
  checkMerge: { method: "POST", path: "/jobs/:id/check-merge", params: IdParams, response: z.object({ merged: z.boolean() }) },
  pauseAll: { method: "POST", path: "/pause", response: Ok },
  playAll: { method: "POST", path: "/play", response: Ok },
  playInterrupted: { method: "POST", path: "/play-interrupted", response: Ok },
  listQueue: { method: "GET", path: "/queue", query: ListQueueQuery, response: z.array(QueueItemView) },
  answerQueue: { method: "POST", path: "/queue/:id", params: IdParams, body: QueueChoiceBody, response: Ok },
  getStatus: { method: "GET", path: "/status", response: StatusView },
  listNotifications: { method: "GET", path: "/notifications", response: z.array(NotificationView) },
  getLog: { method: "GET", path: "/logs/:id", params: IdParams, query: LogQuery, response: z.union([z.object({ view: z.literal("raw"), lines: z.array(z.unknown()) }), z.object({ view: z.literal("events"), events: z.array(LogEvent) })]) },
} as const satisfies Record<string, RouteDef>;

export type Routes = typeof routes;
export type RouteName = keyof Routes;

type Part<R, K extends "params" | "query" | "body"> = R extends Record<K, infer S extends z.ZodType> ? { [P in K]: z.input<S> } : { [P in K]?: never };
export type RouteInput<N extends RouteName> = Part<Routes[N], "params"> & Part<Routes[N], "query"> & Part<Routes[N], "body">;
export type RouteParsed<N extends RouteName> = {
  params: Routes[N] extends { params: infer S extends z.ZodType } ? z.output<S> : undefined;
  query: Routes[N] extends { query: infer S extends z.ZodType } ? z.output<S> : undefined;
  body: Routes[N] extends { body: infer S extends z.ZodType } ? z.output<S> : undefined;
};
export type RouteOutput<N extends RouteName> = z.input<Routes[N]["response"]>;
