import { ChatImageMime, chatAttachmentMaxBytes, chatCompactCommand } from "@pecore/schemas";
import type { ChatActionView, ChatAttachmentView, ChatDetail, ChatMessageView, ChatView } from "@pecore/schemas";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { call } from "../api/client";
import { useAction, useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { StateLabel } from "../components/states";
import type { StateInfo } from "../components/states";
import { ErrorText, dateTime, time } from "../components/ui";
import { Button, IconButton } from "../ds/button";
import { Alert, Count, EmptyState, Spinner } from "../ds/feedback";
import { TextField } from "../ds/field";
import { ArrowUpIcon, ChatIcon, ClipIcon, PlusIcon, SparkIcon, XIcon } from "../ds/icons";
import { Dialog } from "../ds/overlay";
import { SidebarItem, SidebarSection } from "../shell/sidebar";
import { definitionUrl, object, settingUrl, string } from "./NodeEditor";
import s from "./Orchestrator.module.css";

type SelectedImage = { key: number; file: File; mime: ChatImageMime; attachmentId?: string };
type ActionLink = { to: string; label: string };

const messageStates: Record<ChatMessageView["state"], StateInfo | null> = {
  queued: { label: "Queued", tone: "warning", icon: "", detail: null, pulse: false },
  running: { label: "Running", tone: "running", icon: "", detail: null, pulse: true },
  completed: null,
  interrupted: { label: "Interrupted", tone: "inactive", icon: "", detail: null, pulse: false },
  failed: { label: "Failed", tone: "failed", icon: "", detail: null, pulse: false },
};

function conversationUrl(id: string): string {
  return `/orchestrator/${encodeURIComponent(id)}`;
}

function fileSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${+(bytes / 1_000_000).toFixed(2)} MB`;
  if (bytes >= 1_000) return `${+(bytes / 1_000).toFixed(2)} kB`;
  return `${bytes} B`;
}

function base64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader: FileReader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return reject(new Error(`Could not read ${file.name}.`));
      resolve(reader.result.slice(reader.result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
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
    ...[...items].map((id) => ({ to: `/inbox/${encodeURIComponent(id)}`, label: `Inbox item ${id}` })),
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

function ActionCard({ action, connected }: { action: ChatActionView; connected: boolean }) {
  const target: Record<string, unknown> = object(action.target);
  const links: ActionLink[] = actionLinks(target);
  const state: string = string(target.state);
  const error: string = string(target.error);
  const ticket: string = string(target.ticketId);
  const project: string = string(target.project);
  return (
    <div className={s.action}>
      <div className={s.actionHead}>
        <SparkIcon size={13} />
        <span className={s.tool}>{action.tool.replaceAll("_", " ")}</span>
        {project && <span className={s.actionMeta}>{project}</span>}
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

function Message({ message, attachments, actions, connected, manual, reload }: {
  message: ChatMessageView;
  attachments: ChatAttachmentView[];
  actions: ChatActionView[];
  connected: boolean;
  manual: boolean;
  reload(): void;
}) {
  const retry = useAction(async () => {
    await call("retryChatMessage", { params: { id: message.chatId, messageId: message.id } });
    reload();
  });
  const user: boolean = message.role === "user";
  const state: StateInfo | null = messageStates[message.state];
  return (
    <article className={`${s.message} ${user ? s.user : s.assistant}`}>
      {!user && <span className={s.avatar} aria-hidden><SparkIcon size={14} /></span>}
      <div className={s.body}>
        <div className={s.meta}>
          <span className={s.author}>{user ? manual ? "You" : "Ticket intake" : "Orchestrator"}</span>
          <time dateTime={new Date(message.createdAt).toISOString()} title={dateTime(message.createdAt)}>{time(message.createdAt)}</time>
          {state && <StateLabel info={state} />}
        </div>
        {message.text && <div className={s.bubble}>
          <ReactMarkdown skipHtml disallowedElements={["img"]} components={{
            a: ({ href, children }) => connected && href?.startsWith("https://")
              ? <a href={href} target="_blank" rel="noreferrer">{children}</a>
              : <span>{children}</span>,
          }}>{message.text}</ReactMarkdown>
        </div>}
        {attachments.length > 0 && <ul className={s.chips} aria-label="Message attachments">
          {attachments.map(({ id, mime, size }) => <li className={s.chip} key={id} title={`${size} bytes`}>{mime} · {fileSize(size)}</li>)}
        </ul>}
        <ErrorText error={message.error} />
        {manual && message.state === "interrupted" && <div><Button size="sm" disabled={!connected || retry.busy} loading={retry.busy} onClick={() => void retry.run()}>Retry</Button></div>}
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
      <span className={s.compactionLabel}>{pending && <Spinner size={12} />}{label}</span>
      <ErrorText error={message.error} />
    </div>
  );
}

function Activity({ actions, connected, working }: { actions: ChatActionView[]; connected: boolean; working: boolean }) {
  return (
    <article className={`${s.message} ${s.assistant}`}>
      <span className={s.avatar} aria-hidden><SparkIcon size={14} /></span>
      <div className={s.body}>
        <div className={s.meta}><span className={s.author}>Orchestrator</span></div>
        {working && <div className={s.thinking} role="status" aria-label="The orchestrator is working on a reply"><span /><span /><span /></div>}
        <Actions actions={actions} connected={connected} />
      </div>
    </article>
  );
}

function Composer({ id, supportsImages, connected, ready = true, reload, autoFocus }: {
  id: string | null;
  supportsImages: ChatDetail["supportsImages"];
  connected: boolean;
  ready?: boolean;
  reload(chatId: string): void;
  autoFocus?: boolean;
}) {
  const [message, setMessage] = useState<string>("");
  const [images, setImages] = useState<SelectedImage[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const nextKey = useRef<number>(0);
  const draftChat = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const send = useAction(async () => {
    const title: string = message.trim().split("\n")[0]!.slice(0, 60) || "New conversation";
    const chatId: string = id ?? draftChat.current ?? (await call("createChat", { body: { title } })).id;
    if (id === null) draftChat.current = chatId;
    const attachmentIds: string[] = [];
    for (const image of images) {
      let attachmentId: string | undefined = image.attachmentId;
      if (!attachmentId) {
        const data: string = await base64(image.file);
        const attachment: ChatAttachmentView = await call("uploadChatAttachment", { params: { id: chatId }, body: { mime: image.mime, data } });
        attachmentId = attachment.id;
        setImages((pending) => pending.map((entry) => entry.key === image.key ? { ...entry, attachmentId: attachment.id } : entry));
      }
      attachmentIds.push(attachmentId);
    }
    await call("sendChatMessage", { params: { id: chatId }, body: { text: message, attachmentIds } });
    setMessage("");
    setImages([]);
    setImageError(null);
    input.current?.focus();
    reload(chatId);
  });
  const disabled: boolean = !connected || send.busy;
  const canSend: boolean = !disabled && ready && (!!message.trim() || images.length > 0) && (images.length === 0 || supportsImages === true);
  const imageReason: string = supportsImages === true ? "Add images: PNG, JPEG, GIF or WebP, up to 10 MB each"
    : supportsImages === false ? "The current orchestrator cannot read images"
      : id === null ? "Images can be added after the first message" : "Checking whether the orchestrator can read images…";

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
          {images.map(({ key, file }) => <li key={key} className={s.chip}>
            {file.name} · {fileSize(file.size)}
            <IconButton size="sm" label={`Remove ${file.name}`} icon={<XIcon size={11} />} disabled={disabled} onClick={() => setImages((pending) => pending.filter((image) => image.key !== key))} />
          </li>)}
        </ul>}
        <textarea
          ref={input}
          aria-label="Message"
          placeholder={id === null ? "Describe what you want built, in your own words…" : "Reply to the orchestrator…"}
          rows={1}
          autoFocus={autoFocus}
          value={message}
          disabled={!connected}
          readOnly={send.busy}
          onChange={(event) => setMessage(event.target.value)}
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
          <IconButton size="sm" label={imageReason} icon={<ClipIcon size={15} />} disabled={disabled || supportsImages !== true} onClick={() => fileInput.current?.click()} />
          <span className={s.composerHint}>{send.busy ? "Sending…" : "Enter to send · Shift Enter for a new line"}</span>
          <Button type="submit" variant="primary" className={s.send} aria-label="Send" disabled={!canSend} icon={send.busy ? <Spinner size={14} /> : <ArrowUpIcon size={15} strokeWidth={2.2} />} />
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

function Conversation({ id, connected }: { id: string; connected: boolean }) {
  const detail = useData(() => call("getChat", { params: { id } }), [id], (event) =>
    (event.type === "chat.message" || event.type === "chat.streaming" || event.type === "chat.action" || event.type === "chat.updated") && event.chatId === id);
  const [query, setQuery] = useSearchParams();
  const definition: string | null = query.get("definition");
  const [active, setActive] = useState<boolean>(() => document.visibilityState === "visible" && document.hasFocus());
  const history = useRef<HTMLDivElement>(null);
  const followHistory = useRef<boolean>(true);
  const marked = useRef<string | null>(null);
  const chat: ChatDetail | undefined = detail.data;
  const lastReply: string = chat?.messages.findLast((message) => message.role === "assistant")?.id ?? "";
  const markRead = useAction(async () => {
    await call("markChatRead", { params: { id } });
    detail.reload();
  });
  const compact = useAction(async () => {
    await call("sendChatMessage", { params: { id }, body: { text: chatCompactCommand, attachmentIds: [] } });
    detail.reload();
  });
  const last: ChatMessageView | undefined = chat?.messages.at(-1);
  const turnPending: boolean = last?.role === "user" && (last.state === "queued" || last.state === "running");
  const replied: Set<string> = new Set(chat?.messages.flatMap(({ replyTo }) => replyTo ? [replyTo] : []) ?? []);
  const pending: ChatMessageView | undefined = chat?.messages.find((message) => message.role === "user" && (message.state === "running" || message.state === "queued") && !isCompaction(message));
  const canCompact: boolean = connected && !compact.busy && !turnPending && !!chat?.messages.some((message) => message.state === "completed" && !isCompaction(message));

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
    if (marked.current !== null && (!chat.chat.unread || marked.current === lastReply)) return;
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
  const pendingActions: ChatActionView[] = pending ? actions.get(pending.id) ?? [] : [];
  const manual: boolean = chat?.chat.projectId === null;
  return (
    <section className={s.pane}>
      <header className={s.paneHeader}>
        <h2 className={s.paneTitle}>{chat?.chat.title ?? ""}</h2>
        {chat && !manual && <span className={s.actionMeta}>Ticket intake · read only</span>}
        {chat && manual && <Button size="sm" className={s.headerAction} disabled={!canCompact} loading={compact.busy}
          title="Summarize the conversation so far, so the orchestrator keeps its context short" onClick={() => void compact.run()}>Compact</Button>}
      </header>
      {detail.error && <div className={s.footnote}><ErrorText error={detail.error} /></div>}
      {compact.error && <div className={s.footnote}><ErrorText error={compact.error} /></div>}
      {markRead.error && <div className={s.footnote}><Alert tone="danger" actions={<Button size="sm" disabled={!connected || markRead.busy} onClick={() => void markRead.run()}>Mark as read</Button>}>{markRead.error}</Alert></div>}
      <div ref={history} className={s.history} role="log" aria-label="Conversation messages" tabIndex={0} onScroll={(event) => {
        const pane: HTMLDivElement = event.currentTarget;
        followHistory.current = pane.scrollHeight - pane.clientHeight - pane.scrollTop <= 48;
      }}>
        <div className={s.thread}>
          {detail.loading && !chat && <Spinner />}
          {chat?.messages.length === 0 && <EmptyState icon={<ChatIcon size={18} />} title="No messages yet">Tell the orchestrator what you want: it plans the work and creates the jobs.</EmptyState>}
          {chat?.messages.map((message) => {
            if (isCompaction(message)) return <Compaction key={message.id} message={message} />;
            const own: ChatActionView[] = message.role === "assistant" ? message.replyTo ? actions.get(message.replyTo) ?? [] : [] : actions.get(message.id) ?? [];
            const unanswered: boolean = message.role === "user" && !replied.has(message.id) && message.state !== "running" && message.state !== "queued" && own.length > 0;
            return <Fragment key={message.id}>
              <Message message={message} connected={connected} manual={manual}
                actions={message.role === "assistant" ? own : []} attachments={attachments.get(message.id) ?? []} reload={detail.reload} />
              {unanswered && <Activity actions={own} connected={connected} working={false} />}
            </Fragment>;
          })}
          {chat?.streamingReply && <Message message={chat.streamingReply} connected={connected} manual={manual}
            actions={pendingActions} attachments={[]} reload={detail.reload} />}
          {pending && !chat?.streamingReply && <Activity actions={pendingActions} connected={connected} working />}
        </div>
      </div>
      {chat && manual && <Composer id={id} connected={connected} supportsImages={chat.supportsImages} reload={detail.reload} autoFocus />}
      {definition && <DefinitionPreview key={definition} path={definition} onClose={() => setQuery({}, { replace: true })} />}
    </section>
  );
}

function Start({ connected, ready, onCreated }: { connected: boolean; ready: boolean | null; onCreated(chatId: string): void }) {
  return (
    <section className={s.pane}>
      <div className={s.start}>
        <div className={s.startHead}>
          <span className={s.startIcon}><SparkIcon size={22} /></span>
          <h2 className={s.startTitle}>What should PeCore build?</h2>
          <p className={s.startText}>Describe a feature, a bug or a whole project. The orchestrator plans it, creates the jobs and keeps you posted here.</p>
        </div>
        {ready === false && connected && (
          <div className={s.footnote}>
            <Alert tone="warning" title="No orchestrator yet" actions={<Link to={settingUrl("orchestrator")}>Choose one in Settings</Link>}>
              Log in to Claude Code, Codex or OpenCode and PeCore picks one for you.
            </Alert>
          </div>
        )}
        <Composer id={null} connected={connected} ready={ready === true} supportsImages={null} reload={onCreated} autoFocus />
      </div>
    </section>
  );
}

export function Orchestrator() {
  const { id } = useParams();
  const navigate: ReturnType<typeof useNavigate> = useNavigate();
  const connected: boolean = useConnected();
  const chats = useData(() => call("listChats"), [], (event) => event.type === "chat.message" || event.type === "chat.updated");
  const settings = useData(() => call("getSettings"), [], (event) => event.type === "definition.changed" && event.path === "settings.json");
  const [creating, setCreating] = useState<boolean>(false);
  const [title, setTitle] = useState<string>("");
  const create = useAction(async () => {
    const chat: ChatView = await call("createChat", { body: { title } });
    setCreating(false);
    setTitle("");
    chats.reload();
    void navigate(conversationUrl(chat.id));
  });
  const canCreate: boolean = connected && !create.busy && !!title.trim();
  function closeCreate(): void {
    if (create.busy) return;
    setCreating(false);
    setTitle("");
    create.clear();
  }
  const ready: boolean | null = settings.data ? settings.data.value.orchestrator !== null : null;
  return (
    <div className={s.root}>
      <SidebarSection title="Conversations" action={<IconButton size="sm" label="New conversation" icon={<PlusIcon />} disabled={!connected} onClick={() => setCreating(true)} />}>
        {chats.error && <li><ErrorText error={chats.error} /></li>}
        {chats.data?.length === 0 && <li className={s.actionMeta} style={{ padding: "6px 10px" }}>No conversations yet</li>}
        {chats.data?.map((chat) => <SidebarItem key={chat.id} to={connected ? conversationUrl(chat.id) : undefined} active={chat.id === id}
          trailing={<Count value={chat.unread} label={`${chat.unread} unread`} />}>{chat.title}</SidebarItem>)}
      </SidebarSection>
      {id
        ? <Conversation key={id} id={id} connected={connected} />
        : <Start connected={connected} ready={ready} onCreated={(chatId) => {
          chats.reload();
          void navigate(conversationUrl(chatId));
        }} />}
      <Dialog
        open={creating}
        onOpenChange={(open) => !open && closeCreate()}
        title="New conversation"
        width={420}
        footer={<>
          <Button disabled={create.busy} onClick={closeCreate}>Cancel</Button>
          <Button type="submit" form="new-conversation" variant="primary" disabled={!canCreate} loading={create.busy}>Create conversation</Button>
        </>}
      >
        <form id="new-conversation" onSubmit={(event) => {
          event.preventDefault();
          if (canCreate) void create.run();
        }}>
          <TextField label="Title" value={title} onValueChange={setTitle} disabled={!connected || create.busy} autoFocus placeholder="e.g. Checkout redesign" />
        </form>
        <ErrorText error={create.error} />
      </Dialog>
    </div>
  );
}
