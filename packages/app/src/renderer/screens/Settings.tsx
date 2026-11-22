import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { ApiError, assistantTraits, forgeHost, incompatibleTraits, Settings as SettingsSchema } from "@pecore/schemas";
import type { Account, AssistantTraitId, BuiltInHarness, ForgeAccount, LiveMessage, Role, RouteResult, Settings as SettingsValue } from "@pecore/schemas";
import { call } from "../api/client";
import { errorText, useAction, useData } from "../api/hooks";
import { useConnected, useLive } from "../api/live";
import { ErrorText, Field, Page, ui } from "../components/ui";
import { Button, IconButton } from "../ds/button";
import { Switch } from "../ds/choice";
import { Alert, Badge, Card, Spinner } from "../ds/feedback";
import { TextField } from "../ds/field";
import { CheckCircleIcon, AlertIcon, PlusIcon, RefreshIcon } from "../ds/icons";
import { Dialog, Tooltip } from "../ds/overlay";
import { Combobox, Select } from "../ds/select";
import { NumberField, Segmented } from "../ds/values";
import { install } from "../shell/SetupBanner";
import { SidebarItem, SidebarSection } from "../shell/sidebar";
import { builtInThemes, themePrefs } from "../theme/themes";
import type { ThemePrefs } from "../theme/themes";
import { DefinitionErrors, settingUrl } from "./NodeEditor";
import s from "./Settings.module.css";

type Snapshot<T> = { value: T; sha256: string };
type LoginProgress = Extract<LiveMessage, { type: "login.progress" }>;
type Progress = { lines: string[]; url: string | null; done: boolean };

const roleProfiles: Record<Role, string> = { assistant: "assistant", pm: "background" };
const roleTitles: Record<Role, string> = { assistant: "Assistant", pm: "Project Manager" };
const sameValue = "same";

const sections: { id: string; title: string }[] = [
  { id: "you", title: "You" },
  { id: "accounts", title: "Accounts" },
  { id: "assistant", title: "Assistant" },
  { id: "pm", title: "Project Manager" },
  { id: "projects", title: "Projects" },
  { id: "limits", title: "Limits" },
  { id: "protectedMode", title: "Protected mode" },
  { id: "appearance", title: "Appearance" },
  { id: "prerequisites", title: "Diagnostics" },
];

const saveDelayMs = 600;

function useGlobalFile<T>(name: string, get: () => Promise<Snapshot<T>>, put: (body: { value: T; baseSha256: string }) => Promise<{ sha256: string }>, valid: (value: T) => boolean = () => true) {
  const remote = useData(get, [], (message) => message.type === "definition.changed" && message.path === name + ".json");
  const [local, setLocal] = useState<T>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown: T | undefined = local ?? remote.data?.value;
  const latest = useRef<T | undefined>(shown);
  latest.current = shown;
  const sha = useRef<string | undefined>(undefined);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const inFlight = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const waiting = useRef<T | undefined>(undefined);
  useEffect(() => {
    if (!remote.data || inFlight.current || remote.data.sha256 === sha.current) return;
    const first: boolean = sha.current === undefined;
    sha.current = remote.data.sha256;
    if (first) return;
    setLocal(undefined);
  }, [remote.data]);
  const commit = (value: T): Promise<boolean> => {
    inFlight.current += 1;
    setSaving(true);
    const write: Promise<boolean> = writes.current.then(async () => {
      try {
        const result = await put({ value, baseSha256: sha.current ?? "" });
        sha.current = result.sha256;
        setError(null);
        return true;
      } catch (failure) {
        if (failure instanceof ApiError && failure.status === 409) {
          sha.current = undefined;
          setLocal(undefined);
          remote.reload();
          setError("Changed elsewhere, so <PE/CORE> loaded the new version. Make your last change again.");
        } else setError(errorText(failure));
        return false;
      } finally {
        inFlight.current -= 1;
        if (!inFlight.current) setSaving(false);
      }
    });
    writes.current = write;
    return write;
  };
  const flush = (): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = undefined;
    const value: T | undefined = waiting.current;
    waiting.current = undefined;
    if (value !== undefined && valid(value)) void commit(value);
  };
  const flushOnLeave = useRef(flush);
  flushOnLeave.current = flush;
  useEffect(() => () => flushOnLeave.current(), []);
  return {
    value: shown, current: remote.data?.value, reload: remote.reload, saving, commit, error,
    update(change: T | ((value: T) => T)): void {
      if (latest.current === undefined) return;
      const value: T = typeof change === "function" ? (change as (value: T) => T)(latest.current) : change;
      latest.current = value;
      setLocal(value);
      waiting.current = value;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, saveDelayMs);
    },
    feedback: <>
      {remote.loading && !remote.data && <Spinner />}
      <ErrorText error={remote.error} />
    </>,
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

const stateText: Record<string, string> = { logged_in: "Logged in", logged_out: "Logged out", no_models: "No models", error: "Error", unknown: "Unknown", unchecked: "Checking…" };

function stateBadge(state: string, checking: boolean): ReactNode {
  if (checking || state === "unchecked") return <Badge>Checking…</Badge>;
  const text: string = stateText[state] ?? state;
  if (state === "logged_in") return <Badge tone="success" dot>{text}</Badge>;
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

export function harnessName(account: Account, all: Account[]): string {
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
            const state: string = login.connector === "opencode" && checked === "unknown" ? "no_models" : checked;
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
        const state: string = toolStates[account.id] ?? (autoChecked.current.has(account.id) && !checking.has(account.id) ? "unknown" : "unchecked");
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
      description={forge === "git" ? "<PE/CORE> uses your configured Git credentials to push branches." : "<PE/CORE> uses it to push branches and open pull requests. You log in right after adding it."}
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

function ModelPicker({ accounts, choice, onChoice, disabled, same = false }: { accounts: Account[]; choice: ModelChoice | null; onChoice(choice: ModelChoice | null): void; disabled: boolean; same?: boolean }) {
  const account: string = choice?.account ?? "";
  const model: string = choice?.model ?? "";
  const options = useData(() => account ? call("accountOptions", { params: { id: account }, query: {} }) : Promise.resolve(null), [account]);
  const offered = useData(() => account && model ? call("accountOptions", { params: { id: account }, query: { model } }) : Promise.resolve(null), [account, model]);
  const refresh = useAction(async () => {
    await call("refreshAccountOptions", { params: { id: account } });
    options.reload();
    offered.reload();
  });
  const models: string[] = [...new Set([...(options.data?.models ?? []), ...(model ? [model] : [])])];
  const efforts: string[] = [...new Set([...(offered.data?.efforts ?? []).filter((effort) => effort !== "default"), ...(choice?.effort ? [choice.effort] : [])])];
  const loading: boolean = !!account && (options.loading || refresh.busy);
  const readingEfforts: boolean = !!model && (offered.loading || refresh.busy);
  const current: Account | undefined = accounts.find(({ id }) => id === account);
  return <div className={s.grid}>
    <Select label="Provider" value={account || (same ? sameValue : null)} disabled={disabled} placeholder="Choose a provider"
      onValueChange={(next) => {
        if (next === sameValue) onChoice(null);
        else if (next && next !== account) onChoice({ account: next, model: "", effort: null });
      }}
      options={[...same ? [{ value: sameValue, label: "Same as the Assistant" }] : [], ...accounts.map((item) => ({ value: item.id, label: harnessName(item, accounts) }))]} />
    <div className={s.withButton}>
      {loading
        ? <TextField label="Model" leading={<Spinner />} value="" placeholder={`Reading models from ${current ? harnessName(current, accounts) : account}…`} readOnly />
        : <Combobox label="Model" value={choice?.model || null} disabled={disabled || !account} placeholder="Choose a model"
          onValueChange={(next) => { if (choice && next && next !== model) onChoice({ ...choice, model: next, effort: null }); }}
          options={models.map((model) => ({ value: model, label: model }))} />}
      <IconButton label="Read the models again" icon={<RefreshIcon />} disabled={disabled || !account || loading} onClick={() => void refresh.run()} />
    </div>
    {loading || readingEfforts
      ? <TextField label="Effort" leading={<Spinner />} value="" placeholder="Reading…" readOnly />
      : <Select label="Effort" value={choice?.effort ?? "default"} disabled={disabled || !choice?.model}
        onValueChange={(effort) => { if (choice) onChoice({ ...choice, effort: !effort || effort === "default" ? null : effort }); }}
        options={[{ value: "default", label: "Default" }, ...efforts.map((effort) => ({ value: effort, label: effort }))]} />}
  </div>;
}

function Traits({ value, disabled, onChange }: { value: AssistantTraitId[]; disabled: boolean; onChange(traits: AssistantTraitId[]): void }) {
  return (
    <div className={s.nested}>
      <span className={s.label}>Personality</span>
      <p className={s.groupText}>Traits that shape how the Assistant talks. Traits that do not go together cannot be picked at the same time.</p>
      <div className={s.traits} role="group" aria-label="Personality">
        {assistantTraits.map(({ id, label, description }) => {
          const on: boolean = value.includes(id);
          const blocked: string[] = on ? [] : incompatibleTraits[id].filter((other) => value.includes(other)).map((other) => assistantTraits.find((trait) => trait.id === other)!.label);
          return (
            <Tooltip key={id} delay={0} side="top" content={blocked.length ? `${description} Does not go with ${blocked.join(" or ")}.` : description}>
              <button type="button" className={s.trait} aria-pressed={on} aria-disabled={disabled || blocked.length > 0}
                onClick={() => { if (!disabled && !blocked.length) onChange(on ? value.filter((trait) => trait !== id) : [...value, id]); }}>
                {label}
              </button>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

export function Settings() {
  const connected: boolean = useConnected();
  const { search } = useLocation();
  const settings = useGlobalFile("settings", () => call("getSettings"), (body) => call("putSettings", { body }), (value) => SettingsSchema.safeParse(value).success);
  const accounts = useGlobalFile("accounts", () => call("getAccounts"), (body) => call("putAccounts", { body }));
  const profiles = useData(() => call("getProfiles"), [], (message) => message.type === "definition.changed" && message.path === "profiles.json");
  const status = useData(() => call("getStatus"), []);
  const themes = useData(() => call("listThemes"), [], (message) => message.type === "definition.changed" && message.path.startsWith("themes/"));
  const [checks, setChecks] = useState<RouteResult<"checkPrerequisites">>();
  const [disableDialog, setDisableDialog] = useState(false);
  const [addForge, setAddForge] = useState(false);
  const [active, setActive] = useState<string>(sections[0]!.id);
  const actualProtected: boolean = settings.current?.protectedMode ?? false;
  const check = useAction(async () => setChecks(await call("checkPrerequisites")));
  const protect = useAction(async (on: boolean, removeUser: boolean = false) => {
    await call("setProtectedMode", { body: { on, removeUser } });
    setDisableDialog(false);
    settings.reload();
    status.reload();
  });
  const value: SettingsValue | undefined = settings.value;
  const problems = value ? SettingsSchema.safeParse(value).error?.issues : undefined;
  const update = settings.update;
  const [choices, setChoices] = useState<Partial<Record<Role, ModelChoice | null>>>({});
  const profileChoice = (id: string | null | undefined): ModelChoice | null => {
    const profile = profiles.data?.value.profiles.find((entry) => entry.id === id);
    return profile ? { account: profile.account, model: profile.model, effort: profile.effort } : null;
  };
  const shown = (role: Role): ModelChoice | null => role in choices ? choices[role] ?? null : profileChoice(settings.current?.[role].profile);
  const profileWrites = useRef<Promise<unknown>>(Promise.resolve());
  const saveChoice = useAction(async (role: Role, choice: ModelChoice) => {
    const id: string = roleProfiles[role];
    const write: Promise<unknown> = profileWrites.current.then(async () => {
      const file = await call("getProfiles");
      await call("putProfiles", { body: { value: { ...file.value, profiles: [...file.value.profiles.filter((profile) => profile.id !== id), { id, ...choice }] }, baseSha256: file.sha256 } });
    });
    profileWrites.current = write.catch(() => undefined);
    await write;
    update((old) => old[role].profile === id ? old : { ...old, [role]: { ...old[role], profile: id } });
  });
  const choose = (role: Role, choice: ModelChoice | null): void => {
    setChoices((old) => ({ ...old, [role]: choice }));
    if (!choice) update((old) => ({ ...old, [role]: { ...old[role], profile: null } }));
    else if (choice.model) void saveChoice.run(role, choice);
  };
  const roleSection = (role: Role, description: string): ReactNode => value &&
    <Section id={role} title={roleTitles[role]} description={description}>
      <ModelPicker accounts={(accounts.current?.accounts ?? []).filter(({ kind }) => kind === "model")} disabled={!connected || !profiles.data}
        same={role === "pm"} choice={shown(role)} onChoice={(choice) => choose(role, choice)} />
      <div className={s.grid}>
        <NumberField label="Compact when idle above" unit="tokens" value={value[role].compaction.auto} min={1} step={1000}
          onValueChange={(auto) => update({ ...value, [role]: { ...value[role], compaction: { ...value[role].compaction, auto: auto ?? 0 } } })} description="After 5 minutes without messages." />
        <NumberField label="Compact at once above" unit="tokens" value={value[role].compaction.max} min={1} step={1000}
          onValueChange={(max) => update({ ...value, [role]: { ...value[role], compaction: { ...value[role].compaction, max: max ?? 0 } } })} />
      </div>
      {role === "assistant" && <Traits value={value.assistant.traits} disabled={!connected}
        onChange={(traits) => update({ ...value, assistant: { ...value.assistant, traits } })} />}
    </Section>;
  const prefs: ThemePrefs = themePrefs(value?.ui);

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
        {value && <Section id="you" title="You" description="How the Assistant and the Project Managers call you.">
          <TextField label="Your name" value={value.user.name ?? ""} disabled={!connected}
            description="Leave it empty and the Assistant asks for it."
            onValueChange={(name) => update({ ...value, user: { name: name.trim() ? name : null } })} />
        </Section>}
        <Section id="accounts" title="Accounts" description="The AI tools and the code hosting accounts &lt;PE/CORE&gt; works with." plain>
          {accounts.feedback}
          <ErrorText error={accounts.error} />
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
          {roleSection("assistant", "The model you talk with in the chat.")}
          {roleSection("pm", "The model that plans jobs for new tickets in the background.")}

          <Section id="projects" title="Projects" description="Where the code of new projects goes.">
            <TextField label="Projects folder" mono value={value.projectsFolder} disabled={!connected}
              description="A new project's folder starts as this folder plus the project name."
              onValueChange={(projectsFolder) => update({ ...value, projectsFolder })}
              action={<Button disabled={!connected} onClick={() => void window.pecore.pickFolder().then((picked) => picked && update({ ...value, projectsFolder: picked }))}>Choose…</Button>} />
          </Section>

          <Section id="limits" title="Limits" description="How much &lt;PE/CORE&gt; runs at the same time.">
            <div className={s.grid}>
              <NumberField label="Concurrent jobs" value={value.limits.jobs} min={1} onValueChange={(jobs) => update({ ...value, limits: { ...value.limits, jobs } })} description="Blank for automatic." />
              <NumberField label="Concurrent agents" value={value.limits.agents} min={1} onValueChange={(agents) => update({ ...value, limits: { ...value.limits, agents: agents ?? 0 } })} />
              <NumberField label="Minimum free disk" unit="GB" value={value.minFreeDiskGb} min={0} step={0.5} onValueChange={(gb) => update({ ...value, minFreeDiskGb: gb ?? 0 })} />
            </div>
            <div className={s.grid} id="mergeCheckSec">
              <NumberField label="Seconds" value={value.mergeCheckSec} min={1} onValueChange={(seconds) => update({ ...value, mergeCheckSec: seconds ?? 0 })} description="How often &lt;PE/CORE&gt; checks whether a pull request was merged." />
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

          <Section id="appearance" title="Appearance" description="The look of &lt;PE/CORE&gt; in light and dark mode.">
            <div className={ui.stack}>
              <span className={s.label}>Mode</span>
              <Segmented accent label="Mode" value={prefs.mode}
                onValueChange={(mode) => update({ ...value, ui: { ...value.ui, mode, theme: prefs.theme } })}
                options={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
              <Select label="Theme" value={prefs.theme}
                onValueChange={(theme) => theme && update({ ...value, ui: { ...value.ui, theme } })}
                options={[...builtInThemes, ...(themes.data ?? []).flatMap((item) => item.theme ? [{ value: item.file, label: item.theme.name }] : [])]} />
              <ErrorText error={themes.error} />
              {themes.data?.filter((item) => item.errors.length).map((item) => <div key={item.file}><strong>{item.file}</strong><DefinitionErrors errors={item.errors} /></div>)}
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
    {(problems || settings.error || saveChoice.error) && <div className={s.problems} role="alert">
      <Issues issues={problems} />
      <ErrorText error={settings.error ?? saveChoice.error} />
    </div>}
  </Page>;
}
