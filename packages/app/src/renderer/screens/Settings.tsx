import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { appName, atlassianAccount, BuiltInHarness, codeCommitProfile, ForgeAccount, ForgeDiscovery, ForgeKind, forgeHost, forgeServices, harnessColor, harnesses, linearAccount, modelOnlyHarness, nextForgeAccountId, Settings as SettingsSchema } from "@pecore/schemas";
import type { ServiceAccount } from "@pecore/schemas";
import type { Account, BuiltInHarness as BuiltInHarnessId, HarnessInfo, LiveMessage, RouteResult, Settings as SettingsValue } from "@pecore/schemas";
import { call } from "../api/client";
import { useAction, useAutoSave, useData } from "../api/hooks";
import { useConnected, useLive } from "../api/live";
import { ErrorText, Page, ui } from "../components/ui";
import { useViewState } from "../components/useViewState";
import { harnessName } from "../components/AgentFields";
import { Button } from "../ds/button";
import { Switch } from "../ds/choice";
import { Alert, Badge, Card } from "../ds/feedback";
import { PasswordField, TextField } from "../ds/field";
import { CheckCircleIcon, AlertIcon, EyeIcon, EyeOffIcon, PlusIcon, RefreshIcon } from "../ds/icons";
import { Dialog } from "../ds/overlay";
import { Select } from "../ds/select";
import { NumberField, Segmented } from "../ds/values";
import { SidebarItem, SidebarSection } from "../shell/sidebar";
import { builtInThemes, themePrefs } from "../theme/themes";
import type { ThemePrefs } from "../theme/themes";
import { settingUrl } from "./NodeEditor";
import s from "./Settings.module.css";

type Snapshot<T> = { value: T; sha256: string };
type LoginProgress = Extract<LiveMessage, { type: "login.progress" }>;
type Progress = { lines: string[]; url: string | null; done: boolean };
type ExtraAccountRow = { key: string; name: string; detail?: ReactNode; state: string; checking?: boolean; actions?: ReactNode; children?: ReactNode };
type RowOverride = { detail?: ReactNode; state?: string };

const sections: { id: string; title: string }[] = [
  { id: "you", title: "You" },
  { id: "accounts", title: "Accounts" },
  { id: "projects", title: "Projects" },
  { id: "limits", title: "Limits" },
  { id: "protectedMode", title: "Protected mode" },
  { id: "appearance", title: "Appearance" },
  { id: "prerequisites", title: "Diagnostics" },
];

function useGlobalFile<T>(name: string, get: () => Promise<Snapshot<T>>, put: (body: { value: T; baseSha256: string }) => Promise<{ sha256: string }>, valid?: (value: T) => boolean) {
  const remote = useData(get, [], (message) => (message.type === "definition.changed" && message.path === name + ".json")
    || (message.type === "configuration.changed" && message.kind === name));
  return {
    ...useAutoSave(remote, put, valid),
    loadError: remote.error,
    loading: remote.loading,
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
      <PasswordField label="Login code" disabled={!connected || send.busy} value={code} onValueChange={setCode} />
      <Button type="submit" size="sm" disabled={!connected || send.busy || !code.trim()}>Send code</Button>
    </form>}
    <ErrorText error={send.error} />
  </>;
}

const stateText: Record<string, string> = { logged_in: "Logged in", logged_out: "Logged out", not_installed: "Not installed", no_models: "No models", error: "Error", unknown: "Unknown", unchecked: "Checking…", coming_soon: "Coming soon" };

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

function ComingSoonTools() {
  return <ul className={s.rows} aria-label="Coming soon">
    {harnesses.filter(({ supported }) => !supported).map((harness) => (
      <AccountRow key={harness.id} name={harness.name} detail="Not supported yet." state="coming_soon" checking={false} color={harnessColor(harness.id)} muted actions={null} />
    ))}
  </ul>;
}

function AccountRow({ name, detail, state, checking, actions, color, muted, children }: { name: string; detail?: ReactNode; state: string; checking: boolean; actions: ReactNode; color?: string; muted?: boolean; children?: ReactNode }) {
  return <li className={[s.row, muted ? s.rowMuted : ""].join(" ")}>
    <div className={s.rowMain}>
      <span className={[s.avatar, color ? s.harnessAvatar : ""].join(" ")} style={color ? { "--harness": color } as CSSProperties : undefined} aria-hidden>{initials(name)}</span>
      <div className={s.rowText}>
        <span className={s.rowTitle}>{name}</span>
        {detail && <span className={s.rowDetail}>{detail}</span>}
      </div>
      <div className={s.rowActions}>{actions}{stateBadge(state, checking)}</div>
    </div>
    {children && <div className={s.rowExtra}>{children}</div>}
  </li>;
}

function DiscoveringProviders({ providers }: { providers: { id: string; name: string }[] }) {
  if (!providers.length) return null;
  return <ul className={s.rows} aria-label="Checking for accounts">
    {providers.map(({ id, name }) => <AccountRow key={id} name={name} state="unchecked" checking actions={null} />)}
  </ul>;
}

function LoginControls({ title, actions, children, accounts, protectedOnly = false, kind = "model", hideMissing = false, pendingLogin, onLoginStarted, onEdit, extra, rowOverrides, refresh, pendingTracker, onPendingDismiss }: {
  title?: string; actions?: ReactNode; children?: ReactNode;
  accounts: Account[]; protectedOnly?: boolean; kind?: "model" | "tool"; hideMissing?: boolean;
  pendingLogin?: string; onLoginStarted?(): void; onEdit?(account: ForgeAccount): void; extra?: ExtraAccountRow[];
  rowOverrides?: Record<string, RowOverride>; refresh?(): Promise<unknown> | void;
  pendingTracker?: { account: ServiceAccount; loginId: string }; onPendingDismiss?(): void;
}) {
  const connected: boolean = useConnected();
  const logins = useData(() => kind === "model" ? call("listLogins") : Promise.resolve([]), [kind],
    (message) => kind === "model" && ((message.type === "login.progress" && message.done) || (message.type === "configuration.changed" && ["settings", "accounts"].includes(message.kind))));
  const setup = useData(() => kind === "model" ? call("getSetup") : Promise.resolve(null), [kind],
    (message) => kind === "model" && ((message.type === "login.progress" && message.done)
      || (message.type === "configuration.changed" && message.kind === "accounts")
      || message.type === "accounts.discovery_changed"));
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [setupRuns, setSetupRuns] = useState<Record<string, string>>({});
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
      const loginId: string = `tool:${account.id}`;
      checkedRuns.current.delete(loginId);
      setProgress((old) => ({ ...old, [loginId]: { lines: [], url: null, done: false } }));
      const result = await call("startAccountLogin", { params: { id: account.id } });
      setToolRuns((old) => ({ ...old, [account.id]: result.loginId }));
    }
    logins.reload();
  });
  const startSetup = useAction(async (connector: BuiltInHarnessId) => {
    const result = await call("startSetupLogin", { params: { connector } });
    setSetupRuns((old) => ({ ...old, [connector]: result.loginId }));
    setProgress((old) => old[result.loginId] ? old : { ...old, [result.loginId]: { lines: [], url: null, done: false } });
  });
  useEffect(() => {
    if (!pendingLogin || !connected) return;
    const account: Account | undefined = accounts.find(({ id }) => id === pendingLogin);
    if (!account) return;
    onLoginStarted?.();
    void start.run(account);
  }, [accounts, connected, pendingLogin]);
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
  const missingHarnesses: HarnessInfo[] = kind === "model" && !protectedOnly
    ? harnesses.filter((harness) => harness.supported && !visible.some((account) => account.kind === "model" && account.connector === harness.id))
    : [];
  const shownMissing: HarnessInfo[] = hideMissing ? [] : missingHarnesses;
  const modelLogins = (logins.data ?? []).filter((login) => (login.osUser === "pecore-agent") === protectedOnly
    && visible.some((account) => account.kind === "model" && account.id === login.account));
  const loginRunning = (id: string, running: boolean = false): boolean => progress[id] ? !progress[id].done : running;
  useEffect(() => {
    if (!connected) return;
    const due: [string, boolean][] = [];
    for (const account of visible) if (account.kind === "forge") due.push([account.id, false]);
    for (const login of modelLogins) if (login.state === "unchecked" && !loginRunning(login.id, login.running)) due.push([login.id, true]);
    for (const [id, isModel] of due) {
      if (autoChecked.current.has(id)) continue;
      autoChecked.current.add(id);
      void recheck.run(id, isModel);
    }
  }, [connected, logins.data, visible.map(({ id }) => id).join(",")]);
  const locked: boolean = !connected || start.busy || startSetup.busy;
  const targets: [id: string, isModel: boolean][] = kind === "model"
    ? modelLogins.filter((login) => !loginRunning(login.id, login.running)).map((login) => [login.id, true])
    : visible.filter(({ id }) => !loginRunning(toolRuns[id] ?? `tool:${id}`)).map(({ id }) => [id, false]);
  const available: [string, boolean][] = targets.filter(([id]) => !checking.has(id));
  const checkPanel = useAction(async () => {
    await Promise.all([...available.map(([id, isModel]) => recheck.run(id, isModel)), ...(refresh ? [refresh()] : [])]);
  });
  const checkButton: ReactNode = <Button size="sm" icon={<RefreshIcon />} loading={checkPanel.busy}
    disabled={locked || checkPanel.busy || (!available.length && !refresh)} onClick={() => void checkPanel.run()}>Check</Button>;
  const rows: ReactNode = <>
    <ErrorText error={start.error ?? startSetup.error ?? recheck.error ?? logins.error ?? setup.error} />
    {protectedOnly && !visible.length && <p className={s.groupText}>No AI tools yet.</p>}
    {!!(visible.length || extra?.length || shownMissing.length || pendingTracker) && <ul className={s.rows}>
      {pendingTracker && (() => {
        const pendingProgress: Progress | undefined = progress[pendingTracker.loginId];
        return <AccountRow key={`pending:${pendingTracker.loginId}`} name={pendingTracker.account.service} detail={pendingProgress?.done ? "Sign-in finished." : "Signing in…"}
          state={pendingProgress?.done ? "logged_out" : "unchecked"} checking={!pendingProgress?.done}
          actions={pendingProgress?.done ? <Button size="sm" variant="ghost" onClick={onPendingDismiss}>Dismiss</Button> : null}>
          {pendingProgress && <LoginOutput id={pendingTracker.loginId} progress={pendingProgress} running={false} />}
        </AccountRow>;
      })()}
      {visible.map((account) => {
        if (account.kind === "model") {
          const name: string = harnessName(account, accounts);
          const harness: HarnessInfo = harnesses.find(({ id }) => id === account.connector) ?? { id: account.connector, name, color: harnessColor(account.connector), supported: true };
          const color: string = harnessColor(harness.id);
          const items = modelLogins.filter((login) => login.account === account.id);
          if (!items.length && !logins.loading && hideMissing) return null;
          if (!items.length) return <AccountRow key={account.id} name={name} color={color} detail={logins.loading ? "Loading…" : "No login found."} state="unknown" checking={logins.loading} actions={null} />;
          return items.map((login) => {
            const current: Progress | undefined = progress[login.id];
            const running: boolean = loginRunning(login.id, login.running);
            const state: string = modelOnlyHarness(login.connector) && login.state === "unknown" ? "no_models" : login.state;
            const detail: string = login.email
              ? login.email + (login.plan ? " · " + login.plan : "")
              : state === "no_models" ? `Open ${name} and set up a model provider, then check again.`
              : state === "logged_out" && login.defaultDir ? `Log in with ${name} on this computer, then check again.` : protectedOnly ? "As pecore-agent" : "";
            return <AccountRow key={login.id} name={name} color={color} detail={detail} state={state} checking={checking.has(login.id)} actions={
              !login.defaultDir && login.state !== "logged_in" && <Button size="sm" variant="primary" disabled={locked || running} onClick={() => void start.run(account, login.osUser, login.id)}>Log in</Button>
            }>
              {(current || running) && <LoginOutput id={login.id} progress={current} running={running} />}
            </AccountRow>;
          });
        }
        const id: string | undefined = toolRuns[account.id];
        const output: Progress | undefined = id ? progress[id] : undefined;
        const busy: boolean = !!id && !output?.done;
        const override: RowOverride | undefined = rowOverrides?.[account.id];
        const state: string = override?.state ?? toolStates[account.id] ?? (autoChecked.current.has(account.id) && !checking.has(account.id) ? "unknown" : "unchecked");
        return <AccountRow key={account.id}
          name={account.kind === "forge" ? [forgeServices[account.forge].label, account.user].filter(Boolean).join(" · ") : account.tool === "atlassian" ? "Jira" : account.service}
          detail={override?.detail ?? (account.kind === "forge"
            ? account.forge === "codecommit" ? `${account.host} · ${codeCommitProfile(account)}` : account.host
            : account.tool === "atlassian" ? account.site ?? "" : account.user)}
          state={state} checking={checking.has(account.id)}
          actions={<>
            {(account.tool === "gh" || account.tool === "glab" || account.tool === "atlassian" || account.tool === "linear") && state !== "logged_in" &&
              <Button size="sm" variant="primary" disabled={locked || busy} onClick={() => void start.run(account)}>Log in</Button>}
            {account.kind === "forge" && onEdit && <Button size="sm" variant="ghost" disabled={locked || busy} onClick={() => onEdit(account)}>Edit</Button>}
          </>}>
          {id && <LoginOutput id={id} progress={output} running={!output?.done && account.tool !== "atlassian" && account.tool !== "linear"} />}
        </AccountRow>;
      })}
      {shownMissing.map((harness) => {
        const state = setup.data?.harnesses.find((item) => item.connector === harness.id);
        const loading: boolean = setup.loading || !setup.data;
        const installed: boolean = state?.installed ?? false;
        const loggedIn: boolean = state?.loggedIn ?? false;
        const label: string = loading ? "unchecked" : !installed ? "not_installed" : modelOnlyHarness(harness.id) ? "no_models" : "logged_out";
        const detail: string = loading ? "Loading…" : !installed ? `Install ${harness.name}, then check again.`
          : modelOnlyHarness(harness.id) ? `Log in or set up a model provider in ${harness.name}, then check again.`
          : `Log in with ${harness.name}, then check again.`;
        const id: string | undefined = setupRuns[harness.id];
        const current: Progress | undefined = id ? progress[id] : undefined;
        const running: boolean = !!id && !current?.done;
        return <AccountRow key={`harness:${harness.id}`} name={harness.name} color={harnessColor(harness.id)}
          detail={detail} state={label} checking={loading} actions={
            !loading && installed && !loggedIn && <Button size="sm" variant="primary" disabled={locked || running} onClick={() => void startSetup.run(harness.id as BuiltInHarnessId)}>Log in</Button>
          }>
          {id && <LoginOutput id={id} progress={current} running={running} />}
        </AccountRow>;
      })}
      {extra?.map((row) => <AccountRow key={row.key} name={row.name} detail={row.detail} state={row.state} checking={row.checking ?? false} actions={row.actions}>
        {row.children}
      </AccountRow>)}
    </ul>}
    {children}
  </>;
  if (title) return <Card title={title} actions={<div className={s.panelActions}>{actions}{checkButton}</div>}>{rows}</Card>;
  return <>{visible.length > 0 && <div className={s.sectionActions}>{checkButton}</div>}{rows}</>;
}

function ForgeAccountDialog({ account, onClose, onSave, taken }: { account?: ForgeAccount; onClose(): void; onSave(account: ForgeAccount): Promise<boolean>; taken: string[] }) {
  const [forge, setForge] = useState<ForgeKind>(account?.forge ?? "github");
  const [host, setHost] = useState(account?.host ?? "");
  const [user, setUser] = useState(account?.user ?? "");
  const [profile, setProfile] = useState(account?.forge === "codecommit" ? codeCommitProfile(account) : "default");
  const [name, setName] = useState(account?.author.name);
  const [email, setEmail] = useState(account?.author.email);
  const defaults = useData(() => account ? Promise.resolve(undefined) : call("getForgeAccountDefaults", { query: {} }), []);
  const base = forgeServices[forge];
  const awsProfile: string | undefined = forge === "codecommit" ? profile.trim() : undefined;
  const server: string = host.trim() ? forgeHost(host) : base.host;
  const author: ForgeAccount["author"] = { name: (name ?? defaults.data?.author.name ?? "").trim(), email: (email ?? defaults.data?.author.email ?? "").trim() };
  const valid: boolean = (forge === "codecommit" ? !!awsProfile : !!server) && (!author.email || /^[^@\s]+@[^@\s]+$/.test(author.email));
  const save = useAction(async () => {
    const identity = awsProfile && !server ? (await call("getForgeAccountDefaults", { query: { awsProfile } })).codeCommit : null;
    const resolved: string = server || identity?.host || "";
    if (!resolved) throw new Error("Configure a region for this AWS profile in the AWS CLI, then try again.");
    const id: string = account?.id ?? nextForgeAccountId(base.tool, awsProfile ?? resolved, new Set(taken));
    const parsed: ForgeAccount = ForgeAccount.parse({ id, kind: "forge", forge, host: resolved, tool: base.tool, user: account ? user.trim() : identity?.user ?? "", ...(awsProfile && { awsProfile }), author });
    if (await onSave(parsed)) onClose();
    else throw new Error("The account could not be saved. Review the account settings and try again.");
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !save.busy && onClose()}
      title={account ? "Edit Git hosting account" : "Add a Git hosting account"}
      description={forge === "git" ? "Uses your configured Git credentials." : forge === "codecommit" ? "Uses the selected AWS CLI profile." : account ? undefined : "Sign in with the forge tool after adding the account."}
      width={480}
      footer={<>
        <Button disabled={save.busy} onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={save.busy} disabled={!valid || save.busy || defaults.loading} onClick={() => void save.run()}>{account ? "Save" : "Add account"}</Button>
      </>}
    >
      <Select label="Service" value={forge} disabled={save.busy} onValueChange={(v) => {
        const next: ForgeKind | undefined = ForgeKind.safeParse(v).data;
        if (next && next !== forge) { setForge(next); setHost(""); setUser(""); }
      }} options={Object.entries(forgeServices).map(([value, { label }]) => ({ value, label }))} />
      {(forge !== "codecommit" || account) && <TextField label="Server" disabled={save.busy} value={host} onValueChange={setHost}
        required={forge === "git"} placeholder={base.host || (forge === "git" ? "git.example.com" : undefined)} mono />}
      {forge === "codecommit" && <TextField label="AWS profile" disabled={save.busy} value={profile} onValueChange={setProfile} required mono />}
      {account && <TextField label="Username" disabled={save.busy} value={user} onValueChange={setUser} />}
      <div className={s.pair}>
        <TextField label="Commit author name" disabled={save.busy} value={name ?? defaults.data?.author.name ?? ""} onValueChange={setName} />
        <TextField label="Commit author email" disabled={save.busy} value={email ?? defaults.data?.author.email ?? ""} onValueChange={setEmail} type="email" />
      </div>
      <ErrorText error={save.error ?? defaults.error} />
    </Dialog>
  );
}

function TrackerAccountDialog({ accounts, busy, error, onClose, onAdd }: {
  accounts: ServiceAccount[]; busy: boolean; error: string | null; onClose(): void; onAdd(account: ServiceAccount): void;
}) {
  const [selected, setSelected] = useState(accounts[0]?.id ?? "");
  const account: ServiceAccount | undefined = accounts.find(({ id }) => id === selected) ?? accounts[0];
  return <Dialog open onOpenChange={(open) => !open && !busy && onClose()} title="Add a tracker account"
    description="Sign in through your browser. The account is added after a successful sign-in." width={420}
    footer={<>
      <Button disabled={busy} onClick={onClose}>Cancel</Button>
      <Button variant="primary" loading={busy} disabled={busy || !account} onClick={() => account && onAdd(account)}>Add account</Button>
    </>}>
    {accounts.length
      ? <Select label="Tracker" value={account?.id ?? ""} disabled={busy} onValueChange={(value) => value && setSelected(value)}
          options={accounts.map((entry) => ({ value: entry.id, label: entry.tool === "atlassian" ? "Jira" : entry.service }))} />
      : <p className={s.groupText}>All trackers are already added.</p>}
    <ErrorText error={error} />
  </Dialog>;
}

export function Settings() {
  const connected: boolean = useConnected();
  const { search } = useLocation();
  const settings = useGlobalFile("settings", () => call("getSettings"), (body) => call("putSettings", { body }), (value) => SettingsSchema.safeParse(value).success);
  const accounts = useGlobalFile("accounts", () => call("getAccounts"), (body) => call("putAccounts", { body }));
  const discovery = useData(() => call("getAccountDiscovery"), [], (message) => message.type === "accounts.discovery_changed");
  const jira = useData(() => call("getActiveJira"), []);
  const status = useData(() => call("getStatus"), []);
  const [checks, setChecks] = useViewState<RouteResult<"checkPrerequisites"> | undefined>("settings.checks", undefined);
  const [disableDialog, setDisableDialog] = useState(false);
  const [forgeDialog, setForgeDialog] = useState<ForgeAccount | "new">();
  const [trackerDialog, setTrackerDialog] = useState(false);
  const [pendingLogin, setPendingLogin] = useState<string>();
  const [trackerLogin, setTrackerLogin] = useState<{ account: ServiceAccount; loginId: string }>();
  const trackerAccounts: ServiceAccount[] = (accounts.current?.accounts ?? []).filter((account): account is ServiceAccount => account.kind === "service");
  const jiraAccount: ServiceAccount | undefined = trackerAccounts.find(({ tool }) => tool === "atlassian");
  const trackerChoices: ServiceAccount[] = [atlassianAccount, linearAccount].filter((account) => !trackerAccounts.some(({ tool }) => tool === account.tool));
  const trackerRows: Record<string, RowOverride> | undefined = jiraAccount && jira.data
    ? { [jiraAccount.id]: { detail: jiraAccount.site ?? jira.data.site, state: "logged_in" } }
    : undefined;
  const addTracker = useAction(async (account: ServiceAccount) => {
    const server: "atlassian" | "linear" = account.tool === "linear" ? "linear" : "atlassian";
    const result = await call("startTrackerLogin", { params: { server } });
    setTrackerLogin({ account, loginId: result.loginId });
  });
  useEffect(() => {
    if (!trackerLogin) return;
    if (accounts.current?.accounts.some((account) => account.kind === "service" && account.tool === trackerLogin.account.tool)) setTrackerLogin(undefined);
  }, [accounts.current, trackerLogin]);
  const sectionId = new URLSearchParams(search).get("section");
  const [showUnavailable, setShowUnavailable] = useViewState("settings.showUnavailable", false);
  const [active, setActive] = useViewState("settings.active", sections.find(({ id }) => id === sectionId)?.id ?? sections[0]!.id);
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
  const prefs: ThemePrefs = themePrefs(value?.ui);
  const pendingHarnesses = BuiltInHarness.options.filter((id) => discovery.data?.includes(id)
    && !accounts.current?.accounts.some((account) => account.kind === "model" && account.connector === id))
    .flatMap((id) => harnesses.filter((harness) => harness.id === id));
  const pendingForges = ForgeDiscovery.options.filter((id) => discovery.data?.includes(id)).map((id) => ({ id, name: forgeServices[id].label }));

  const go = (id: string): void => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  return <Page title="Settings" width={820} scrollTo={sectionId} scrollReady={!settings.loading && !accounts.loading}>
    <SidebarSection title="Settings" label="Settings sections">
      {sections.map((section) => <SidebarItem key={section.id} active={active === section.id} onClick={() => go(section.id)}>{section.title}</SidebarItem>)}
    </SidebarSection>
    <div>
      <div className={s.content}>
        {value && <Section id="you" title="You" description="How the Assistant and the Project Managers call you.">
          <TextField label="Your name" value={value.user.name ?? ""} disabled={!connected}            onValueChange={(name) => update({ ...value, user: { name: name.trim() ? name : null } })} />
        </Section>}
        <Section id="accounts" title="Accounts" description={`The AI tools and the code hosting accounts ${appName} works with.`} plain>
          <ErrorText error={accounts.error ?? accounts.loadError ?? discovery.error} />
          <div className={s.groups}>
            <LoginControls title="AI tools" accounts={accounts.current?.accounts ?? []} hideMissing={!showUnavailable}
              actions={<Button size="sm" icon={showUnavailable ? <EyeOffIcon /> : <EyeIcon />} aria-pressed={showUnavailable}
                onClick={() => setShowUnavailable(!showUnavailable)}>{showUnavailable ? "Hide unavailable" : "Show unavailable"}</Button>}>
              {!showUnavailable && !accounts.current?.accounts.some(({ kind }) => kind === "model") && !pendingHarnesses.length && accounts.current && discovery.data &&
                <p className={s.groupText}>No AI tools yet. The ones you log in to on this computer show up here on their own.</p>}
              {!showUnavailable && <DiscoveringProviders providers={pendingHarnesses} />}
              {showUnavailable && <ComingSoonTools />}
            </LoginControls>
            <LoginControls title="Git hosting" accounts={accounts.current?.accounts.filter(({ kind }) => kind === "forge") ?? []} kind="tool" pendingLogin={pendingLogin}
              onLoginStarted={() => setPendingLogin(undefined)} onEdit={setForgeDialog}
              actions={<Button size="sm" icon={<PlusIcon />} disabled={!connected || !accounts.value || accounts.saving} onClick={() => setForgeDialog("new")}>Add account</Button>}>
              {!accounts.current?.accounts.some(({ kind }) => kind === "forge") && !pendingForges.length && accounts.current && discovery.data &&
                <p className={s.groupText}>Add an account, on a public service or on your own server, to push branches and open pull requests.</p>}
              <DiscoveringProviders providers={pendingForges} />
            </LoginControls>
            <LoginControls title="Trackers" accounts={trackerAccounts} kind="tool" pendingTracker={trackerLogin}
              onPendingDismiss={() => setTrackerLogin(undefined)} refresh={() => jira.reload()} rowOverrides={trackerRows}
              extra={!jiraAccount && jira.data ? [{
                key: "active-jira", name: "Jira", detail: `${jira.data.account.user} · ${jira.data.site}`, state: "logged_in",
              }] : []}
              actions={<Button size="sm" icon={<PlusIcon />} disabled={!connected || !accounts.value || accounts.saving || !trackerChoices.length}
                onClick={() => setTrackerDialog(true)}>Add account</Button>}>
              <ErrorText error={jira.error} />
              {!trackerAccounts.length && !jira.data && accounts.current && !jira.loading &&
                <p className={s.groupText}>Add an account to search and read tickets in Jira or Linear.</p>}
            </LoginControls>
          </div>
        </Section>
        {forgeDialog && <ForgeAccountDialog account={forgeDialog === "new" ? undefined : forgeDialog} onClose={() => setForgeDialog(undefined)}
          taken={(accounts.value?.accounts ?? []).map(({ id }) => id)} onSave={async (account) => {
            if (!accounts.value) return false;
            const next: Account[] = forgeDialog === "new" ? [...accounts.value.accounts, account] : accounts.value.accounts.map((entry) => entry.id === account.id ? account : entry);
            if (!await accounts.commit({ accounts: next })) return false;
            if (forgeDialog === "new" && (account.tool === "gh" || account.tool === "glab")) setPendingLogin(account.id);
            accounts.reload();
            return true;
          }} />}
        {trackerDialog && <TrackerAccountDialog accounts={trackerChoices} busy={addTracker.busy} error={addTracker.error}
          onClose={() => { setTrackerDialog(false); addTracker.clear(); }}
          onAdd={(account) => { void addTracker.run(account).then((ok) => ok && setTrackerDialog(false)); }} />}

        <ErrorText error={settings.loadError} />
        {value && <>

          <Section id="projects" title="Projects" description="Where the code of new projects goes.">
            <TextField label="Projects folder" mono value={value.projectsFolder} disabled={!connected}
              description="A new project's folder starts as this folder plus the project name."
              onValueChange={(projectsFolder) => update({ ...value, projectsFolder })}
              action={<Button disabled={!connected} onClick={() => void window.pecore.pickFolder().then((picked) => picked && update({ ...value, projectsFolder: picked }))}>Choose…</Button>} />
          </Section>

          <Section id="limits" title="Limits" description={`How much ${appName} runs at the same time.`}>
            <div className={s.grid}>
              <NumberField label="Concurrent jobs" value={value.limits.jobs} min={1} onValueChange={(jobs) => update({ ...value, limits: { ...value.limits, jobs } })} description="Blank for automatic." />
              <NumberField label="Concurrent agents" value={value.limits.agents} min={1} onValueChange={(agents) => update({ ...value, limits: { ...value.limits, agents: agents ?? 0 } })} />
              <NumberField label="Minimum free disk" unit="GB" value={value.minFreeDiskGb} min={0} step={0.5} onValueChange={(gb) => update({ ...value, minFreeDiskGb: gb ?? 0 })} />
            </div>
            <div className={s.grid} id="mergeCheckSec">
              <NumberField label="Seconds" value={value.mergeCheckSec} min={1} onValueChange={(seconds) => update({ ...value, mergeCheckSec: seconds ?? 0 })} description={`How often ${appName} checks whether a pull request was merged.`} />
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

          <Section id="appearance" title="Appearance" description={`The look of ${appName} in light and dark mode.`}>
            <div className={ui.stack}>
              <span className={s.label}>Mode</span>
              <Segmented label="Mode" value={prefs.mode}
                onValueChange={(mode) => update({ ...value, ui: { ...value.ui, mode, theme: prefs.theme } })}
                options={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
              <Select label="Theme" value={prefs.theme}
                onValueChange={(theme) => theme && update({ ...value, ui: { ...value.ui, theme } })}
                options={builtInThemes} />
            </div>
          </Section>
        </>}

        <Section id="prerequisites" title="Diagnostics" description={`Checks that the tools ${appName} needs are installed and that your ${appName} data folder is private to you.`}>
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
              {status.data?.homeFindings.length === 0 && <span className={s.dataFolder}><CheckCircleIcon className={s.ok} />Only you can read your {appName} data folder.</span>}
              {status.data?.homeFindings.map((finding) => <Alert key={finding.path} tone="warning" title={finding.path + " can be read by other users."}><pre className={s.log}>{finding.fix.join(" ")}</pre></Alert>)}
            </div>
          </div>
        </Section>
      </div>
    </div>
    {(problems || settings.error) && <div className={s.problems} role="alert">
      <Issues issues={problems} />
      <ErrorText error={settings.error} />
    </div>}
  </Page>;
}
