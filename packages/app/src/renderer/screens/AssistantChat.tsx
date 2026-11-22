import { ChatConfirmationRow, ChatImageMime, ExportFinding, ImportProjectPreview, chatAttachmentMaxBytes, chatCompactCommand, roleProfile } from "@pecore/schemas";
import type { ChatActionView, ChatAttachmentView, ChatDetail, ChatMessageView, Role } from "@pecore/schemas";
import { Fragment, createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Link, useLocation, useSearchParams } from "react-router";
import { call } from "../api/client";
import { useAction, useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { ChatConfirmation } from "../components/ChatConfirmation";
import { ExportFindings, ImportSelectionFields, ProjectSecurityReview, useImportSelection } from "../components/ProjectShare";
import { StateLabel } from "../components/states";
import type { StateInfo } from "../components/states";
import { ErrorText, dateTime, time } from "../components/ui";
import { Button, IconButton } from "../ds/button";
import { Alert, Spinner } from "../ds/feedback";
import { ArrowUpIcon, ClipIcon, CompactIcon, SparkIcon, TrashIcon, XIcon } from "../ds/icons";
import { Dialog } from "../ds/overlay";
import { definitionUrl, object, settingUrl, string } from "./NodeEditor";
import { harnessName } from "./Settings";
import s from "./AssistantChat.module.css";

type SelectedImage = { key: number; file: File; mime: ChatImageMime; attachmentId?: string };
type ActionLink = { to: string; label: string };
type ChatApi = {
  get(): Promise<ChatDetail>;
  clear(): Promise<unknown>;
  send(body: { text: string; attachmentIds: string[] }): Promise<unknown>;
  upload(body: { mime: ChatImageMime; data: string }): Promise<ChatAttachmentView>;
  retry(id: string): Promise<unknown>;
  read(): Promise<unknown>;
};
type ChatTarget = { api: ChatApi; agent: string };

function chatApi(project: string | null): ChatApi {
  if (project === null) {
    return {
      get: () => call("getChat"),
      clear: () => call("clearChat"),
      send: (body) => call("sendChatMessage", { body }),
      upload: (body) => call("uploadChatAttachment", { body }),
      retry: (id) => call("retryChatMessage", { params: { id } }),
      read: () => call("markChatRead"),
    };
  }
  const params = { id: project };
  return {
    get: () => call("getProjectChat", { params }),
    clear: () => call("clearProjectChat", { params }),
    send: (body) => call("sendProjectChatMessage", { params, body }),
    upload: (body) => call("uploadProjectChatAttachment", { params, body }),
    retry: (messageId) => call("retryProjectChatMessage", { params: { id: project, messageId } }),
    read: () => call("markProjectChatRead", { params }),
  };
}

const ChatContext = createContext<ChatTarget>({ api: chatApi(null), agent: "Assistant" });

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
  for (const path of paths) {
    const section: string | undefined = /^(?:library|projects\/[^/]+)\/(nodes|recipes|knowledge)\/.+/.exec(path)?.[1];
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
  deleting_project: "Deleting project…",
  approved: "Confirmed",
  cancelled: "Rejected",
};

function ProjectConfirmation({ action, rows, connected }: { action: ChatActionView; rows: ChatConfirmationRow[]; connected: boolean }) {
  const target: Record<string, unknown> = object(action.target);
  const state: string = string(target.state);
  const project: string = string(target.project);
  const id: string = encodeURIComponent(project);
  const deleting: boolean = action.tool === "delete_project";
  const operation: string = deleting ? "Deletion" : "Creation";
  const status: string = state === "failed" ? `${operation} failed`
    : state === "interrupted" ? `${operation} interrupted`
    : deleting && state === "approved" ? "Project deleted" : confirmationStatuses[state] ?? "";
  const answer = useAction(async (decision: "approve" | "cancel") => {
    await call(deleting ? "answerChatProjectDeletion" : "answerChatProjectCreation", { params: { id: action.id }, body: { decision } });
  });
  return (
    <ChatConfirmation title={deleting ? "Delete project" : "Create project"} rows={rows} status={status} destructive={deleting}
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

function ActionCard({ action, connected }: { action: ChatActionView; connected: boolean }) {
  const target: Record<string, unknown> = object(action.target);
  if (action.tool === "create_project" || action.tool === "delete_project") {
    const rows = confirmationRows.safeParse(target.rows);
    if (rows.success) return <ProjectConfirmation action={action} rows={rows.data} connected={connected} />;
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
  if (action.tool === "update_project" && project) links.push({ to: `/projects/${encodeURIComponent(project)}`, label: "Open project" });
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
  list_projects: "projects",
  get_project: "project settings",
  list_recipes: "recipes",
  read_ticket: "ticket",
  read_replies: "ticket replies",
  job_status: "job status",
  read_artifact: "job output",
  list_templates: "library templates",
  validate: "definition check",
};

function Actions({ actions, connected }: { actions: ChatActionView[]; connected: boolean }) {
  const reads: string[] = [...new Set(actions.filter(({ tool }) => Object.hasOwn(readTools, tool)).map(({ tool }) => readTools[tool]!))];
  return (
    <>
      {actions.filter(({ tool }) => !Object.hasOwn(readTools, tool)).map((action) => <ActionCard key={action.id} action={action} connected={connected} />)}
      {reads.length > 0 && <div className={s.reads}>Read: {reads.join(", ")}</div>}
    </>
  );
}

function Message({ message, attachments, actions, connected, reload, working = false }: {
  message: ChatMessageView | undefined;
  attachments: ChatAttachmentView[];
  actions: ChatActionView[];
  connected: boolean;
  reload(): void;
  working?: boolean;
}) {
  const { api, agent } = useContext(ChatContext);
  const retry = useAction(async () => {
    if (!message) return;
    await api.retry(message.id);
    reload();
  });
  const user: boolean = message?.role === "user";
  const ticket: string | undefined = user ? message?.ticket : undefined;
  const state: StateInfo | null = !message || (user && message.state === "running") ? null : messageStates[message.state];
  return (
    <article className={`${s.message} ${user ? s.user : s.assistant}`}>
      {!user && <span className={s.avatar} aria-hidden><SparkIcon /></span>}
      <div className={s.body}>
        <div className={s.meta}>
          <span className={s.author}>{ticket !== undefined ? `Ticket ${ticket}` : user ? "You" : agent}</span>
          {message && <time dateTime={new Date(message.createdAt).toISOString()} title={dateTime(message.createdAt)}>{time(message.createdAt)}</time>}
          {state && <StateLabel info={state} />}
        </div>
        {working && !message && <div className={s.thinking} role="status" aria-label={`The ${agent} is working on a reply`}><span /><span /><span /></div>}
        {message?.text && ticket === undefined && <div className={s.bubble}>
          <ReactMarkdown skipHtml disallowedElements={["img"]} components={{
            a: ({ href, children }) => connected && href?.startsWith("https://")
              ? <a href={href} target="_blank" rel="noreferrer">{children}</a>
              : <span>{children}</span>,
          }}>{message.text}</ReactMarkdown>
        </div>}
        {attachments.length > 0 && <ul className={s.chips} aria-label="Message attachments">
          {attachments.map(({ id, mime, size }) => <li className={s.chip} key={id} title={`${size} bytes`}>{mime} · {fileSize(size)}</li>)}
        </ul>}
        <ErrorText error={message?.error} />
        {message?.state === "interrupted" && <div><Button size="sm" disabled={!connected || retry.busy} loading={retry.busy} onClick={() => void retry.run()}>Retry</Button></div>}
        <ErrorText error={retry.error} />
        <Actions actions={actions} connected={connected} />
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

function Composer({ supportsImages, connected, ready, reload, autoFocus }: {
  supportsImages: ChatDetail["supportsImages"];
  connected: boolean;
  ready: boolean;
  reload(): void;
  autoFocus?: boolean;
}) {
  const [message, setMessage] = useState<string>("");
  const [images, setImages] = useState<SelectedImage[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const nextKey = useRef<number>(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const { api, agent } = useContext(ChatContext);
  const send = useAction(async () => {
    const attachmentIds: string[] = [];
    for (const image of images) {
      let attachmentId: string | undefined = image.attachmentId;
      if (!attachmentId) {
        const data: string = await base64(image.file);
        const attachment: ChatAttachmentView = await api.upload({ mime: image.mime, data });
        attachmentId = attachment.id;
        setImages((pending) => pending.map((entry) => entry.key === image.key ? { ...entry, attachmentId: attachment.id } : entry));
      }
      attachmentIds.push(attachmentId);
    }
    await api.send({ text: message, attachmentIds });
    setMessage("");
    setImages([]);
    setImageError(null);
    input.current?.focus();
    reload();
  });
  const disabled: boolean = !connected || send.busy;
  const canSend: boolean = !disabled && ready && (!!message.trim() || images.length > 0) && (images.length === 0 || supportsImages === true);
  const imageReason: string = supportsImages === true ? "Add images: PNG, JPEG, GIF or WebP, up to 10 MB each"
    : supportsImages === false ? `The current ${agent} cannot read images` : `Checking whether the ${agent} can read images…`;

  function addImages(files: File[]): void {
    const selected: SelectedImage[] = [];
    const invalid: string[] = [];
    for (const file of files) {
      const mime = ChatImageMime.safeParse(file.type);
      if (!mime.success || file.size === 0 || file.size > chatAttachmentMaxBytes) invalid.push(file.name);
      else selected.push({ key: nextKey.current++, file, mime: mime.data });
    }
    setImages((pending) => [...pending, ...selected]);
    setImageError(invalid.length ? `Could not attach ${invalid.join(", ")}. Choose PNG, JPEG, GIF or WebP images up to 10 MB each.` : null);
  }

  return (
    <div className={s.composerWrap}>
      <form className={s.composer} onSubmit={(event) => {
        event.preventDefault();
        if (canSend) void send.run();
      }}>
        {images.length > 0 && <ul className={s.chips} aria-label="Selected images">
          {images.map(({ key, file }) => <li key={key} className={s.thumb}>
            <Thumbnail file={file} />
            <IconButton size="sm" className={s.thumbRemove} label={`Remove ${file.name}`} icon={<XIcon />} disabled={disabled} onClick={() => setImages((pending) => pending.filter((image) => image.key !== key))} />
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
            const files: File[] = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
            if (!files.length) return;
            event.preventDefault();
            if (disabled) return;
            if (supportsImages !== true) setImageError(imageReason);
            else addImages(files.map((file, index) => new File([file], `Pasted image ${nextKey.current + index + 1}.${file.type.slice(6)}`, { type: file.type })));
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
            aria-label="Attach images"
            accept={ChatImageMime.options.join(",")}
            disabled={disabled || supportsImages !== true}
            tabIndex={-1}
            onChange={(event) => {
              addImages(Array.from(event.currentTarget.files ?? []));
              event.currentTarget.value = "";
            }}
          />
          <IconButton label={imageReason} icon={<ClipIcon />} disabled={disabled || supportsImages !== true} onClick={() => fileInput.current?.click()} />
          <span className={s.composerHint}>{send.busy ? "Sending…" : "Enter to send · Shift Enter for a new line"}</span>
          <Button type="submit" variant="primary" className={s.composerAction} aria-label="Send" disabled={!canSend} icon={send.busy ? <Spinner /> : <ArrowUpIcon bold />} />
        </div>
      </form>
      {(imageError || send.error) && <div className={s.footnote}><ErrorText error={imageError ?? send.error} /></div>}
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
  const project: string | null = chatProject(useLocation().pathname);
  return <Chat key={project ?? ""} project={project} />;
}

function Chat({ project }: { project: string | null }) {
  const role: Role = project === null ? "assistant" : "pm";
  const agent: string = project === null ? "Assistant" : "Project Manager";
  const [target] = useState<ChatTarget>(() => ({ api: chatApi(project), agent }));
  const api: ChatApi = target.api;
  const connected: boolean = useConnected();
  const settings = useData(() => call("getSettings"), [], (event) => event.type === "definition.changed" && event.path === "settings.json");
  const profileId: string | null = settings.data ? roleProfile(settings.data.value, role) : null;
  const ready: boolean | null = settings.data ? profileId !== null : null;
  const profiles = useData(() => call("getProfiles"), [], (event) => event.type === "definition.changed" && event.path === "profiles.json");
  const accounts = useData(() => call("getAccounts"), [], (event) => event.type === "definition.changed" && event.path === "accounts.json");
  const projectView = useData(() => project === null ? Promise.resolve(null) : call("getProject", { params: { id: project } }), [], (event) => event.type === "project.updated" && event.projectId === project);
  const profile = profiles.data?.value.profiles.find(({ id }) => id === profileId);
  const allAccounts = accounts.data?.value.accounts ?? [];
  const account = allAccounts.find(({ id }) => id === profile?.account);
  const projectName: string | null = project === null ? null : projectView.data?.project?.name ?? project;
  const modelParts: string[] = profile && account ? [harnessName(account, allAccounts), profile.model, profile.effort ?? "default effort"] : [];
  const model: string | null = [...projectName === null ? [] : [projectName], ...modelParts].join(" · ") || null;
  const detail = useData(() => api.get(), [], (event) => event.type === "chat.changed" && event.project === project);
  const [query, setQuery] = useSearchParams();
  const definition: string | null = query.get("definition");
  const [active, setActive] = useState<boolean>(() => document.visibilityState === "visible" && document.hasFocus());
  const history = useRef<HTMLDivElement>(null);
  const followHistory = useRef<boolean>(true);
  const marked = useRef<string | null>(null);
  const chat: ChatDetail | undefined = detail.data;
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
    <ChatContext.Provider value={target}>
    <aside className={s.panel} aria-label={agent}><section className={s.pane}>
      <div className={s.toolbar} role="group" aria-label="Conversation controls">
        <div className={s.heading}>
          <h2 className={s.title}>{agent}</h2>
          {model && <span className={s.model}>{model}</span>}
        </div>
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
        <div className={s.thread}>
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
        </div>
      </div>
      {ready === false && connected && (
        <div className={s.footnote}>
          <Alert tone="warning" title={`No ${agent} yet`} actions={<Link to={settingUrl(role)}>Choose one in Settings</Link>}>
            Log in to Claude Code, Codex or OpenCode and &lt;PE/CORE&gt; picks one for you.
          </Alert>
        </div>
      )}
      {chat && <Composer connected={connected} ready={ready === true && !clear.busy} supportsImages={chat.supportsImages} reload={detail.reload} autoFocus={project === null} />}
      {definition && <DefinitionPreview key={definition} path={definition} onClose={() => setQuery({}, { replace: true })} />}
    </section></aside>
    </ChatContext.Provider>
  );
}
