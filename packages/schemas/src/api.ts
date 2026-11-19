import { z } from "zod";
import { Accounts } from "./accounts";
import { Artifact } from "./artifacts";
import { Profiles } from "./profiles";
import { Settings } from "./settings";
import { Tiers } from "./tiers";
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

export const ExportProjectBody = z.object({
  path: z.string().min(1),
  history: z.boolean().default(false),
  logs: z.boolean().default(false),
  acceptFindings: z.array(z.string()).default([]),
}).strict().refine((body) => !body.logs || body.history, { path: ["logs"], message: "logs require history" });
export type ExportProjectBody = z.infer<typeof ExportProjectBody>;

const ExportFinding = z.object({ fingerprint: z.string(), file: z.string(), line: z.number().int(), rule: z.string() });
export const ExportProjectResult = z.discriminatedUnion("state", [
  z.object({ state: z.literal("findings"), findings: z.array(ExportFinding) }),
  z.object({ state: z.literal("written"), path: z.string() }),
]);
export type ExportProjectResult = z.infer<typeof ExportProjectResult>;

export const ImportProjectBody = z.object({
  path: z.string().min(1),
  id: ProjectId.optional(),
  accounts: z.record(z.string().min(1), z.string().min(1)).optional(),
}).strict();
export type ImportProjectBody = z.infer<typeof ImportProjectBody>;

export const ImportProjectResult = z.discriminatedUnion("state", [
  z.object({ state: z.literal("needs-accounts"), accounts: z.array(z.object({ id: z.string(), kind: z.enum(["model", "forge", "service"]) })) }),
  z.object({ state: z.literal("imported"), id: ProjectId, itemId: z.ulid(), warning: z.string() }),
]);
export type ImportProjectResult = z.infer<typeof ImportProjectResult>;

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
  z.object({ type: z.literal("chat.updated"), chatId: z.string() }),
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

export const chatAttachmentMaxBytes = 10_000_000;
const chatAttachmentMaxBase64 = 4 * Math.ceil(chatAttachmentMaxBytes / 3);
export const ChatImageMime = z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]);
export type ChatImageMime = z.infer<typeof ChatImageMime>;
export const ChatReference = z.strictObject({
  project: ProjectId.optional(),
  jobId: z.string().min(1).optional(),
  nodeRunId: z.string().min(1).optional(),
  recipe: Name.optional(),
  node: Name.optional(),
  template: Name.optional(),
}).refine((reference) => Object.keys(reference).length > 0, "a context reference is required");
export type ChatReference = z.infer<typeof ChatReference>;
export const ChatView = z.object({
  id: z.string(),
  title: z.string(),
  projectId: ProjectId.nullable(),
  createdAt: z.number(),
  lastReadAt: z.number().nullable(),
  unread: z.number().int().nonnegative(),
});
export type ChatView = z.infer<typeof ChatView>;
export const ChatMessageView = z.object({
  id: z.string(),
  chatId: z.string(),
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  context: z.array(ChatReference),
  createdAt: z.number(),
  state: z.enum(["queued", "running", "completed", "interrupted", "failed"]),
  error: z.string().nullable(),
});
export type ChatMessageView = z.infer<typeof ChatMessageView>;
export const ChatAttachmentView = z.object({
  id: z.string(),
  messageId: z.string().nullable(),
  mime: ChatImageMime,
  size: z.number().int().nonnegative(),
});
export type ChatAttachmentView = z.infer<typeof ChatAttachmentView>;
export const ChatActionView = z.object({
  id: z.string(),
  messageId: z.string(),
  tool: z.string(),
  target: z.unknown(),
  createdAt: z.number(),
});
export type ChatActionView = z.infer<typeof ChatActionView>;
export const ChatDetail = z.object({
  chat: ChatView,
  messages: z.array(ChatMessageView),
  actions: z.array(ChatActionView),
  attachments: z.array(ChatAttachmentView),
  supportsImages: z.boolean().nullable(),
});
export type ChatDetail = z.infer<typeof ChatDetail>;
export const SendChatMessageBody = z.strictObject({
  text: z.string(),
  context: z.array(ChatReference).default([]),
  attachmentIds: z.array(z.ulid()).default([]),
}).refine(({ text, attachmentIds }) => text.trim() !== "" || attachmentIds.length > 0, "text or an attachment is required");
export type SendChatMessageBody = z.infer<typeof SendChatMessageBody>;

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

const Sha = z.string().regex(/^[0-9a-f]{64}$/);
const PathParams = z.object({ path: z.string().min(1) });

export const DefinitionFile = z.object({ path: z.string(), content: z.string(), sha256: Sha });
export type DefinitionFile = z.infer<typeof DefinitionFile>;

export const DefinitionEntry = z.object({ path: z.string(), sha256: Sha, value: z.unknown().nullable(), errors: z.array(DefinitionErrorView) });
export type DefinitionEntry = z.infer<typeof DefinitionEntry>;

export const SaveDefinitionBody = z.object({ content: z.string(), baseSha256: Sha.nullable() }).strict();
export type SaveDefinitionBody = z.infer<typeof SaveDefinitionBody>;

export const SaveDefinitionResult = z.object({ sha256: Sha, confirmItemIds: z.array(z.string()) });

export const ValidateDefinitionBody = z.object({ path: z.string().min(1), content: z.string() }).strict();

export const InstantiateBody = z.object({ kind: z.enum(["node", "recipe"]), name: Name, project: ProjectId }).strict();
export type InstantiateBody = z.infer<typeof InstantiateBody>;

export const InstantiateResult = z.object({ created: z.array(z.string()), kept: z.array(z.string()), confirmItemIds: z.array(z.string()) });

const globalFile = <S extends z.ZodType>(name: string, schema: S) =>
  ({
    get: { method: "GET", path: `/${name}`, response: z.object({ value: schema, sha256: Sha }) },
    put: { method: "PUT", path: `/${name}`, body: z.object({ value: schema, baseSha256: Sha }).strict(), response: z.object({ sha256: Sha }) },
  }) as const;
const settingsFile = globalFile("settings", Settings);
const accountsFile = globalFile("accounts", Accounts);
const profilesFile = globalFile("profiles", Profiles);
const tiersFile = globalFile("tiers", Tiers);

export const LoginView = z.object({
  id: z.string(),
  account: z.string(),
  osUser: z.string(),
  connector: z.string(),
  defaultDir: z.boolean(),
  state: z.enum(["logged_in", "logged_out", "unknown", "unchecked"]),
  email: z.string().nullable(),
  plan: z.string().nullable(),
  running: z.boolean(),
});
export type LoginView = z.infer<typeof LoginView>;

export const AccountState = z.enum(["logged_in", "logged_out", "unknown"]);

export const PrerequisiteView = z.object({ tool: z.string(), ok: z.boolean(), version: z.string().nullable(), problem: z.string().nullable(), setting: z.string().nullable() });
export type PrerequisiteView = z.infer<typeof PrerequisiteView>;

export const FirstRunStep = z.enum(["prerequisites", "home", "accounts", "tiers", "orchestrator", "project"]);
export const FirstRunView = z.object({
  done: z.boolean(),
  steps: z.array(z.object({ step: FirstRunStep, ok: z.boolean(), problems: z.array(z.string()) })),
});
export type FirstRunView = z.infer<typeof FirstRunView>;

const TokenCounts = z.object({ input: z.number(), output: z.number(), cacheRead: z.number(), cacheWrite: z.number() });

export const UsageView = z.object({
  days: z.array(z.object({ day: z.string(), project: z.string(), account: z.string(), tokens: TokenCounts, cost: z.number() })),
  budgets: z.array(z.object({ project: z.string(), dayTokens: z.number().nullable(), dayUsd: z.number().nullable(), usedTokens: z.number(), usedUsd: z.number() })),
  cooldowns: z.array(z.object({ account: z.string(), kind: z.enum(["quota", "rate_limit"]), until: z.number() })),
  quotas: z.array(z.object({ account: z.string(), status: z.string(), resetAt: z.number().nullable(), windows: z.record(z.string(), z.object({ utilization: z.number(), resetAt: z.number() })), seenAt: z.number() })),
});
export type UsageView = z.infer<typeof UsageView>;

export const themeTokens = [
  "bg",
  "bg-gradient-1",
  "bg-gradient-2",
  "surface",
  "surface-raised",
  "border",
  "text",
  "text-muted",
  "accent",
  "status-running",
  "status-success",
  "status-failed",
  "status-warning",
  "status-inactive",
] as const;
export const ThemeToken = z.enum(themeTokens);
export const Theme = z
  .object({
    $schema: z.string().optional(),
    name: z.string().min(1),
    tokens: z.partialRecord(ThemeToken, z.string().regex(/^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla)\([^)]*\))$/, "a CSS color")),
  })
  .strict();
export type Theme = z.infer<typeof Theme>;
export const ThemeFileView = z.object({ file: z.string(), theme: Theme.nullable(), errors: z.array(DefinitionErrorView) });

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
  bodyLimit?: number;
  response: z.ZodType;
};

const control = (name: string) => ({ method: "POST", path: `/jobs/:id/${name}`, params: IdParams, response: Ok }) as const;

export const routes = {
  listProjects: { method: "GET", path: "/projects", response: z.array(ProjectView) },
  createProject: { method: "POST", path: "/projects", body: CreateProjectBody, response: z.object({ id: ProjectId }) },
  exportProject: { method: "POST", path: "/projects/:id/export", params: IdParams, body: ExportProjectBody, response: ExportProjectResult },
  importProject: { method: "POST", path: "/projects/import", body: ImportProjectBody, response: ImportProjectResult },
  getProject: { method: "GET", path: "/projects/:id", params: IdParams, response: ProjectView },
  deleteProject: { method: "DELETE", path: "/projects/:id", params: IdParams, response: Ok },
  getArtifact: {
    method: "GET",
    path: "/artifacts/:job/:run/:name",
    params: z.object({ job: z.string().min(1), run: z.string().min(1), name: z.string().min(1) }),
    response: z.object({ artifact: Artifact, content: z.string(), encoding: z.literal("base64").optional() }),
  },
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
  listChats: { method: "GET", path: "/chats", response: z.array(ChatView) },
  createChat: { method: "POST", path: "/chats", body: z.strictObject({ title: z.string().trim().min(1) }), response: ChatView },
  getChat: { method: "GET", path: "/chats/:id", params: IdParams, response: ChatDetail },
  sendChatMessage: { method: "POST", path: "/chats/:id/messages", params: IdParams, body: SendChatMessageBody, response: ChatMessageView },
  uploadChatAttachment: {
    method: "POST",
    path: "/chats/:id/attachments",
    params: IdParams,
    body: z.strictObject({ mime: ChatImageMime, data: z.base64().max(chatAttachmentMaxBase64) }),
    bodyLimit: chatAttachmentMaxBase64 + 1024,
    response: ChatAttachmentView,
  },
  retryChatMessage: {
    method: "POST",
    path: "/chats/:id/messages/:messageId/retry",
    params: IdParams.extend({ messageId: z.string().min(1) }),
    response: ChatMessageView,
  },
  markChatRead: { method: "POST", path: "/chats/:id/read", params: IdParams, response: ChatView },
  listDefinitions: { method: "GET", path: "/definitions", query: z.object({ dir: z.string().min(1) }), response: z.array(DefinitionEntry) },
  getDefinition: { method: "GET", path: "/definitions/*path", params: PathParams, response: DefinitionFile },
  saveDefinition: { method: "PUT", path: "/definitions/*path", params: PathParams, body: SaveDefinitionBody, response: SaveDefinitionResult },
  validateDefinition: { method: "POST", path: "/definitions/validate", body: ValidateDefinitionBody, response: z.object({ errors: z.array(DefinitionErrorView) }) },
  instantiate: { method: "POST", path: "/definitions/instantiate", body: InstantiateBody, response: InstantiateResult },
  getSettings: settingsFile.get,
  putSettings: settingsFile.put,
  getAccounts: accountsFile.get,
  putAccounts: accountsFile.put,
  getProfiles: profilesFile.get,
  putProfiles: profilesFile.put,
  getTiers: tiersFile.get,
  putTiers: tiersFile.put,
  setProtectedMode: { method: "POST", path: "/protected-mode", body: ProtectedModeBody, response: Ok },
  listLogins: { method: "GET", path: "/logins", response: z.array(LoginView) },
  startLogin: { method: "POST", path: "/logins", body: StartLoginBody, response: z.object({ loginId: z.string() }) },
  loginCode: { method: "POST", path: "/logins/:id/code", params: IdParams, body: LoginCodeBody, response: Ok },
  recheckLogin: { method: "POST", path: "/logins/:id/recheck", params: IdParams, response: LoginView },
  recheckAccount: { method: "POST", path: "/accounts/:id/recheck", params: IdParams, response: z.object({ state: AccountState }) },
  startAccountLogin: { method: "POST", path: "/accounts/:id/login", params: IdParams, response: z.object({ loginId: z.string() }) },
  accountOptions: { method: "GET", path: "/accounts/:id/options", params: IdParams, response: z.object({ models: z.array(z.string()), efforts: z.array(z.string()) }).nullable() },
  checkPrerequisites: { method: "POST", path: "/prerequisites/check", response: z.array(PrerequisiteView) },
  getFirstRun: { method: "GET", path: "/first-run", response: FirstRunView },
  getUsage: { method: "GET", path: "/usage", query: z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), response: UsageView },
  listThemes: { method: "GET", path: "/themes", response: z.array(ThemeFileView) },
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
export type RouteResult<N extends RouteName> = z.output<Routes[N]["response"]>;
