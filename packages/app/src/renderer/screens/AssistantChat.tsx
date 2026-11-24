import { ChatConfirmationRow, ChatForm, ChatImageMime, ExportFinding, ImportProjectPreview, chatAttachmentMaxBytes, chatCompactCommand, chatFormProblem } from "@pecore/schemas";
import type { ChatActionView, ChatAttachmentView, ChatDetail, ChatFormAnswer, ChatFormAnswers, ChatFormQuestion, ChatMessageView, ChatSender, ProjectManagerIdentity } from "@pecore/schemas";
import { ProjectManagerAvatar } from "../components/ProjectManager";
import { Fragment, createContext, useContext, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import ReactMarkdown from "react-markdown";
import { Link, useLocation, useSearchParams } from "react-router";
import remarkGfm from "remark-gfm";
import { call } from "../api/client";
import { useAction, useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { ChatConfirmation } from "../components/ChatConfirmation";
import { ExportFindings, ImportSelectionFields, ProjectSecurityReview, useImportSelection } from "../components/ProjectShare";
import { StateLabel } from "../components/states";
import type { StateInfo } from "../components/states";
import { ErrorText, dateTime, time } from "../components/ui";
import { Button, IconButton } from "../ds/button";
import { Checkbox, RadioGroup } from "../ds/choice";
import { TextTable } from "../ds/data";
import { Alert, Badge, EmptyState, Spinner } from "../ds/feedback";
import { TextField } from "../ds/field";
import { ArrowUpIcon, ClipIcon, CompactIcon, SparkIcon, TrashIcon, XIcon } from "../ds/icons";
import { Dialog } from "../ds/overlay";
import { definitionUrl, object, string } from "./NodeEditor";
import s from "./AssistantChat.module.css";

type SelectedFile = { key: number; file: File; image: boolean; attachmentId?: string };
type ActionLink = { to: string; label: string };
type ChatApi = {
  get(): Promise<ChatDetail>;
  clear(): Promise<unknown>;
  send(body: { text: string; attachmentIds: string[] }): Promise<unknown>;
  upload(body: { name: string; mime: string; data: string }): Promise<ChatAttachmentView>;
  attachment(id: string): Promise<{ mime: string; data: string }>;
  retry(id: string): Promise<unknown>;
  read(): Promise<unknown>;
  answerForm(id: string, body: ChatFormAnswers): Promise<unknown>;
};
type ChatTarget = { api: ChatApi; agent: string };
type ProjectEntry = { name: string; pm: ProjectManagerIdentity | null };
type ChatPeople = { title: string; pm: ProjectManagerIdentity | null; projects: Map<string, ProjectEntry>; projectName: string | null };

function chatApi(project: string | null): ChatApi {
  if (project === null) {
    return {
      get: () => call("getChat"),
      clear: () => call("clearChat"),
      send: (body) => call("sendChatMessage", { body }),
      upload: (body) => call("uploadChatAttachment", { body }),
      attachment: (id) => call("getChatAttachment", { params: { id } }),
      retry: (id) => call("retryChatMessage", { params: { id } }),
      read: () => call("markChatRead"),
      answerForm: (id, body) => call("answerChatForm", { params: { id }, body }),
    };
  }
  const params = { id: project };
  return {
    get: () => call("getProjectChat", { params }),
    clear: () => call("clearProjectChat", { params }),
    send: (body) => call("sendProjectChatMessage", { params, body }),
    upload: (body) => call("uploadProjectChatAttachment", { params, body }),
    attachment: (attachmentId) => call("getProjectChatAttachment", { params: { id: project, attachmentId } }),
    retry: (messageId) => call("retryProjectChatMessage", { params: { id: project, messageId } }),
    read: () => call("markProjectChatRead", { params }),
    answerForm: (actionId, body) => call("answerProjectChatForm", { params: { id: project, actionId }, body }),
  };
}

const ChatContext = createContext<ChatTarget & ChatPeople>({ api: chatApi(null), agent: "Assistant", title: "Assistant", pm: null, projects: new Map(), projectName: null });

export function chatProject(pathname: string): string | null {
  const match: RegExpExecArray | null = /^\/projects\/([^/]+)/.exec(pathname) ?? /^\/edit\/(?:node|recipe)\/projects\/([^/]+)\//.exec(pathname);
  const id: string | undefined = match?.[1];
  return id && id !== "new" ? decodeURIComponent(id) : null;
}

const messageStates: Record<ChatMessageView["state"], StateInfo | null> = {
  queued: { label: "Queued", tone: "warning", icon: "", detail: null, pulse: false },
  running: { label: "Running", tone: "running", icon: "", detail: null, pulse: true },
  completed: null,
  interrupted: { label: "Interrupted", tone: "inactive", icon: "", detail: null, pulse: false },
  failed: { label: "Failed", tone: "failed", icon: "", detail: null, pulse: false },
};

function fileSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${+(bytes / 1_000_000).toFixed(2)} MB`;
  if (bytes >= 1_000) return `${+(bytes / 1_000).toFixed(2)} kB`;
  return `${bytes} B`;
}

function dataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader: FileReader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error(`Could not read ${file.name}.`));
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

async function base64(file: File): Promise<string> {
  const url: string = await dataUrl(file);
  return url.slice(url.indexOf(",") + 1);
}

function Thumbnail({ file }: { file: File }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live: boolean = true;
    void dataUrl(file).then((url) => { if (live) setSrc(url); }, () => undefined);
    return () => { live = false; };
  }, [file]);
  return src ? <img className={s.thumbImage} src={src} alt={file.name} /> : <Spinner size="xs" />;
}

function SentImage({ id, name }: { id: string; name: string }) {
  const { api } = useContext(ChatContext);
  const image = useData(() => api.attachment(id), [api, id]);
  return image.data ? <img className={s.thumbImage} src={`data:${image.data.mime};base64,${image.data.data}`} alt={name} /> : <Spinner size="xs" />;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry !== "") : [];
}

function actionLinks(target: Record<string, unknown>): ActionLink[] {
  const jobIds: unknown[] = Array.isArray(target.jobIds) ? target.jobIds : Object.values(object(target.jobIds));
  const jobs: Set<string> = new Set([string(target.jobId), ...strings(jobIds)].filter(Boolean));
  const items: Set<string> = new Set([string(target.itemId), ...strings(target.queueItemIds)].filter(Boolean));
  const paths: Set<string> = new Set([string(target.path), ...strings(target.paths)]);
  const links: ActionLink[] = [
    ...[...jobs].map((id) => ({ to: `/jobs/${encodeURIComponent(id)}`, label: `Job ${id}` })),
    ...[...items].map((id) => ({ to: `/notifications/${encodeURIComponent(id)}`, label: `Notification ${id}` })),
  ];
  const agent: string = string(target.agentId);
  if (agent) links.push({ to: `/agents/edit/${encodeURIComponent(agent)}`, label: string(target.agentName) || agent });
  for (const path of paths) {
    const section: string | undefined = /^(?:templates|projects\/[^/]+)\/(nodes|recipes|knowledge)\/.+/.exec(path)?.[1];
    if (!section) continue;
    const to: string = path.endsWith(".json") && section !== "knowledge"
      ? definitionUrl(section === "nodes" ? "node" : "recipe", path)
      : `?${new URLSearchParams({ definition: path })}`;
    links.push({ to, label: path });
  }
  return links;
}

const confirmationRows = ChatConfirmationRow.array().min(1);
const confirmationStatuses: Record<string, string> = {
  awaiting_confirmation: "Awaiting confirmation",
  creating_project: "Creating project…",
  updating_project: "Updating project…",
  deleting_project: "Deleting project…",
  deleting_agent: "Deleting agent…",
  approved: "Confirmed",
  cancelled: "Rejected",
};

function ActionConfirmation({ action, rows, connected }: { action: ChatActionView; rows: ChatConfirmationRow[]; connected: boolean }) {
  const target: Record<string, unknown> = object(action.target);
  const state: string = string(target.state);
  const project: string = string(target.project);
  const id: string = encodeURIComponent(project);
  const deletingAgent: boolean = action.tool === "delete_agent";
  const deleting: boolean = action.tool === "delete_project" || deletingAgent;
  const updating: boolean = action.tool === "update_project";
  const operation: string = deleting ? "Deletion" : updating ? "Update" : "Creation";
  const status: string = state === "failed" ? `${operation} failed`
    : state === "interrupted" ? `${operation} interrupted`
    : deleting && state === "approved" ? deletingAgent ? "Agent deleted" : "Project deleted"
    : updating && state === "approved" ? "Project updated" : confirmationStatuses[state] ?? "";
  const answer = useAction(async (decision: "approve" | "cancel") => {
    await call(deletingAgent ? "answerChatAgentDeletion" : deleting ? "answerChatProjectDeletion" : updating ? "answerChatProjectUpdate" : "answerChatProjectCreation", { params: { id: action.id }, body: { decision } });
  });
  return (
    <ChatConfirmation title={deletingAgent ? "Delete agent" : deleting ? "Delete project" : updating ? "Change project" : "Create project"} rows={rows} status={status} destructive={deleting}
      pending={state === "awaiting_confirmation"} disabled={!connected} busy={answer.busy}
      error={answer.error ?? (string(target.error) || null)} onDecision={(decision) => void answer.run(decision)}>
      {project && connected && <Link to={target.creating === true ? `/projects/new?resume=${id}` : `/projects/${id}`}>
        {target.creating === true ? "Open project setup" : "Open project"}
      </Link>}
    </ChatConfirmation>
  );
}

function ImportConfirmation({ action, preview, connected }: { action: ChatActionView; preview: ImportProjectPreview; connected: boolean }) {
  const target: Record<string, unknown> = object(action.target);
  const state: string = string(target.state);
  const project: string = string(target.project);
  const pending: boolean = state === "awaiting_confirmation";
  const fields = useImportSelection(preview);
  const rows: ChatConfirmationRow[] = [{ label: "Project ID", value: project || preview.review.projectId }];
  const source: string = string(target.source);
  if (source) rows.push({ label: "Source", value: source });
  const answer = useAction(async (decision: "approve" | "cancel") => {
    await call("answerChatProjectImport", { params: { id: action.id }, body: decision === "approve"
      ? { decision, selection: fields.value } : { decision } });
  });
  const status: string = state === "approved" ? "Project imported"
    : state === "importing_project" ? "Importing project…"
    : state === "failed" ? "Import failed"
    : state === "interrupted" ? "Import interrupted"
    : confirmationStatuses[state] ?? "";
  return (
    <ChatConfirmation title="Import project" rows={rows}
      status={status} pending={pending} disabled={!connected} busy={answer.busy} confirmDisabled={!fields.valid}
      error={answer.error ?? (string(target.error) || null)} onDecision={(decision) => void answer.run(decision)}>
      {state !== "approved" && state !== "cancelled" && <ProjectSecurityReview review={preview.review} />}
      {(pending || state === "importing_project") && <ImportSelectionFields preview={preview} fields={fields} disabled={!connected || answer.busy || !pending} />}
      {project && connected && <Link to={`/projects/${encodeURIComponent(project)}`}>Open project</Link>}
    </ChatConfirmation>
  );
}

function ExportConfirmation({ action, findings, connected }: { action: ChatActionView; findings: ExportFinding[]; connected: boolean }) {
  const target: Record<string, unknown> = object(action.target);
  const state: string = string(target.state);
  const path: string = string(target.path);
  const answer = useAction(async (decision: "approve" | "cancel") => {
    await call("answerChatProjectExport", { params: { id: action.id }, body: decision === "approve"
      ? { decision, fingerprints: findings.map(({ fingerprint }) => fingerprint) } : { decision } });
  });
  const status: string = state === "written" ? "Project exported"
    : state === "exporting_project" ? "Exporting project…"
    : state === "failed" ? "Export failed"
    : state === "interrupted" ? "Export interrupted"
    : confirmationStatuses[state] ?? "";
  const rows: ChatConfirmationRow[] = [{ label: "Project ID", value: string(target.project) }];
  if (path) rows.push({ label: "Saved to", value: path });
  return (
    <ChatConfirmation title="Export project" rows={rows} status={status} pending={state === "awaiting_confirmation"}
      disabled={!connected} busy={answer.busy} confirmLabel="Export anyway"
      error={answer.error ?? (string(target.error) || null)} onDecision={(decision) => void answer.run(decision)}>
      {findings.length > 0 && state !== "cancelled" && <ExportFindings findings={findings} />}
    </ChatConfirmation>
  );
}

type Draft = { choices: string[]; other: boolean; text: string };
const otherValue: string = "\u0000other";

function FormQuestion({ question, draft, disabled, onChange }: { question: ChatFormQuestion; draft: Draft; disabled: boolean; onChange(draft: Draft): void }) {
  const label = (option: ChatFormQuestion["options"][number]): ReactNode => option.recommended
    ? <>{option.label} <Badge tone="accent">Recommended</Badge></> : option.label;
  const other = draft.other && <TextField size="sm" aria-label="Other answer" placeholder="Your answer" value={draft.text} disabled={disabled}
    onValueChange={(text) => onChange({ ...draft, text })} />;
  if (question.kind === "text") {
    return <TextField size="sm" label={question.prompt} placeholder={question.placeholder} value={draft.text} disabled={disabled}
      onValueChange={(text) => onChange({ ...draft, text })} />;
  }
  if (question.kind === "single") {
    return <div className={s.formQuestion}>
      <RadioGroup label={question.prompt} disabled={disabled} value={draft.other ? otherValue : draft.choices[0] ?? ""}
        options={[...question.options.map((option) => ({ value: option.label, label: label(option), detail: option.description })), { value: otherValue, label: "Other" }]}
        onValueChange={(value) => onChange(value === otherValue ? { choices: [], other: true, text: draft.text } : { choices: [value], other: false, text: "" })} />
      {other}
    </div>;
  }
  return <div className={s.formQuestion} role="group" aria-label={question.prompt}>
    <span className={s.formPrompt}>{question.prompt}</span>
    {question.options.map((option) => <Checkbox key={option.label} label={label(option)} detail={option.description} disabled={disabled}
      checked={draft.choices.includes(option.label)}
      onCheckedChange={(checked) => onChange({ ...draft, choices: checked ? [...draft.choices, option.label] : draft.choices.filter((choice) => choice !== option.label) })} />)}
    <Checkbox label="Other" disabled={disabled} checked={draft.other} onCheckedChange={(checked) => onChange({ ...draft, other: checked, text: checked ? draft.text : "" })} />
    {other}
  </div>;
}

function FormCard({ action, form, connected }: { action: ChatActionView; form: ChatForm; connected: boolean }) {
  const { api } = useContext(ChatContext);
  const target: Record<string, unknown> = object(action.target);
  const state: string = string(target.state);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const answers: Record<string, ChatFormAnswer> = Object.fromEntries(form.questions.map(({ id }) => {
    const draft: Draft = drafts[id] ?? { choices: [], other: false, text: "" };
    return [id, { choices: draft.choices, text: draft.other || form.questions.find((question) => question.id === id)?.kind === "text" ? draft.text.trim() : "" }];
  }));
  const submit = useAction(() => api.answerForm(action.id, { answers }));
  if (state !== "awaiting_answer") {
    const given: Record<string, ChatFormAnswer> = object(target.answers) as Record<string, ChatFormAnswer>;
    return <section className={s.action} aria-label={form.title ?? "Questions"}>
      <div className={s.actionHead}><SparkIcon /><strong>{form.title ?? "Questions"}</strong><span className={s.actionMeta}>{state === "answered" ? "Answered" : "Not answered"}</span></div>
      {state === "answered" && <ul className={s.formAnswers}>{form.questions.map(({ id, prompt }) => <li key={id}>
        <span className={s.actionMeta}>{prompt}</span> {[...(given[id]?.choices ?? []), ...(given[id]?.text ? [given[id].text] : [])].join(", ")}
      </li>)}</ul>}
    </section>;
  }
  const problem: string | null = chatFormProblem(form, answers);
  const busy: boolean = submit.busy || !connected;
  return (
    <form className={`${s.action} ${s.form}`} aria-label={form.title ?? "Questions"} onSubmit={(event) => {
      event.preventDefault();
      if (!busy && problem === null) void submit.run();
    }}>
      <div className={s.actionHead}><SparkIcon /><strong>{form.title ?? "Questions"}</strong></div>
      {form.questions.map((question) => <FormQuestion key={question.id} question={question} disabled={busy}
        draft={drafts[question.id] ?? { choices: [], other: false, text: "" }}
        onChange={(draft) => setDrafts((old) => ({ ...old, [question.id]: draft }))} />)}
      <ErrorText error={submit.error} />
      <div><Button type="submit" variant="primary" size="sm" disabled={busy || problem !== null} loading={submit.busy}>Send</Button></div>
    </form>
  );
}

function DelegationCard({ project, error, connected }: { project: string; error: string; connected: boolean }) {
  const entry: ProjectEntry | undefined = useContext(ChatContext).projects.get(project);
  const name: string = entry?.pm?.name ?? "the Project Manager";
  return (
    <div className={s.action}>
      {entry?.pm && <ProjectManagerAvatar pm={entry.pm} />}
      <div className={s.delegation}>
        <strong>Order sent to {name}</strong>
        <span className={s.actionMeta}>
          {entry?.name ?? project}
          {connected && <> · <Link to={`/projects/${encodeURIComponent(project)}`}>{entry?.pm ? `Open ${entry.pm.name}'s chat` : "Open chat"}</Link></>}
        </span>
      </div>
      <ErrorText error={error} />
    </div>
  );
}

function ActionCard({ action, connected }: { action: ChatActionView; connected: boolean }) {
  const target: Record<string, unknown> = object(action.target);
  if (action.tool === "ask_user") {
    const form = ChatForm.safeParse(target.form);
    if (form.success) return <FormCard action={action} form={form.data} connected={connected} />;
  }
  if (action.tool === "delegate_to_pm" && string(target.project)) return <DelegationCard project={string(target.project)} error={string(target.error)} connected={connected} />;
  if (action.tool === "create_project" || action.tool === "update_project" || action.tool === "delete_project" || action.tool === "delete_agent") {
    const rows = confirmationRows.safeParse(target.rows);
    if (rows.success) return <ActionConfirmation action={action} rows={rows.data} connected={connected} />;
  }
  if (action.tool === "import_project") {
    const preview = ImportProjectPreview.safeParse(target.preview);
    if (preview.success) return <ImportConfirmation action={action} preview={preview.data} connected={connected} />;
  }
  if (action.tool === "export_project") {
    const findings = ExportFinding.array().safeParse(target.findings);
    if (findings.success || target.state === "written") return <ExportConfirmation action={action} findings={findings.data ?? []} connected={connected} />;
  }
  if (action.tool === "analyze_project_archive") {
    const rows = ChatConfirmationRow.array().safeParse(target.rows);
    if (rows.success && typeof target.totalFindings === "number" && typeof target.unreadFiles === "number") {
      const state: string = string(target.model);
      const model: string = state === "complete" ? "Model review complete" : state === "partial" ? "Model reviewed part of the text" : state === "failed" ? "Model review failed" : "Static review only";
      return <section className={s.action} aria-label="Project security review">
        <div className={s.actionHead}><SparkIcon /><strong>Project security review</strong></div>
        <span>{target.totalFindings} findings · {model}</span>
        {target.unreadFiles > 0 && <span>{target.unreadFiles} binary or very large files could not be analyzed</span>}
        {rows.data.length > 0 && <details>
          <summary>{rows.data.length < target.totalFindings ? `First ${rows.data.length} findings` : "Finding locations"}</summary>
          <ul className={s.links}>{rows.data.map(({ label, value }, index) => <li key={index}>{label} <code>{value}</code></li>)}</ul>
        </details>}
      </section>;
    }
  }
  const links: ActionLink[] = actionLinks(target);
  const state: string = string(target.state);
  const error: string = string(target.error);
  const ticket: string = string(target.ticketId);
  const project: string = string(target.project);
  if (action.tool === "create_project" && project) {
    const id: string = encodeURIComponent(project);
    links.push({ to: target.creating === true ? `/projects/new?resume=${id}` : `/projects/${id}`, label: project });
  }
  return (
    <div className={s.action}>
      <div className={s.actionHead}>
        <SparkIcon />
        <span className={s.tool}>{action.tool.replaceAll("_", " ")}</span>
        {project && action.tool !== "create_project" && <span className={s.actionMeta}>{project}</span>}
        {state && <span className={s.actionMeta}>{state}</span>}
        {ticket && <span className={s.actionMeta}>Ticket {ticket}</span>}
      </div>
      <ErrorText error={error} />
      {links.length > 0 && <ul className={s.links}>
        {links.map(({ to, label }) => <li key={to}>{connected ? <Link to={to}>{label}</Link> : <span>{label}</span>}</li>)}
      </ul>}
    </div>
  );
}

const readTools: Record<string, string> = {
  list_agents: "agents",
  get_agent: "agent settings",
  agent_model_options: "model options",
  list_projects: "projects",
  get_project: "project settings",
  list_recipes: "recipes",
  read_ticket: "ticket",
  read_replies: "ticket replies",
  job_status: "job status",
  read_artifact: "job output",
  list_templates: "templates",
  list_definitions: "definitions",
  read_definition: "definition",
  validate: "definition check",
};

function rejected({ target }: ChatActionView): boolean {
  const fields: Record<string, unknown> = object(target);
  return fields.state === "rejected" || (fields.state === undefined && typeof fields.error === "string");
}

function Actions({ actions: all, connected }: { actions: ChatActionView[]; connected: boolean }) {
  const actions: ChatActionView[] = all.filter((action) => !rejected(action));
  const reads: string[] = [...new Set(actions.filter(({ tool }) => Object.hasOwn(readTools, tool)).map(({ tool }) => readTools[tool]!))];
  return (
    <>
      {actions.filter(({ tool }) => !Object.hasOwn(readTools, tool)).map((action) => <ActionCard key={action.id} action={action} connected={connected} />)}
      {reads.length > 0 && <div className={s.reads}>Read: {reads.join(", ")}</div>}
    </>
  );
}

const previewLength: number = 280;

function Message({ message, attachments, actions, connected, reload, working = false }: {
  message: ChatMessageView | undefined;
  attachments: ChatAttachmentView[];
  actions: ChatActionView[];
  connected: boolean;
  reload(): void;
  working?: boolean;
}) {
  const { api, agent, title, pm, projects, projectName } = useContext(ChatContext);
  const [open, setOpen] = useState<boolean>(false);
  const retry = useAction(async () => {
    if (!message) return;
    await api.retry(message.id);
    reload();
  });
  const sender: ChatSender | undefined = message?.sender;
  const user: boolean = message?.role === "user" && !sender;
  const ticket: string | undefined = message?.role === "user" ? message.ticket : undefined;
  const project: string | undefined = message?.context.find((reference) => reference.project)?.project;
  const reporter: ProjectEntry | undefined = sender === "pm" && project ? projects.get(project) : undefined;
  const job: string | undefined = sender === "job" ? message?.context.find((reference) => reference.jobId)?.jobId : undefined;
  const speaker: ProjectManagerIdentity | null = sender === "pm" ? reporter?.pm ?? null : sender ? null : pm;
  const managerProject: string | null = sender === "pm" ? reporter?.name ?? project ?? null : !sender && !user ? projectName : null;
  const author: string = ticket !== undefined ? `Ticket ${ticket}`
    : sender === "assistant" ? "Assistant"
    : sender === "job" ? "Agent question"
    : user ? "You"
    : managerProject !== null ? speaker ? `${speaker.name} - Project Manager` : "Project Manager"
    : title;
  const state: StateInfo | null = !message || (message.role === "user" && message.state === "running") ? null : messageStates[message.state];
  const text: string = message?.text ?? "";
  const long: boolean = Boolean(sender) && text.length > previewLength;
  const cut: number = text.lastIndexOf(" ", previewLength);
  const shown: string = long && !open ? `${text.slice(0, cut > previewLength / 2 ? cut : previewLength).trimEnd()}…` : text;
  const bubble = text && <div className={s.bubble}>
    <ReactMarkdown skipHtml disallowedElements={["img"]} remarkPlugins={[remarkGfm]} components={{
      a: ({ href, children }) => connected && href?.startsWith("https://")
        ? <a href={href} target="_blank" rel="noreferrer">{children}</a>
        : <span>{children}</span>,
      table: ({ children }) => <TextTable>{children}</TextTable>,
      code: ({ className, children }) => typeof children === "string" && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(children)
        ? <code className={className}><span className={s.colorSwatch} style={{ background: children }} aria-hidden />{children}</code>
        : <code className={className}>{children}</code>,
    }}>{shown}</ReactMarkdown>
  </div>;
  return (
    <article className={`${s.message} ${user ? s.user : s.assistant} ${sender && sender !== "pm" ? s.forwarded : ""}`}>
      {!user && (speaker ? <ProjectManagerAvatar pm={speaker} /> : <span className={s.avatar} aria-hidden><SparkIcon /></span>)}
      <div className={s.body}>
        <div className={s.meta}>
          <span className={s.author}>{author}</span>
          {message && <time dateTime={new Date(message.createdAt).toISOString()} title={dateTime(message.createdAt)}>{time(message.createdAt)}</time>}
          {state && <StateLabel info={state} />}
          {managerProject !== null && sender === "pm" && <span className={s.authorProject}>{managerProject}</span>}
        </div>
        {job && (connected ? <Link to={`/jobs/${encodeURIComponent(job)}`}>Open job {job}</Link> : <span>Job {job}</span>)}
        {ticket === undefined && sender !== "job" && bubble}
        {ticket === undefined && sender !== "job" && long && <Button size="sm" variant="ghost" className={s.more} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Show less" : "Show more"}</Button>}
        {attachments.length > 0 && <ul className={s.chips} aria-label="Message attachments">
          {attachments.map(({ id, name, mime, size }) => ChatImageMime.safeParse(mime).success
            ? <li className={s.thumb} key={id} title={`${name} · ${fileSize(size)}`}><SentImage id={id} name={name} /></li>
            : <li className={s.chip} key={id} title={`${size} bytes`}>{name} · {fileSize(size)}</li>)}
        </ul>}
        <ErrorText error={message?.error} />
        {message?.state === "interrupted" && <div><Button size="sm" disabled={!connected || retry.busy} loading={retry.busy} onClick={() => void retry.run()}>Retry</Button></div>}
        <ErrorText error={retry.error} />
        <Actions actions={actions} connected={connected} />
        {((working && !message) || (message?.role === "assistant" && message.state === "running")) &&
          <div className={s.thinking} role="status" aria-label={`The ${agent} is working on a reply`}><span /><span /><span /></div>}
      </div>
    </article>
  );
}

function isCompaction(message: ChatMessageView): boolean {
  return message.role === "user" && message.text.trim() === chatCompactCommand;
}

function Compaction({ message }: { message: ChatMessageView }) {
  const pending: boolean = message.state === "queued" || message.state === "running";
  const label: string = pending ? "Compacting the conversation…"
    : message.state === "completed" ? "Conversation compacted"
      : message.state === "failed" ? "Compaction failed" : "Compaction interrupted";
  return (
    <div className={s.compaction} role="status">
      <span className={s.compactionLabel}>{pending && <Spinner size="xs" />}{label}</span>
      <ErrorText error={message.error} />
    </div>
  );
}

function Composer({ supportsImages, connected, ready, reload, autoFocus, dropTarget }: {
  supportsImages: ChatDetail["supportsImages"];
  connected: boolean;
  ready: boolean;
  reload(): void;
  autoFocus?: boolean;
  dropTarget: RefObject<HTMLElement | null>;
}) {
  const [message, setMessage] = useState<string>("");
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<boolean>(false);
  const nextKey = useRef<number>(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const { api, agent } = useContext(ChatContext);
  const send = useAction(async () => {
    const attachmentIds: string[] = [];
    for (const selected of files) {
      let attachmentId: string | undefined = selected.attachmentId;
      if (!attachmentId) {
        const data: string = await base64(selected.file);
        const attachment: ChatAttachmentView = await api.upload({ name: selected.file.name, mime: selected.file.type, data });
        attachmentId = attachment.id;
        setFiles((pending) => pending.map((entry) => entry.key === selected.key ? { ...entry, attachmentId: attachment.id } : entry));
      }
      attachmentIds.push(attachmentId);
    }
    await api.send({ text: message, attachmentIds });
    setMessage("");
    setFiles([]);
    setFileError(null);
    input.current?.focus();
    reload();
  });
  const disabled: boolean = !connected || send.busy;
  const canSend: boolean = !disabled && ready && (!!message.trim() || files.length > 0);
  const noImages: string | null = supportsImages === true ? null
    : supportsImages === false ? `The current ${agent} cannot read images` : `Checking whether the ${agent} can read images…`;

  function addFiles(chosen: File[]): void {
    if (disabled) return;
    const selected: SelectedFile[] = [];
    const problems: string[] = [];
    for (const file of chosen) {
      const image: boolean = ChatImageMime.safeParse(file.type).success;
      if (file.size > chatAttachmentMaxBytes) problems.push(`${file.name} is larger than 10 MB.`);
      else if (image && noImages) problems.push(`${noImages}: ${file.name}.`);
      else selected.push({ key: nextKey.current++, file, image });
    }
    setFiles((pending) => [...pending, ...selected]);
    setFileError(problems.length ? problems.join(" ") : null);
  }
  const dropFiles = useEffectEvent((dropped: File[]): void => addFiles(dropped));

  useEffect(() => {
    const pane: HTMLElement | null = dropTarget.current;
    if (!pane) return;
    const carriesFiles = (event: DragEvent): boolean => event.dataTransfer?.types.includes("Files") === true;
    const stop = (): void => setDragging(false);
    const over = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      setDragging(true);
    };
    const leave = (event: DragEvent): void => {
      if (!(event.relatedTarget instanceof Node) || !pane.contains(event.relatedTarget)) stop();
    };
    const drop = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      stop();
      dropFiles(Array.from(event.dataTransfer!.files));
    };
    pane.addEventListener("dragover", over);
    pane.addEventListener("dragleave", leave);
    pane.addEventListener("drop", drop);
    window.addEventListener("dragend", stop);
    return () => {
      pane.removeEventListener("dragover", over);
      pane.removeEventListener("dragleave", leave);
      pane.removeEventListener("drop", drop);
      window.removeEventListener("dragend", stop);
    };
  }, [dropTarget]);

  return (
    <div className={s.composerWrap}>
      {dragging && <div className={s.dropNotice} role="status">{disabled ? "The chat is not available" : "Drop files to attach"}</div>}
      <form className={s.composer} onSubmit={(event) => {
        event.preventDefault();
        if (canSend) void send.run();
      }}>
        {files.length > 0 && <ul className={s.chips} aria-label="Selected files">
          {files.map(({ key, file, image }) => <li key={key} className={s.thumb}>
            {image ? <Thumbnail file={file} /> : <span className={s.thumbName}>{file.name}</span>}
            <IconButton size="sm" className={s.thumbRemove} label={`Remove ${file.name}`} icon={<XIcon />} disabled={disabled} onClick={() => setFiles((pending) => pending.filter((entry) => entry.key !== key))} />
          </li>)}
        </ul>}
        <textarea
          ref={input}
          aria-label="Message"
          placeholder={`Ask the ${agent}…`}
          rows={1}
          autoFocus={autoFocus}
          value={message}
          disabled={!connected}
          readOnly={send.busy}
          onChange={(event) => setMessage(event.target.value)}
          onPaste={(event) => {
            const pasted: File[] = Array.from(event.clipboardData.files);
            if (!pasted.length) return;
            event.preventDefault();
            addFiles(pasted.map((file, index) => file.type.startsWith("image/") ? new File([file], `Pasted image ${nextKey.current + index + 1}.${file.type.slice(6)}`, { type: file.type }) : file));
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (canSend) void send.run();
            }
          }}
        />
        <div className={s.composerBar}>
          <input
            ref={fileInput}
            className={s.hiddenInput}
            type="file"
            multiple
            aria-label="Attach files"
            disabled={disabled}
            tabIndex={-1}
            onChange={(event) => {
              addFiles(Array.from(event.currentTarget.files ?? []));
              event.currentTarget.value = "";
            }}
          />
          <IconButton label="Attach files, up to 10 MB each" icon={<ClipIcon />} disabled={disabled} onClick={() => fileInput.current?.click()} />
          <span className={s.composerHint}>{send.busy ? "Sending…" : "Enter to send · Shift Enter for a new line"}</span>
          <Button type="submit" variant="primary" className={s.composerAction} aria-label="Send" disabled={!canSend} icon={send.busy ? <Spinner /> : <ArrowUpIcon bold />} />
        </div>
      </form>
      {(fileError || send.error) && <div className={s.footnote}><ErrorText error={fileError ?? send.error} /></div>}
    </div>
  );
}

function DefinitionPreview({ path, onClose }: { path: string; onClose(): void }) {
  const file = useData(() => call("getDefinition", { params: { path } }), [path], (event) => event.type === "definition.changed" && event.path === path);
  return (
    <Dialog open title={path} onOpenChange={(open) => !open && onClose()} width={720} footer={<Button onClick={onClose}>Close</Button>}>
      <ErrorText error={file.error} />
      {file.loading && <Spinner />}
      {file.data && <pre className={s.definition}>{file.data.content}</pre>}
    </Dialog>
  );
}

export function ChatPanel() {
  const { pathname } = useLocation();
  const job: string | null = /^\/jobs\/([^/]+)/.exec(pathname)?.[1] ?? null;
  const owner = useData(() => job === null ? Promise.resolve(null) : call("getJob", { params: { id: decodeURIComponent(job) } }), [job]);
  if (job !== null && !owner.data && !owner.error) return null;
  const project: string | null = job === null ? chatProject(pathname) : owner.data?.job.projectId ?? null;
  return <Chat key={project ?? ""} project={project} />;
}

function Chat({ project }: { project: string | null }) {
  const agent: string = project === null ? "Assistant" : "Project Manager";
  const [target] = useState<ChatTarget>(() => ({ api: chatApi(project), agent }));
  const api: ChatApi = target.api;
  const connected: boolean = useConnected();
  const settings = useData(() => call("getChatAgentSettings", { query: project === null ? { role: "assistant" } : { role: "pm", project } }), [project],
    (event) => event.type === "project.updated" || (event.type === "definition.changed" && ["agents.json", "settings.json", "profiles.json"].includes(event.path)));
  const projectList = useData(() => call("listProjects"), [], (event) => event.type === "project.updated" || (event.type === "definition.changed" && event.path === "agents.json"));
  const projects: Map<string, ProjectEntry> = new Map((projectList.data ?? []).map(({ id, project: loaded }) => [id, { name: loaded?.name ?? id, pm: loaded?.pm ?? null }]));
  const own: ProjectEntry | undefined = project === null ? undefined : projects.get(project);
  const configured = settings.data?.value;
  const pm: ProjectManagerIdentity | null = configured?.kind === "pm" ? configured : own?.pm ?? null;
  const title: string = configured?.name ?? pm?.name ?? agent;
  const ready: boolean | null = settings.data ? !!settings.data.effectiveModel : null;
  const projectName: string | null = project === null ? null : own?.name ?? project;
  const people: ChatTarget & ChatPeople = { ...target, title, pm, projects, projectName };
  const detail = useData(() => api.get(), [], (event) => event.type === "chat.changed" && event.project === project);
  const [query, setQuery] = useSearchParams();
  const definition: string | null = query.get("definition");
  const [active, setActive] = useState<boolean>(() => document.visibilityState === "visible" && document.hasFocus());
  const pane = useRef<HTMLElement>(null);
  const history = useRef<HTMLDivElement>(null);
  const followHistory = useRef<boolean>(true);
  const marked = useRef<string | null>(null);
  const chat: ChatDetail | undefined = detail.data;
  const empty: boolean = chat?.messages.length === 0 && !chat.streamingReply && !detail.error;
  const lastReply: string = chat?.messages.findLast((message) => message.role === "assistant")?.id ?? "";
  const markRead = useAction(async () => {
    await api.read();
    detail.reload();
  });
  const compact = useAction(async () => {
    await api.send({ text: chatCompactCommand, attachmentIds: [] });
    detail.reload();
  });
  const clear = useAction(async () => {
    await api.clear();
    detail.reload();
  });
  const turnPending: boolean = chat?.messages.some(({ state }) => state === "queued" || state === "running") ?? false;
  const orders: Set<string> = new Set(chat?.messages.filter(({ role }) => role === "user").map(({ id }) => id));
  const replies: Map<string, ChatMessageView> = new Map();
  if (chat?.streamingReply?.replyTo) replies.set(chat.streamingReply.replyTo, chat.streamingReply);
  for (const message of chat?.messages ?? []) {
    if (message.replyTo) replies.set(message.replyTo, message);
  }
  const pending: ChatMessageView | undefined = chat?.messages.find((message) => message.role === "user" && (message.state === "running" || message.state === "queued") && !isCompaction(message));
  const canManage: boolean = connected && !compact.busy && !clear.busy && !turnPending;
  const canCompact: boolean = canManage && !!chat?.messages.some((message) => message.state === "completed" && !isCompaction(message));

  useEffect(() => {
    const update = (): void => setActive(document.visibilityState === "visible" && document.hasFocus());
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    document.addEventListener("visibilitychange", update);
    update();
    return () => {
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  useEffect(() => {
    if (!active || !connected || !chat || detail.error || markRead.busy) return;
    if (marked.current !== null && (!chat.unread || marked.current === lastReply)) return;
    marked.current = lastReply;
    void markRead.run();
  }, [active, connected, chat, detail.error, lastReply, markRead.busy]);

  useLayoutEffect(() => {
    if (followHistory.current && history.current) history.current.scrollTop = history.current.scrollHeight;
  }, [chat]);

  const actions: Map<string, ChatActionView[]> = new Map();
  const attachments: Map<string, ChatAttachmentView[]> = new Map();
  for (const action of chat?.actions ?? []) {
    const entries: ChatActionView[] = actions.get(action.messageId) ?? [];
    entries.push(action);
    actions.set(action.messageId, entries);
  }
  for (const attachment of chat?.attachments ?? []) {
    if (attachment.messageId === null) continue;
    const entries: ChatAttachmentView[] = attachments.get(attachment.messageId) ?? [];
    entries.push(attachment);
    attachments.set(attachment.messageId, entries);
  }
  return (
    <ChatContext.Provider value={people}>
    <aside className={s.panel} aria-label={agent}><section ref={pane} className={s.pane}>
      <div className={s.toolbar} role="group" aria-label="Conversation controls">
        {pm ? <ProjectManagerAvatar pm={pm} /> : project === null && <span className={s.avatar} aria-hidden><SparkIcon /></span>}
        <h2 className={s.title}>{title}</h2>
        <IconButton label="Compact conversation" icon={<CompactIcon />} disabled={!canCompact} loading={compact.busy} onClick={() => void compact.run()} />
        <IconButton label="Clear conversation" icon={<TrashIcon />} disabled={!canManage || !chat?.messages.length} loading={clear.busy} onClick={() => {
          if (window.confirm(`Delete this conversation and start a new ${agent} session?`)) void clear.run();
        }} />
      </div>
      {(compact.error || clear.error) && <div className={s.footnote}><ErrorText error={compact.error ?? clear.error} /></div>}
      {detail.error && <div className={s.footnote}><ErrorText error={detail.error} /></div>}
      {markRead.error && <div className={s.footnote}><Alert tone="danger" actions={<Button size="sm" disabled={!connected || markRead.busy} onClick={() => void markRead.run()}>Mark as read</Button>}>{markRead.error}</Alert></div>}
      <div ref={history} className={s.history} role="log" aria-label="Conversation messages" tabIndex={0} onScroll={(event) => {
        const pane: HTMLDivElement = event.currentTarget;
        followHistory.current = pane.scrollHeight - pane.clientHeight - pane.scrollTop <= 48;
      }}>
        {empty ? <div className={s.welcome}>
          <EmptyState title="Welcome">
            {projectName === null ? "What can I help you with?" : `What would you like to work on in ${projectName}?`}
          </EmptyState>
        </div> : <div className={s.thread}>
          {detail.loading && !chat && <Spinner />}
          {chat?.messages.map((message) => {
            if (isCompaction(message)) return <Compaction key={message.id} message={message} />;
            if (message.replyTo && orders.has(message.replyTo)) return null;
            const own: ChatActionView[] = actions.get(message.replyTo ?? message.id) ?? [];
            const reply: ChatMessageView | undefined = replies.get(message.id);
            const working: boolean = message.id === pending?.id;
            return <Fragment key={message.id}>
              <Message message={message} connected={connected}
                actions={message.role === "assistant" ? own : []} attachments={attachments.get(message.id) ?? []} reload={detail.reload} />
              {message.role === "user" && (reply || working || own.length > 0) &&
                <Message message={reply} connected={connected} actions={own} attachments={reply ? attachments.get(reply.id) ?? [] : []}
                  reload={detail.reload} working={working} />}
            </Fragment>;
          })}
        </div>}
      </div>
      {ready === false && connected && (
        <div className={s.footnote}>
          <Alert tone="warning" title={`No model for ${agent}`} actions={<Link to={project === null ? "/settings?section=assistant" : `/projects/${project}?tab=project-manager`}>Open settings</Link>}>
            Choose a provider and model.
          </Alert>
        </div>
      )}
      {chat && <Composer connected={connected} ready={ready === true && !clear.busy} supportsImages={chat.supportsImages} reload={detail.reload} autoFocus={project === null} dropTarget={pane} />}
      {definition && <DefinitionPreview key={definition} path={definition} onClose={() => setQuery({}, { replace: true })} />}
    </section></aside>
    </ChatContext.Provider>
  );
}
