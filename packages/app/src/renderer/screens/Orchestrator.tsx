import { ChatImageMime, chatAttachmentMaxBytes } from "@pecore/schemas";
import type { ChatActionView, ChatAttachmentView, ChatDetail, ChatMessageView, ChatView } from "@pecore/schemas";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { call } from "../api/client";
import { useAction, useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { StateLabel } from "../components/states";
import type { StateInfo } from "../components/states";
import { Button, Empty, ErrorText, Field, Modal, Page, Panel, dateTime, ui } from "../components/ui";
import { definitionUrl, object, settingUrl, string } from "./NodeEditor";
import s from "./Orchestrator.module.css";

type SelectedImage = { key: number; file: File; mime: ChatImageMime; attachmentId?: string };
type ActionLink = { to: string; label: string };

const messageStates: Record<ChatMessageView["state"], StateInfo> = {
  queued: { label: "Queued", tone: "warning", icon: "…", detail: null, pulse: false },
  running: { label: "Running", tone: "running", icon: "●", detail: null, pulse: true },
  completed: { label: "Completed", tone: "success", icon: "✓", detail: null, pulse: false },
  interrupted: { label: "Interrupted", tone: "inactive", icon: "■", detail: null, pulse: false },
  failed: { label: "Failed", tone: "failed", icon: "✕", detail: null, pulse: false },
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
    <Panel className={s.action}>
      <div className={ui.row}>
        <strong className={s.tool}>{action.tool.replaceAll("_", " ")}</strong>
        {state && <span className={ui.muted}>{state}</span>}
        {project && <span className={ui.muted}>{project}</span>}
        {ticket && <span className={ui.muted}>Ticket {ticket}</span>}
      </div>
      <ErrorText error={error} />
      {links.length > 0 && <ul className={s.links}>
        {links.map(({ to, label }) => <li key={to}>{connected ? <Link to={to}>{label}</Link> : label}</li>)}
      </ul>}
    </Panel>
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
  return (
    <article className={s.message}>
      <div className={ui.row}>
        <strong>{message.role === "user" ? manual ? "You" : "Ticket intake" : "Orchestrator"}</strong>
        <time className={ui.muted} dateTime={new Date(message.createdAt).toISOString()}>{dateTime(message.createdAt)}</time>
        <StateLabel info={messageStates[message.state]} />
      </div>
      {message.text && <div className={s.messageText}>
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
      {manual && message.state === "interrupted" && <Button disabled={!connected || retry.busy} onClick={() => void retry.run()}>Retry</Button>}
      <ErrorText error={retry.error} />
      {actions.map((action) => <ActionCard key={action.id} action={action} connected={connected} />)}
    </article>
  );
}

function Composer({ id, supportsImages, connected, ready = true, reload }: {
  id: string | null;
  supportsImages: ChatDetail["supportsImages"];
  connected: boolean;
  ready?: boolean;
  reload(chatId: string): void;
}) {
  const [message, setMessage] = useState<string>("");
  const [images, setImages] = useState<SelectedImage[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const nextKey = useRef<number>(0);
  const draftChat = useRef<string | null>(null);
  const send = useAction(async () => {
    const chatId: string = id ?? draftChat.current ?? (await call("createChat", { body: { title: "New conversation" } })).id;
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
    reload(chatId);
  });
  const disabled: boolean = !connected || send.busy;
  const canSend: boolean = !disabled && ready && (!!message.trim() || images.length > 0) && (images.length === 0 || supportsImages === true);
  const imageReason: string = supportsImages === true ? "PNG, JPEG, GIF or WebP, up to 10 MB per image."
    : supportsImages === false ? "Images are unavailable with the current orchestrator configuration."
      : "Image support could not be verified for this conversation.";

  function addImages(files: File[]): void {
    const selected: SelectedImage[] = [];
    const invalid: string[] = [];
    for (const file of files) {
      const mime = ChatImageMime.safeParse(file.type);
      if (!mime.success || file.size === 0 || file.size > chatAttachmentMaxBytes) {
        invalid.push(file.name);
      } else {
        selected.push({ key: nextKey.current++, file, mime: mime.data });
      }
    }
    setImages((pending) => [...pending, ...selected]);
    setImageError(invalid.length ? `Could not attach ${invalid.join(", ")}. Choose PNG, JPEG, GIF or WebP images up to 10 MB each.` : null);
  }

  return (
    <form className={s.composer} onSubmit={(event) => {
      event.preventDefault();
      if (canSend) void send.run();
    }}>
      <Field label="Message"><textarea rows={3} value={message} disabled={disabled} onChange={(event) => setMessage(event.target.value)} /></Field>
      {id !== null && <><Field label="Attach images">
        <input type="file" multiple accept={ChatImageMime.options.join(",")} disabled={disabled || supportsImages !== true}
          aria-describedby="orchestrator-image-support" onChange={(event) => {
            addImages(Array.from(event.currentTarget.files ?? []));
            event.currentTarget.value = "";
          }} />
      </Field>
      <div id="orchestrator-image-support" className={ui.muted}>{imageReason}</div></>}
      {images.length > 0 && <ul className={s.chips} aria-label="Selected images">
        {images.map(({ key, file }) => <li key={key} className={s.chip}>
          {file.name} · {fileSize(file.size)}
          <Button aria-label={`Remove ${file.name}`} disabled={disabled} onClick={() => setImages((pending) => pending.filter((image) => image.key !== key))}>Remove</Button>
        </li>)}
      </ul>}
      <ErrorText error={imageError} />
      <ErrorText error={send.error} />
      <div><Button type="submit" kind="primary" disabled={!canSend}>{send.busy ? "Sending…" : "Send"}</Button></div>
    </form>
  );
}

function DefinitionPreview({ path, onClose }: { path: string; onClose(): void }) {
  const file = useData(() => call("getDefinition", { params: { path } }), [path], (event) => event.type === "definition.changed" && event.path === path);
  return (
    <Modal open title={path} onClose={onClose}>
      <ErrorText error={file.error} />
      {file.loading && <Empty>Loading definition…</Empty>}
      {file.data && <pre className={s.definition}>{file.data.content}</pre>}
      <Button onClick={onClose}>Close</Button>
    </Modal>
  );
}

function Conversation({ id, connected }: { id: string; connected: boolean }) {
  const detail = useData(() => call("getChat", { params: { id } }), [id], (event) =>
    (event.type === "chat.message" || event.type === "chat.action" || event.type === "chat.updated") && event.chatId === id);
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
  const manual: boolean = chat?.chat.projectId === null;
  return (
    <Panel className={s.conversation}>
      <ErrorText error={detail.error} />
      {detail.loading && !chat && <Empty>Loading conversation…</Empty>}
      {chat && <>
        <h2 className={s.heading}>{chat.chat.title}</h2>
        {markRead.error && <div className={ui.row}>
          <ErrorText error={markRead.error} />
          <Button disabled={!connected || markRead.busy} onClick={() => void markRead.run()}>Mark as read</Button>
        </div>}
        <div ref={history} className={s.history} role="log" aria-label="Conversation messages" tabIndex={0} onScroll={(event) => {
          const pane: HTMLDivElement = event.currentTarget;
          followHistory.current = pane.scrollHeight - pane.clientHeight - pane.scrollTop <= 48;
        }}>
          {chat.messages.length === 0 && <Empty>No messages yet</Empty>}
          {chat.messages.map((message) => <Message key={message.id} message={message} connected={connected} manual={manual}
            actions={actions.get(message.id) ?? []} attachments={attachments.get(message.id) ?? []} reload={detail.reload} />)}
        </div>
        {manual
          ? <Composer id={id} connected={connected} supportsImages={chat.supportsImages} reload={detail.reload} />
          : <div className={ui.muted}>Ticket intake conversations are read-only.</div>}
      </>}
      {definition && <DefinitionPreview key={definition} path={definition} onClose={() => setQuery({}, { replace: true })} />}
    </Panel>
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
  return (
    <Page title="Orchestrator" actions={<Button kind="primary" disabled={!connected} onClick={() => setCreating(true)}>New conversation</Button>}>
      <div className={s.split}>
        <Panel className={s.conversations}>
          <h2 className={s.heading}>Conversations</h2>
          <ErrorText error={chats.error} />
          {chats.loading && !chats.data && <Empty>Loading conversations…</Empty>}
          {chats.data?.length === 0 && <Empty>No conversations yet</Empty>}
          <ul className={s.list}>
            {chats.data?.map((chat) => <li key={chat.id} className={chat.id === id ? s.selected : undefined}>
              {connected ? <Link to={conversationUrl(chat.id)} aria-current={chat.id === id ? "page" : undefined}>{chat.title}</Link> : <span>{chat.title}</span>}
              {chat.unread > 0 && <span className={s.unread}>{chat.unread} unread</span>}
            </li>)}
          </ul>
        </Panel>
        {id ? <Conversation key={id} id={id} connected={connected} /> : <Panel>
          <h2 className={s.heading}>New conversation</h2>
          {settings.data?.value.orchestrator === null && connected && <Link to={settingUrl("orchestrator")}>Choose an orchestrator profile in Settings</Link>}
          <Composer id={null} connected={connected} ready={!!settings.data?.value.orchestrator} supportsImages={null} reload={(chatId) => {
            chats.reload();
            void navigate(conversationUrl(chatId));
          }} />
        </Panel>}
      </div>
      <Modal open={creating} title="New conversation" onClose={closeCreate}>
        <form className={ui.stack} onSubmit={(event) => {
          event.preventDefault();
          if (canCreate) void create.run();
        }}>
          <Field label="Title"><input autoFocus required value={title} disabled={!connected || create.busy} onChange={(event) => setTitle(event.target.value)} /></Field>
          <ErrorText error={create.error} />
          <div className={ui.row}>
            <Button type="submit" kind="primary" disabled={!canCreate}>{create.busy ? "Creating…" : "Create conversation"}</Button>
            <Button disabled={create.busy} onClick={closeCreate}>Cancel</Button>
          </div>
        </form>
      </Modal>
    </Page>
  );
}
