import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { ApiError, forgeHost, Settings as SettingsSchema } from "@pecore/schemas";
import type { Account, BuiltInHarness, ForgeAccount, LiveMessage, RouteResult, Settings as SettingsValue } from "@pecore/schemas";
import { call } from "../api/client";
import { useAction, useData } from "../api/hooks";
import { useConnected, useLive } from "../api/live";
import { ErrorText, Field, Page, ui } from "../components/ui";
import { Button } from "../ds/button";
import { Switch } from "../ds/choice";
import { Alert, Badge, Card, Spinner } from "../ds/feedback";
import { TextArea, TextField } from "../ds/field";
import { CheckCircleIcon, AlertIcon, PlusIcon, RefreshIcon } from "../ds/icons";
import { Dialog } from "../ds/overlay";
import { Combobox, Select } from "../ds/select";
import { NumberField, Segmented } from "../ds/values";
import { install } from "../shell/SetupBanner";
import { SidebarItem, SidebarSection } from "../shell/sidebar";
import { themeChoice } from "../theme/ThemeLoader";
import { DefinitionErrors, settingUrl, useDefinitionDraft, useUnsaved } from "./NodeEditor";
import s from "./Settings.module.css";

type Snapshot<T> = { value: T; sha256: string };
type LoginProgress = Extract<LiveMessage, { type: "login.progress" }>;
type Progress = { lines: string[]; url: string | null; done: boolean };

const orchestratorProfile = "orchestrator";

const sections: { id: string; title: string }[] = [
  { id: "accounts", title: "Accounts" },
  { id: "orchestrator", title: "Orchestrator" },
  { id: "limits", title: "Limits" },
  { id: "protectedMode", title: "Protected mode" },
  { id: "notifications", title: "Notifications" },
  { id: "appearance", title: "Appearance" },
  { id: "advanced", title: "Advanced" },
  { id: "prerequisites", title: "Diagnostics" },
];

function useGlobalFile<T>(name: string, get: () => Promise<Snapshot<T>>, put: (body: { value: T; baseSha256: string }) => Promise<{ sha256: string }>) {
  const connected: boolean = useConnected();
  const remote = useData(get, [], (message) => message.type === "definition.changed" && message.path === name + ".json");
  const [draft, setDraft] = useState<Snapshot<T>>();
  const [saved, setSaved] = useState<Snapshot<T>>();
  const [revision, setRevision] = useState(0);
  const snapshot: Snapshot<T> | undefined = draft ?? saved ?? remote.data;
  useEffect(() => { setSaved(undefined); }, [remote.data]);
  const save = useAction(async (value: T) => {
    if (!snapshot) return;
    try {
      const result = await put({ value, baseSha256: snapshot.sha256 });
      setSaved({ value, sha256: result.sha256 });
      setDraft(undefined);
      remote.reload();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setDraft(snapshot);
        remote.reload();
        throw new Error("409: Changed elsewhere. Copy any edits you want to keep, then reload.", { cause: error });
      }
      if (error instanceof ApiError && error.status === 400) throw new Error("400: " + error.message, { cause: error });
      throw error;
    }
  });
  const discard = (): void => {
    setDraft(undefined);
    setSaved(undefined);
    setRevision((value) => value + 1);
    save.clear();
    remote.reload();
  };
  return {
    value: snapshot?.value, current: remote.data?.value, editKey: (snapshot?.sha256 ?? "") + ":" + revision, reload: remote.reload, saving: save.busy,
    dirty: draft !== undefined, discard, commit: (value: T): Promise<boolean> => save.run(value),
    update(value: T): void { if (snapshot) setDraft({ ...snapshot, value }); },
    feedback: <>
      {remote.loading && !remote.data && <Spinner />}
      <ErrorText error={save.error ?? remote.error} />
    </>,
    button(label: string, invalid = false): ReactNode {
      return <Button variant="primary" loading={save.busy} disabled={!connected || !draft || invalid} onClick={() => { if (draft) void save.run(draft.value); }}>{label}</Button>;
    },
  };
}

function Section({ id, title, description, plain, children }: { id: string; title: string; description?: ReactNode; plain?: boolean; children: ReactNode }) {
  return (
    <section id={id} className={s.section}>
      <h2 className={s.sectionTitle}>{title}</h2>
      {description && <p className={s.sectionText}>{description}</p>}
      {plain ? children : <Card padded>{children}</Card>}
    </section>
  );
}

function JsonField({ label, value, onValue, onInvalid }: { label: string; value: unknown; onValue(value: unknown): void; onInvalid(invalid: boolean): void }) {
  const [text, setText] = useState<string>();
  const [invalid, setInvalid] = useState(false);
  return <TextArea label={label} mono value={text ?? JSON.stringify(value, null, 2)} error={invalid ? "Invalid JSON." : undefined} onValueChange={(next) => {
    setText(next);
    let parsed: unknown;
    try { parsed = JSON.parse(next); }
    catch { setInvalid(true); onInvalid(true); return; }
    setInvalid(false);
    onInvalid(false);
    onValue(parsed);
  }} />;
}

function Issues({ issues }: { issues: { path: PropertyKey[]; message: string }[] | undefined }) {
  return <>{issues?.map((issue, index) => <ErrorText key={index} error={issue.path.join(".") + ": " + issue.message} />)}</>;
}

function LoginOutput({ id, progress, running }: { id: string; progress?: Progress; running: boolean }) {
  const connected: boolean = useConnected();
  const [code, setCode] = useState("");
  const send = useAction(async () => {
    await call("loginCode", { params: { id }, body: { code: code.trim() } });
    setCode("");
  });
  const url: string | undefined = progress?.url && progress.url.startsWith("https://") ? progress.url : undefined;
  return <>
    {url && connected && <a href={url} target="_blank" rel="noreferrer">Open login URL</a>}
    {!!progress?.lines.length && <pre className={s.log} aria-label="Login progress">{progress.lines.join("\n")}</pre>}
    {running && <form className={ui.row} onSubmit={(event) => { event.preventDefault(); if (connected && !send.busy && code.trim()) void send.run(); }}>
      <Field label="Login code"><input type="password" autoComplete="off" disabled={!connected || send.busy} value={code} onChange={(event) => setCode(event.target.value)} /></Field>
      <Button type="submit" size="sm" disabled={!connected || send.busy || !code.trim()}>Send code</Button>
    </form>}
    <ErrorText error={send.error} />
  </>;
}

const stateText: Record<string, string> = { logged_in: "Logged in", ready: "Ready", logged_out: "Logged out", no_models: "No models", error: "Error", unknown: "Unknown", unchecked: "Checking…" };

function stateBadge(state: string, checking: boolean): ReactNode {
  if (checking || state === "unchecked") return <Badge>Checking…</Badge>;
  const text: string = stateText[state] ?? state;
  if (state === "logged_in" || state === "ready") return <Badge tone="success" dot>{text}</Badge>;
  if (state === "logged_out" || state === "error" || state === "no_models") return <Badge tone="danger" dot>{text}</Badge>;
  return <Badge>{text}</Badge>;
}

function initials(name: string): string {
  return name.split(/[\s·-]+/).filter(Boolean).slice(0, 2).map((word) => word[0]!.toUpperCase()).join("");
}

function AccountRow({ name, detail, state, checking, actions, children }: { name: string; detail?: ReactNode; state: string; checking: boolean; actions: ReactNode; children?: ReactNode }) {
  return <li className={s.row}>
    <div className={s.rowMain}>
      <span className={s.avatar} aria-hidden>{initials(name)}</span>
      <div className={s.rowText}>
        <span className={s.rowTitle}>{name}</span>
        {detail && <span className={s.rowDetail}>{detail}</span>}
      </div>
      {stateBadge(state, checking)}
      <div className={s.rowActions}>{actions}</div>
    </div>
    {children && <div className={s.rowExtra}>{children}</div>}
  </li>;
}

function harnessName(account: Account, all: Account[]): string {
  if (account.kind !== "model") return account.id;
  const name: string = install[account.connector as BuiltInHarness]?.name ?? account.connector;
  return all.filter((other) => other.kind === "model" && other.connector === account.connector).length > 1 ? `${name} · ${account.id}` : name;
}

function LoginControls({ accounts, protectedOnly = false, kind = "model" }: { accounts: Account[]; protectedOnly?: boolean; kind?: "model" | "tool" }) {
  const connected: boolean = useConnected();
  const logins = useData(() => call("listLogins"), [], (message) => (message.type === "login.progress" && message.done) || (message.type === "definition.changed" && ["settings.json", "accounts.json"].includes(message.path)));
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [toolRuns, setToolRuns] = useState<Record<string, string>>({});
  const [toolStates, setToolStates] = useState<Record<string, string>>({});
  const [checking, setChecking] = useState<Set<string>>(new Set());
  const checkedRuns = useRef<Set<string>>(new Set());
  const autoChecked = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const [account, loginId] of Object.entries(toolRuns)) {
      if (!progress[loginId]?.done || checkedRuns.current.has(loginId)) continue;
      checkedRuns.current.add(loginId);
      void call("recheckAccount", { params: { id: account } }).then(({ state }) => setToolStates((old) => ({ ...old, [account]: state })), () => undefined);
    }
  }, [progress, toolRuns]);
  useLive((message): void => {
    if (message.type !== "login.progress") return;
    const event: LoginProgress = message;
    setProgress((previous) => {
      const old: Progress | undefined = previous[event.loginId];
      return { ...previous, [event.loginId]: {
        lines: [...(old?.done ? [] : old?.lines ?? []), event.text].slice(-200),
        url: (old?.done ? null : old?.url) ?? event.url,
        done: event.done,
      } };
    });
  }, []);
  const start = useAction(async (account: Account, osUser?: string, loginId?: string) => {
    if (account.kind === "model" && osUser && loginId) {
      setProgress((old) => ({ ...old, [loginId]: { lines: [], url: null, done: false } }));
      try { await call("startLogin", { body: { account: account.id, osUser } }); }
      catch (error) { setProgress((old) => ({ ...old, [loginId]: { lines: [], url: null, done: true } })); throw error; }
    } else {
      const result = await call("startAccountLogin", { params: { id: account.id } });
      setToolRuns((old) => ({ ...old, [account.id]: result.loginId }));
    }
    logins.reload();
  });
  const recheck = useAction(async (id: string, isModel: boolean) => {
    setChecking((old) => new Set(old).add(id));
    try {
      if (isModel) {
        await call("recheckLogin", { params: { id } });
        logins.reload();
      } else {
        const { state } = await call("recheckAccount", { params: { id } });
        setToolStates((old) => ({ ...old, [id]: state }));
      }
    } finally {
      setChecking((old) => { const next = new Set(old); next.delete(id); return next; });
    }
  });
  const visible = accounts.filter((account) => kind === "model" ? account.kind === "model" : account.kind !== "model" && !protectedOnly);
  useEffect(() => {
    if (!connected) return;
    const due: [string, boolean][] = [];
    for (const account of visible) {
      if (account.kind !== "model") due.push([account.id, false]);
      else for (const login of logins.data ?? []) if (login.account === account.id && login.state === "unchecked" && !login.running) due.push([login.id, true]);
    }
    for (const [id, isModel] of due) {
      if (autoChecked.current.has(id)) continue;
      autoChecked.current.add(id);
      void recheck.run(id, isModel);
    }
  }, [connected, logins.data, visible.map(({ id }) => id).join(",")]);
  const locked: boolean = !connected || start.busy;
  const checkButton = (id: string, isModel: boolean, disabled: boolean): ReactNode =>
    <Button size="sm" icon={<RefreshIcon />} loading={checking.has(id)} disabled={locked || disabled || checking.has(id)} onClick={() => void recheck.run(id, isModel)}>Check</Button>;
  return <>
    <ErrorText error={start.error ?? recheck.error ?? logins.error} />
    {protectedOnly && !visible.length && <p className={s.groupText}>No AI tools yet.</p>}
    {!!visible.length && <ul className={s.rows}>
      {visible.map((account) => {
        if (account.kind === "model") {
          const name: string = harnessName(account, accounts);
          const items = logins.data?.filter((login) => login.account === account.id && (protectedOnly ? login.osUser === "pecore-agent" : login.osUser !== "pecore-agent")) ?? [];
          if (!items.length) return <AccountRow key={account.id} name={name} detail={logins.loading ? "Loading…" : "No login found."} state="unknown" checking={logins.loading} actions={null} />;
          return items.map((login) => {
            const current: Progress | undefined = progress[login.id];
            const running: boolean = current ? !current.done : login.running;
            const checked: string = login.state === "unchecked" && autoChecked.current.has(login.id) && !checking.has(login.id) ? "unknown" : login.state;
            const noIdentity: boolean = login.connector === "opencode";
            const state: string = noIdentity && checked === "logged_in" ? "ready" : noIdentity && checked === "unknown" ? "no_models" : checked;
            const detail: string = login.email
              ? login.email + (login.plan ? " · " + login.plan : "")
              : state === "no_models" ? `Open ${name} and set up a model provider, then check again.`
              : state === "logged_out" && login.defaultDir ? `Log in with ${name} on this computer, then check again.` : protectedOnly ? "As pecore-agent" : "";
            return <AccountRow key={login.id} name={name} detail={detail} state={state} checking={checking.has(login.id)} actions={<>
              {!login.defaultDir && login.state !== "logged_in" && <Button size="sm" variant="primary" disabled={locked || running} onClick={() => void start.run(account, login.osUser, login.id)}>Log in</Button>}
              {checkButton(login.id, true, running)}
            </>}>
              {(current || running) && <LoginOutput id={login.id} progress={current} running={running} />}
            </AccountRow>;
          });
        }
        const id: string | undefined = toolRuns[account.id];
        const output: Progress | undefined = id ? progress[id] : undefined;
        const busy: boolean = !!id && !output?.done;
        const checked: string = toolStates[account.id] ?? (autoChecked.current.has(account.id) && !checking.has(account.id) ? "unknown" : "unchecked");
        const state: string = account.kind === "forge" && account.tool === "git" && checked === "logged_in" ? "ready" : checked;
        return <AccountRow key={account.id}
          name={account.kind === "forge" ? `${forgeLabel(account.forge)} · ${account.user}` : account.service}
          detail={account.kind === "forge" ? account.host : `Log in with ${account.tool}, then check again.`}
          state={state} checking={checking.has(account.id)}
          actions={<>
            {account.kind === "forge" && account.tool !== "git" && state !== "logged_in" && <Button size="sm" variant="primary" disabled={locked || busy} onClick={() => {
              if (id) setProgress((old) => { const next = { ...old }; delete next[id]; return next; });
              void start.run(account);
            }}>Log in</Button>}
            {checkButton(account.id, false, busy)}
          </>}>
          {id && <LoginOutput id={id} progress={output} running={!output?.done} />}
        </AccountRow>;
      })}
    </ul>}
  </>;
}

type SupportedForge = "github" | "gitlab" | "git";

const forges: Record<SupportedForge, { host: string; tool: ForgeAccount["tool"]; label: string }> = {
  github: { host: "github.com", tool: "gh", label: "GitHub" },
  gitlab: { host: "gitlab.com", tool: "glab", label: "GitLab" },
  git: { host: "", tool: "git", label: "Private Git server" },
};

function forgeLabel(forge: string): string {
  return forges[forge as SupportedForge]?.label ?? forge;
}

function AddForgeAccount({ open, onClose, onAdd, taken }: { open: boolean; onClose(): void; onAdd(account: ForgeAccount): void; taken: string[] }) {
  const [forge, setForge] = useState<SupportedForge>("github");
  const [host, setHost] = useState("");
  const [user, setUser] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const base: (typeof forges)[SupportedForge] = forges[forge];
  const server: string = forgeHost(host) || base.host;
  const id: string = `${base.tool}-${user || "account"}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  const valid: boolean = !!server && !!user.trim() && !!name.trim() && /^[^@\s]+@[^@\s]+$/.test(email) && !taken.includes(id);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Add a Git hosting account"
      description={forge === "git" ? "PeCore uses your configured Git credentials to push branches." : "PeCore uses it to push branches and open pull requests. You log in right after adding it."}
      width={480}
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!valid} onClick={() => {
          onAdd({ id, kind: "forge", forge, host: server, tool: base.tool, user: user.trim(), author: { name: name.trim(), email: email.trim() } });
          onClose();
        }}>Add account</Button>
      </>}
    >
      <Select label="Service" value={forge} onValueChange={(v) => { if (v) setForge(v as SupportedForge); }}
        options={Object.entries(forges).map(([value, { label }]) => ({ value, label }))} />
      <TextField label="Username" value={user} onValueChange={setUser} placeholder={`your ${base.label} username`} autoFocus />
      <TextField label="Server" value={host} onValueChange={setHost} required={forge === "git"} placeholder={base.host || "git.example.com"} description="For a company or self-hosted server, enter its address, for example git.example.com." mono />
      <div className={s.pair}>
        <TextField label="Commit author name" value={name} onValueChange={setName} />
        <TextField label="Commit author email" value={email} onValueChange={setEmail} type="email" />
      </div>
      {taken.includes(id) && <ErrorText error={`An account called ${id} already exists.`} />}
    </Dialog>
  );
}

type ModelChoice = { account: string; model: string; effort: string | null };

function OrchestratorPicker({ accounts, choice, onChoice, disabled }: { accounts: Account[]; choice: ModelChoice | null; onChoice(choice: ModelChoice): void; disabled: boolean }) {
  const account: string = choice?.account ?? "";
  const options = useData(() => account ? call("accountOptions", { params: { id: account } }) : Promise.resolve(null), [account]);
  const models: string[] = [...new Set([...(options.data?.models ?? []), ...(choice?.model ? [choice.model] : [])])];
  const efforts: string[] = [...new Set([...(options.data?.efforts ?? []).filter((effort) => effort !== "default"), ...(choice?.effort ? [choice.effort] : [])])];
  const loading: boolean = !!account && options.loading;
  return <div className={s.grid}>
    <Select label="Provider" value={account || null} disabled={disabled} placeholder="Choose a provider"
      onValueChange={(next) => { if (next && next !== account) onChoice({ account: next, model: "", effort: null }); }}
      options={accounts.map((item) => ({ value: item.id, label: harnessName(item, accounts) }))} />
    {loading
      ? <TextField label="Model" leading={<Spinner size={13} />} value="" placeholder={`Reading models from ${harnessName(accounts.find(({ id }) => id === account) ?? accounts[0]!, accounts)}…`} readOnly />
      : <Combobox label="Model" value={choice?.model || null} disabled={disabled || !account} placeholder="Choose a model"
        onValueChange={(model) => { if (choice && model) onChoice({ ...choice, model }); }}
        options={models.map((model) => ({ value: model, label: model }))} />}
    {loading
      ? <TextField label="Effort" leading={<Spinner size={13} />} value="" placeholder="Reading…" readOnly />
      : <Select label="Effort" value={choice?.effort ?? "default"} disabled={disabled || !account}
        onValueChange={(effort) => { if (choice) onChoice({ ...choice, effort: !effort || effort === "default" ? null : effort }); }}
        options={[{ value: "default", label: "Default" }, ...efforts.map((effort) => ({ value: effort, label: effort }))]} />}
  </div>;
}

function ConnectorFile({ path, close }: { path: string; close(): void }) {
  const file = useDefinitionDraft(path);
  const warn = useUnsaved(file.dirty);
  const dismiss = (): void => {
    if (!file.dirty || window.confirm("Discard your unsaved connector changes?")) close();
  };
  return <Dialog open onOpenChange={(o) => !o && dismiss()} title={path.split("/").at(-1) ?? "Connector"} width={720} footer={<>{file.saveButton}<Button disabled={!file.connected} onClick={dismiss}>Close</Button></>}>
    {file.feedback}
    {file.ready && <>
      <TextArea label="Connector JSON" mono value={file.content} disabled={!file.editable} onValueChange={(v) => file.update(v)} />
      <DefinitionErrors errors={file.errors} />
    </>}
    {warn}
  </Dialog>;
}

function Connectors() {
  const connected: boolean = useConnected();
  const [open, setOpen] = useState("");
  const connectors = useData(() => call("listDefinitions", { query: { dir: "connectors" } }), [], (message) => message.type === "definition.changed" && message.path.startsWith("connectors/"));
  return <div className={ui.stack}>
    <span className={s.label}>Connector files</span>
    <ErrorText error={connectors.error} />
    {connectors.loading && <Spinner />}
    {connectors.data?.length === 0 && <span className={ui.muted}>No custom connectors. Built-in ones cover Claude Code, Codex and OpenCode.</span>}
    {connectors.data?.map((item) => <div key={item.path}>
      <Button size="sm" disabled={!connected} onClick={() => setOpen(item.path)}>{item.path.split("/").at(-1)}</Button>
      <DefinitionErrors errors={item.errors} />
    </div>)}
    {open && <ConnectorFile key={open} path={open} close={() => setOpen("")} />}
  </div>;
}

export function Settings() {
  const connected: boolean = useConnected();
  const { search } = useLocation();
  const settings = useGlobalFile("settings", () => call("getSettings"), (body) => call("putSettings", { body }));
  const accounts = useGlobalFile("accounts", () => call("getAccounts"), (body) => call("putAccounts", { body }));
  const profiles = useData(() => call("getProfiles"), [], (message) => message.type === "definition.changed" && message.path === "profiles.json");
  const status = useData(() => call("getStatus"), []);
  const themes = useData(() => call("listThemes"), [], (message) => message.type === "definition.changed" && message.path.startsWith("themes/"));
  const [checks, setChecks] = useState<RouteResult<"checkPrerequisites">>();
  const [disableDialog, setDisableDialog] = useState(false);
  const [addForge, setAddForge] = useState(false);
  const [invalidJson, setInvalidJson] = useState<string[]>([]);
  const [active, setActive] = useState<string>(sections[0]!.id);
  const actualProtected: boolean = settings.current?.protectedMode ?? false;
  const check = useAction(async () => setChecks(await call("checkPrerequisites")));
  const protect = useAction(async (on: boolean, removeUser: boolean = false) => {
    await call("setProtectedMode", { body: { on, removeUser } });
    setDisableDialog(false);
    settings.reload();
    status.reload();
  });
  const settingsResult = SettingsSchema.safeParse(settings.value);
  const value: SettingsValue | undefined = settings.value;
  const update = settings.update;
  const [orchestrator, setOrchestrator] = useState<ModelChoice>();
  const current = profiles.data?.value.profiles.find(({ id }) => id === settings.current?.orchestrator?.profile);
  const currentOrchestrator: ModelChoice | null = current ? { account: current.account, model: current.model, effort: current.effort } : null;
  const saveAll = useAction(async () => {
    if (!value) return;
    if (orchestrator) {
      if (!orchestrator.model) throw new Error("Choose a model for the orchestrator.");
      const file = await call("getProfiles");
      const others = file.value.profiles.filter(({ id }) => id !== orchestratorProfile);
      await call("putProfiles", { body: { value: { ...file.value, profiles: [...others, { id: orchestratorProfile, ...orchestrator }] }, baseSha256: file.sha256 } });
      profiles.reload();
    }
    if (await settings.commit(value)) setOrchestrator(undefined);
  });
  const markJson = (key: string, invalid: boolean): void => {
    if (invalid && settings.value) settings.update(settings.value);
    setInvalidJson((old) => invalid ? [...new Set([...old, key])] : old.filter((item) => item !== key));
  };
  const jsonField = (key: "prices" | "projectPaths" | "programPaths", label: string): ReactNode => value &&
    <JsonField key={settings.editKey + key} label={label} value={value[key]} onValue={(data) => update({ ...value, [key]: data })} onInvalid={(invalid) => markJson(key, invalid)} />;
  const theme: string = themeChoice(value?.ui);

  useEffect(() => { setInvalidJson([]); }, [settings.editKey]);
  useEffect(() => {
    const id: string | null = new URLSearchParams(search).get("section");
    if (id) document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [search, !!settings.value, !!accounts.value]);

  const go = (id: string): void => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  return <Page title="Settings" width={820}>
    <SidebarSection title="Settings" label="Settings sections">
      {sections.map((section) => <SidebarItem key={section.id} active={active === section.id} onClick={() => go(section.id)}>{section.title}</SidebarItem>)}
    </SidebarSection>
    <div>
      <div className={s.content}>
        <Section id="accounts" title="Accounts" description="The AI tools and the code hosting accounts PeCore works with." plain>
          {accounts.feedback}
          <div className={s.groups}>
            <Card title="AI tools">
              {(accounts.current?.accounts ?? []).some(({ kind }) => kind === "model")
                ? <LoginControls accounts={accounts.current?.accounts ?? []} />
                : <p className={s.groupText}>No AI tools yet. The ones you log in to on this computer show up here on their own.</p>}
            </Card>
            <Card title="Git hosting" actions={<Button size="sm" icon={<PlusIcon />} disabled={!connected || !accounts.value || accounts.saving} onClick={() => setAddForge(true)}>Add account</Button>}>
              {(accounts.current?.accounts ?? []).some(({ kind }) => kind !== "model")
                ? <LoginControls accounts={accounts.current?.accounts ?? []} kind="tool" />
                : <p className={s.groupText}>Add an account, on a public service or on your own server, to push branches and open pull requests.</p>}
            </Card>
          </div>
        </Section>
        <AddForgeAccount open={addForge} onClose={() => setAddForge(false)} taken={(accounts.value?.accounts ?? []).map(({ id }) => id)}
          onAdd={(account) => { if (accounts.value) void accounts.commit({ ...accounts.value, accounts: [...accounts.value.accounts, account] }); }} />

        {settings.feedback}
        {value && <>
          <Section id="orchestrator" title="Orchestrator" description="The model that talks with you and plans the jobs.">
            <OrchestratorPicker accounts={(accounts.current?.accounts ?? []).filter(({ kind }) => kind === "model")} disabled={!connected || !profiles.data}
              choice={orchestrator ?? currentOrchestrator}
              onChoice={(choice) => {
                setOrchestrator(choice);
                update({ ...value, orchestrator: { profile: orchestratorProfile } });
              }} />
          </Section>

          <Section id="limits" title="Limits" description="How much PeCore runs at the same time.">
            <div className={s.grid}>
              <NumberField label="Concurrent jobs" value={value.limits.jobs} min={1} onValueChange={(jobs) => update({ ...value, limits: { ...value.limits, jobs } })} description="Blank for automatic." />
              <NumberField label="Concurrent agents" value={value.limits.agents} min={1} onValueChange={(agents) => update({ ...value, limits: { ...value.limits, agents: agents ?? 0 } })} />
              <NumberField label="Minimum free disk" unit="GB" value={value.minFreeDiskGb} min={0} step={0.5} onValueChange={(gb) => update({ ...value, minFreeDiskGb: gb ?? 0 })} />
            </div>
            <div className={s.grid} id="mergeCheckSec">
              <NumberField label="Seconds" value={value.mergeCheckSec} min={1} onValueChange={(seconds) => update({ ...value, mergeCheckSec: seconds ?? 0 })} description="How often PeCore checks whether a pull request was merged." />
              <div id="servicesRuntime">
                <Select label="Services runtime" value={value.servicesRuntime ?? "none"}
                  onValueChange={(runtime) => update({ ...value, servicesRuntime: (runtime && runtime !== "none" ? runtime : null) as SettingsValue["servicesRuntime"] })}
                  options={[{ value: "none", label: "None" }, ...["docker", "podman", "colima", "orbstack"].map((r) => ({ value: r, label: r }))]} />
              </div>
            </div>
          </Section>

          <Section id="protectedMode" title="Protected mode" description="Agents run as a separate user, so they cannot read your files or your logins.">
            <Switch label="Protected mode" detail="You log in once per AI account as pecore-agent." checked={actualProtected} disabled={!connected || protect.busy || settings.saving || !settings.current}
              onCheckedChange={(checked) => { if (checked) void protect.run(true); else setDisableDialog(true); }} />
            <ErrorText error={protect.error} />
            {actualProtected && <div className={s.nested}><LoginControls accounts={accounts.current?.accounts ?? []} protectedOnly /></div>}
          </Section>
          <Dialog open={disableDialog} onOpenChange={(o) => { if (!o && !protect.busy) setDisableDialog(false); }} title="Turn off protected mode" description="Also remove the pecore-agent user?" width={420}
            footer={<>
              <Button disabled={!connected || protect.busy} onClick={() => void protect.run(false)}>Keep user</Button>
              <Button variant="dangerSolid" disabled={!connected || protect.busy} onClick={() => void protect.run(false, true)}>Remove user</Button>
            </>}>
            <ErrorText error={protect.error} />
          </Dialog>

          <Section id="notifications" title="Notifications" description="Quiet hours hold system notifications; they stay in the bell.">
            <Switch label="Quiet hours" checked={value.quietHours !== null} onCheckedChange={(checked) => update({ ...value, quietHours: checked ? { from: "22:00", to: "08:00" } : null })} />
            {value.quietHours && <div className={s.grid}>
              {(["from", "to"] as const).map((key) => <Field key={key} label={key === "from" ? "From" : "To"}><input type="time" value={value.quietHours?.[key]} onChange={(event) => { if (value.quietHours) update({ ...value, quietHours: { ...value.quietHours, [key]: event.target.value } }); }} /></Field>)}
            </div>}
          </Section>

          <Section id="appearance" title="Appearance">
            <div className={ui.stack}>
              <span className={s.label}>Theme</span>
              <Segmented label="Theme" value={theme.startsWith("builtin:") ? theme : "custom"}
                onValueChange={(choice) => { if (choice !== "custom") update({ ...value, ui: { ...value.ui, theme: choice } }); }}
                options={[
                  { value: "builtin:system", label: "System" },
                  { value: "builtin:light", label: "Light" },
                  { value: "builtin:dark", label: "Dark" },
                  ...(themes.data?.length ? [{ value: "custom", label: "Custom" }] : []),
                ]} />
              {!!themes.data?.length && <Select label="Custom theme" value={theme.startsWith("builtin:") ? null : theme} placeholder="Choose a theme file"
                onValueChange={(file) => file && update({ ...value, ui: { ...value.ui, theme: file } })}
                options={themes.data.map((item) => ({ value: item.file, label: item.theme?.name ?? item.file, disabled: !item.theme }))} />}
              <ErrorText error={themes.error} />
              {themes.data?.filter((item) => item.errors.length).map((item) => <div key={item.file}><strong>{item.file}</strong><DefinitionErrors errors={item.errors} /></div>)}
            </div>
          </Section>

          <Section id="advanced" title="Advanced" description="Rarely needed. Each field takes JSON.">
            <div className={ui.stack}>
              <div id="providers"><JsonField key={settings.editKey + "providers"} label="Concurrent agents by provider" value={value.limits.providers}
                onValue={(data) => update({ ...value, limits: { ...value.limits, providers: data as SettingsValue["limits"]["providers"] } })} onInvalid={(invalid) => markJson("providers", invalid)} /></div>
              <div id="prices">{jsonField("prices", "Prices by model")}</div>
              <div id="projectPaths">{jsonField("projectPaths", "Paths by project")}</div>
              <div id="programPaths">{jsonField("programPaths", "Absolute paths by tool")}</div>
              <div className={s.divider} />
              <Connectors />
            </div>
          </Section>
        </>}

        <Section id="prerequisites" title="Diagnostics">
          <div className={ui.stack}>
            <div className={s.sectionActions} style={{ justifyContent: "flex-start" }}>
              <Button loading={check.busy} disabled={!connected} onClick={() => void check.run()}>Recheck prerequisites</Button>
              <Button disabled={!connected || status.loading} onClick={status.reload}>Recheck permissions</Button>
            </div>
            <ErrorText error={check.error ?? status.error} />
            {checks && <ul className={s.checks}>{checks.map((item) => <li key={item.tool}>
              {item.ok ? <CheckCircleIcon className={s.ok} /> : <AlertIcon className={s.bad} />}
              <span><strong>{item.tool}</strong>{item.version && " " + item.version} · {item.ok ? "Ready" : item.problem ?? "Check failed"}</span>
              {item.setting && connected && <Link to={settingUrl(item.setting)}>Open setting</Link>}
            </li>)}</ul>}
            <div id="home">
              {status.data?.homeFindings.length === 0 && <span className={ui.muted}>PECORE_HOME permissions are fine.</span>}
              {status.data?.homeFindings.map((finding) => <Alert key={finding.path} tone="warning" title={finding.path + " can be read by other users."}><pre className={s.log}>{finding.fix.join(" ")}</pre></Alert>)}
            </div>
          </div>
        </Section>
      </div>
    </div>
    {settings.dirty && <div className={s.saveBar} role="region" aria-label="Unsaved settings">
      <span>You have unsaved changes.</span>
      {!!invalidJson.length && <ErrorText error="Fix invalid JSON before saving." />}
      <Issues issues={settingsResult.error?.issues} />
      <span className={s.spacer} />
      <ErrorText error={saveAll.error} />
      <Button onClick={() => { setOrchestrator(undefined); saveAll.clear(); settings.discard(); }}>Discard</Button>
      <Button variant="primary" loading={saveAll.busy || settings.saving} disabled={!connected || !settingsResult.success || !!invalidJson.length || protect.busy || (!!orchestrator && !orchestrator.model)}
        onClick={() => void saveAll.run()}>Save settings</Button>
    </div>}
  </Page>;
}
