import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { ApiError, Accounts as AccountsSchema, Profiles as ProfilesSchema, Settings as SettingsSchema, Tiers as TiersSchema } from "@pecore/schemas";
import type { Account, LiveMessage, Profile, RouteResult, Settings as SettingsValue, TierName } from "@pecore/schemas";
import { call } from "../api/client";
import { useAction, useData } from "../api/hooks";
import { useConnected, useLive } from "../api/live";
import { Button, Empty, ErrorText, Field, Modal, Page, Panel, ui } from "../components/ui";
import { themeChoice } from "../theme/ThemeLoader";
import { DefinitionErrors, settingUrl, useDefinitionDraft, useUnsaved } from "./NodeEditor";
import s from "./Editors.module.css";

type Snapshot<T> = { value: T; sha256: string };
type LoginProgress = Extract<LiveMessage, { type: "login.progress" }>;
type Progress = { lines: string[]; url: string | null; done: boolean };
type ModelOptions = RouteResult<"accountOptions">;

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
  const reset = (): void => {
    if (!window.confirm("Discard your edits and reload this file?")) return;
    setDraft(undefined);
    setSaved(undefined);
    setRevision((value) => value + 1);
    save.clear();
    remote.reload();
  };
  return {
    value: snapshot?.value, current: remote.data?.value, editKey: (snapshot?.sha256 ?? "") + ":" + revision, reload: remote.reload, saving: save.busy,
    update(value: T): void { if (snapshot) setDraft({ ...snapshot, value }); },
    feedback: <>
      {remote.loading && <p className={ui.muted}>Loading…</p>}
      <ErrorText error={save.error ?? remote.error} />
      {draft && <Button disabled={!connected || save.busy} onClick={reset}>Reload {name}</Button>}
    </>,
    button(label: string, invalid = false): ReactNode {
      return <Button kind="primary" disabled={!connected || save.busy || !draft || invalid} onClick={() => { if (draft) void save.run(draft.value); }}>{label}</Button>;
    },
  };
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <section id={id} className={s.section}><Panel><h2>{title}</h2>{children}</Panel></section>;
}

function JsonField({ label, value, onValue, onInvalid }: { label: string; value: unknown; onValue(value: unknown): void; onInvalid(invalid: boolean): void }) {
  const [text, setText] = useState<string>();
  const [invalid, setInvalid] = useState(false);
  return <Field label={label}>
    <textarea className={s.smallJson} spellCheck={false} aria-invalid={invalid} value={text ?? JSON.stringify(value, null, 2)} onChange={(event) => {
      setText(event.target.value);
      let parsed: unknown;
      try { parsed = JSON.parse(event.target.value); }
      catch { setInvalid(true); onInvalid(true); return; }
      setInvalid(false);
      onInvalid(false);
      onValue(parsed);
    }} />
    <ErrorText error={invalid ? "Invalid JSON." : null} />
  </Field>;
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
    {!!progress?.lines.length && <pre className={s.loginLog} aria-label="Login progress">{progress.lines.join("\n")}</pre>}
    {running && <form className={ui.row} onSubmit={(event) => { event.preventDefault(); if (connected && !send.busy && code.trim()) void send.run(); }}>
      <Field label="Login code"><input type="password" autoComplete="off" disabled={!connected || send.busy} value={code} onChange={(event) => setCode(event.target.value)} /></Field>
      <Button type="submit" disabled={!connected || send.busy || !code.trim()}>Send code</Button>
    </form>}
    <ErrorText error={send.error} />
  </>;
}

function LoginControls({ accounts, protectedOnly = false }: { accounts: Account[]; protectedOnly?: boolean }) {
  const connected: boolean = useConnected();
  const logins = useData(() => call("listLogins"), [], (message) => (message.type === "login.progress" && message.done) || (message.type === "definition.changed" && ["settings.json", "accounts.json"].includes(message.path)));
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [toolRuns, setToolRuns] = useState<Record<string, string>>({});
  const [toolStates, setToolStates] = useState<Record<string, string>>({});
  const checkedRuns = useRef<Set<string>>(new Set());
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
    if (isModel) {
      await call("recheckLogin", { params: { id } });
      logins.reload();
    } else {
      const { state } = await call("recheckAccount", { params: { id } });
      setToolStates((old) => ({ ...old, [id]: state }));
    }
  });
  const visible = accounts.filter((account) => !protectedOnly || account.kind === "model");
  const locked: boolean = !connected || start.busy || recheck.busy;
  return <div className={ui.stack}>
    <ErrorText error={start.error ?? recheck.error ?? logins.error} />
    {!visible.length && <Empty>No {protectedOnly ? "model " : ""}accounts configured.</Empty>}
    {visible.map((account) => {
      const items = logins.data?.filter((login) => login.account === account.id && (protectedOnly ? login.osUser === "pecore-agent" : login.osUser !== "pecore-agent")) ?? [];
      const id: string | undefined = toolRuns[account.id];
      const output: Progress | undefined = id ? progress[id] : undefined;
      return <div key={account.id} className={ui.stack}>
        <strong>{account.id} · {account.kind}</strong>
        {account.kind === "model" ? <>
          {!items.length && <span className={ui.muted}>{logins.loading ? "Loading logins…" : "No login found for this user."}</span>}
          {items.map((login) => {
            const current: Progress | undefined = progress[login.id];
            const running: boolean = current ? !current.done : login.running;
            return <div key={login.id}>
              <div className={ui.row}>
                <span>{login.osUser} · {login.state.replaceAll("_", " ")}{login.email && " · " + login.email}{login.plan && " · " + login.plan}</span>
                {login.defaultDir
                  ? <span className={ui.muted} title="The first account of each harness uses the login you already have; log in with the harness itself if needed.">your existing login</span>
                  : <Button disabled={locked || running} onClick={() => void start.run(account, login.osUser, login.id)}>Login</Button>}
                <Button disabled={locked || running} onClick={() => void recheck.run(login.id, true)}>Recheck login</Button>
              </div>
              <LoginOutput id={login.id} progress={current} running={running} />
            </div>;
          })}
        </> : <>
          <div className={ui.row}>
            <span>{(toolStates[account.id] ?? "unchecked").replaceAll("_", " ")}</span>
            {account.kind === "forge" && <Button disabled={locked || (!!id && !output?.done)} onClick={() => {
              if (id) setProgress((old) => { const next = { ...old }; delete next[id]; return next; });
              void start.run(account);
            }}>Login</Button>}
            {account.kind === "service" && <span className={ui.muted}>Log in with {account.tool}.</span>}
            <Button disabled={locked || (!!id && !output?.done)} onClick={() => void recheck.run(account.id, false)}>Recheck</Button>
          </div>
          {id && <LoginOutput id={id} progress={output} running={!output?.done} />}
        </>}
      </div>;
    })}
  </div>;
}

function ProfileFields({ profile, update, accounts }: { profile: Profile; update(value: Profile): void; accounts: Account[] }) {
  const optionId: string = useId();
  const options = useData(() => profile.account ? call("accountOptions", { params: { id: profile.account } }) : Promise.resolve<ModelOptions>(null), [profile.account], (message) => message.type === "login.progress" && message.done);
  const models: string[] = options.data?.models ?? [];
  const efforts: string[] = options.data?.efforts ?? [];
  const modelList: string = optionId + "-models";
  const effortList: string = optionId + "-efforts";
  return <div className={ui.row}>
    <Field label="Profile ID"><input value={profile.id} onChange={(event) => update({ ...profile, id: event.target.value })} /></Field>
    <Field label="Model account"><select value={profile.account} onChange={(event) => update({ ...profile, account: event.target.value })}>
      <option value="">Select</option>
      {profile.account && !accounts.some(({ id }) => id === profile.account) && <option>{profile.account}</option>}
      {accounts.map(({ id }) => <option key={id}>{id}</option>)}
    </select></Field>
    <Field label="Model"><input list={modelList} value={profile.model} onChange={(event) => update({ ...profile, model: event.target.value })} /></Field>
    <datalist id={modelList}>{models.map((model) => <option key={model} value={model} />)}</datalist>
    <Field label="Effort"><input list={effortList} value={profile.effort ?? ""} onChange={(event) => update({ ...profile, effort: event.target.value || null })} /></Field>
    <datalist id={effortList}>{efforts.map((effort) => <option key={effort} value={effort} />)}</datalist>
  </div>;
}

function ConnectorFile({ path, close }: { path: string; close(): void }) {
  const file = useDefinitionDraft(path);
  const warn = useUnsaved(file.dirty);
  const dismiss = (): void => {
    if (!file.dirty || window.confirm("Discard your unsaved connector changes?")) close();
  };
  return <Modal open onClose={dismiss} title={path.split("/").at(-1) ?? "Connector"}>
    {file.feedback}
    {file.ready && <div className={ui.stack}>
      <Field label="Connector JSON"><textarea className={s.json} value={file.content} disabled={!file.editable} onChange={(event) => file.update(event.target.value)} /></Field>
      <DefinitionErrors errors={file.errors} />
      <div className={ui.row}>{file.saveButton}<Button disabled={!file.connected} onClick={dismiss}>Close</Button></div>
    </div>}
    {warn}
  </Modal>;
}

function Connectors() {
  const connected: boolean = useConnected();
  const [open, setOpen] = useState("");
  const connectors = useData(() => call("listDefinitions", { query: { dir: "connectors" } }), [], (message) => message.type === "definition.changed" && message.path.startsWith("connectors/"));
  return <Section id="connectors" title="Connectors">
    <ErrorText error={connectors.error} />
    {connectors.loading && <p className={ui.muted}>Loading connectors…</p>}
    {connectors.data?.length === 0 && <Empty>No connector files.</Empty>}
    {connectors.data?.map((item) => <div key={item.path}>
      <Button disabled={!connected} onClick={() => setOpen(item.path)}>{item.path.split("/").at(-1)}</Button>
      <DefinitionErrors errors={item.errors} />
    </div>)}
    {open && <ConnectorFile key={open} path={open} close={() => setOpen("")} />}
  </Section>;
}

const tiersList: TierName[] = ["frontier", "strong", "standard", "cheap"];

function SettingsFields({ value, update, profiles, dirtyJson, savedKey, markJson }: { value: SettingsValue; update(value: SettingsValue): void; profiles: Profile[]; dirtyJson: string[]; savedKey: string; markJson(key: string, invalid: boolean): void }) {
  const connected: boolean = useConnected();
  const themes = useData(() => call("listThemes"), [], (message) => message.type === "definition.changed" && message.path.startsWith("themes/"));
  const theme: string = themeChoice(value.ui);
  const jsonField = (key: "prices" | "projectPaths" | "programPaths", label: string): ReactNode => <JsonField key={savedKey + key} label={label} value={value[key]} onValue={(data) => update({ ...value, [key]: data })} onInvalid={(invalid) => markJson(key, invalid)} />;
  const number = (label: string, value: number | null, min: number, set: (value: number | null) => void, step = 1): ReactNode => <Field label={label}><input type="number" min={min} step={step} value={value ?? ""} onChange={(event) => set(event.target.value === "" ? null : Number(event.target.value))} /></Field>;
  return <>
    <Section id="orchestrator" title="Orchestrator">
      <Field label="Profile"><select value={value.orchestrator?.profile ?? ""} onChange={(event) => update({ ...value, orchestrator: event.target.value ? { profile: event.target.value } : null })}>
        <option value="">None</option>
        {value.orchestrator && !profiles.some(({ id }) => id === value.orchestrator?.profile) && <option>{value.orchestrator.profile}</option>}
        {profiles.map(({ id }) => <option key={id}>{id}</option>)}
      </select></Field>
    </Section>
    <Section id="limits" title="Limits and disk threshold">
      {number("Concurrent jobs (blank for automatic)", value.limits.jobs, 1, (jobs) => update({ ...value, limits: { ...value.limits, jobs } }))}
      {number("Concurrent agents", value.limits.agents, 1, (agents) => update({ ...value, limits: { ...value.limits, agents: agents ?? 0 } }))}
      <JsonField key={savedKey + "providers"} label="Concurrent agents by provider (JSON)" value={value.limits.providers} onValue={(data) => update({ ...value, limits: { ...value.limits, providers: data as SettingsValue["limits"]["providers"] } })} onInvalid={(invalid) => markJson("providers", invalid)} />
      {number("Minimum free disk (GB)", value.minFreeDiskGb, 0, (gb) => update({ ...value, minFreeDiskGb: gb ?? 0 }), 0.1)}
    </Section>
    <Section id="servicesRuntime" title="Services runtime">
      <Field label="Compose runtime"><select value={value.servicesRuntime ?? ""} onChange={(event) => update({ ...value, servicesRuntime: (event.target.value || null) as SettingsValue["servicesRuntime"] })}>
        <option value="">None</option>{["docker", "podman", "colima", "orbstack"].map((runtime) => <option key={runtime}>{runtime}</option>)}
      </select></Field>
    </Section>
    <Section id="mergeCheckSec" title="Merge check interval">{number("Seconds", value.mergeCheckSec, 1, (seconds) => update({ ...value, mergeCheckSec: seconds ?? 0 }))}</Section>
    <Section id="prices" title="Prices">{jsonField("prices", "Prices by model (JSON)")}</Section>
    <Section id="projectPaths" title="Project paths">{jsonField("projectPaths", "Paths by project (JSON)")}</Section>
    <Section id="programPaths" title="Program paths">{jsonField("programPaths", "Absolute paths by tool (JSON)")}</Section>
    <Section id="notifications" title="Notifications and quiet hours">
      <label><input type="checkbox" checked={value.quietHours !== null} onChange={(event) => update({ ...value, quietHours: event.target.checked ? { from: "", to: "" } : null })} /> Quiet hours</label>
      {value.quietHours && <div className={ui.row}>
        {(["from", "to"] as const).map((key) => <Field key={key} label={key === "from" ? "From" : "To"}><input type="time" value={value.quietHours?.[key]} onChange={(event) => { if (value.quietHours) update({ ...value, quietHours: { ...value.quietHours, [key]: event.target.value } }); }} /></Field>)}
      </div>}
    </Section>
    <Section id="appearance" title="Appearance">
      <Field label="Theme"><select value={theme} onChange={(event) => update({ ...value, ui: { ...value.ui, theme: event.target.value } })}>
        <option value="builtin:system">System</option><option value="builtin:light">Light</option><option value="builtin:dark">Dark</option>
        {!theme.startsWith("builtin:") && !themes.data?.some(({ file }) => file === theme) && <option value={theme}>{theme} (missing)</option>}
        {themes.data?.map((item) => <option key={item.file} value={item.file} disabled={!item.theme}>{item.theme?.name ?? item.file}</option>)}
      </select></Field>
      <ErrorText error={themes.error} />
      {themes.data?.filter((item) => item.errors.length).map((item) => <div key={item.file}><strong>{item.file}</strong><DefinitionErrors errors={item.errors} /></div>)}
    </Section>
    {!!dirtyJson.length && <ErrorText error="Fix invalid JSON before saving." />}
    {!connected && <p className={ui.muted}>Settings may be stale.</p>}
  </>;
}

export function Settings() {
  const connected: boolean = useConnected();
  const { search } = useLocation();
  const settings = useGlobalFile("settings", () => call("getSettings"), (body) => call("putSettings", { body }));
  const accounts = useGlobalFile("accounts", () => call("getAccounts"), (body) => call("putAccounts", { body }));
  const profiles = useGlobalFile("profiles", () => call("getProfiles"), (body) => call("putProfiles", { body }));
  const tiers = useGlobalFile("tiers", () => call("getTiers"), (body) => call("putTiers", { body }));
  const status = useData(() => call("getStatus"), []);
  const [checks, setChecks] = useState<RouteResult<"checkPrerequisites">>();
  const [disableDialog, setDisableDialog] = useState(false);
  const [invalidAccounts, setInvalidAccounts] = useState(false);
  const [invalidJson, setInvalidJson] = useState<string[]>([]);
  const actualProtected: boolean = settings.current?.protectedMode ?? false;
  const check = useAction(async () => setChecks(await call("checkPrerequisites")));
  const protect = useAction(async (on: boolean, removeUser: boolean = false) => {
    await call("setProtectedMode", { body: { on, removeUser } });
    setDisableDialog(false);
    settings.reload();
    status.reload();
  });
  const settingsResult = SettingsSchema.safeParse(settings.value);
  const accountsResult = AccountsSchema.safeParse(accounts.value);
  const profilesResult = ProfilesSchema.safeParse(profiles.value);
  const tiersResult = TiersSchema.safeParse(tiers.value);

  useEffect(() => { setInvalidAccounts(false); }, [accounts.editKey]);
  useEffect(() => { setInvalidJson([]); }, [settings.editKey]);
  useEffect(() => {
    const id: string | null = new URLSearchParams(search).get("section");
    if (id) document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [search, !!settings.value, !!accounts.value, !!tiers.value]);

  return <Page title="Settings">
    <Section id="prerequisites" title="Prerequisites">
      <Button disabled={!connected || check.busy} onClick={() => void check.run()}>Recheck prerequisites</Button>
      <ErrorText error={check.error} />
      {checks && <ul>{checks.map((item) => <li key={item.tool}>
        {item.tool}{item.version && " · " + item.version} · {item.ok ? "Ready" : item.problem ?? "Check failed"}
        {item.setting && connected && <> · <Link to={settingUrl(item.setting)}>Open setting</Link></>}
      </li>)}</ul>}
    </Section>
    <Section id="home" title="PECORE_HOME permissions">
      <ErrorText error={status.error} />
      {status.loading && <p className={ui.muted}>Checking permissions…</p>}
      {status.data?.homeFindings.length === 0 && <p>No permission problems found.</p>}
      {status.data?.homeFindings.map((finding) => <div key={finding.path}><ErrorText error={finding.path + " can be read by other users."} /><pre className={s.loginLog}>{finding.fix.join(" ")}</pre></div>)}
      <Button disabled={!connected || status.loading} onClick={status.reload}>Recheck permissions</Button>
    </Section>
    <Section id="accounts" title="Accounts">
      {accounts.feedback}
      {accounts.value && <>
        <fieldset className={s.fields} disabled={!connected || accounts.saving}>
          <JsonField key={accounts.editKey} label="Accounts list (model, forge and service JSON)" value={accounts.value.accounts} onValue={(data) => {
            if (accounts.value) accounts.update({ ...accounts.value, accounts: data as Account[] });
          }} onInvalid={(invalid) => {
            if (invalid && accounts.value) accounts.update(accounts.value);
            setInvalidAccounts(invalid);
          }} />
          <Issues issues={accountsResult.error?.issues} />
        </fieldset>
        {accounts.button("Save accounts", invalidAccounts || !accountsResult.success)}
      </>}
      <LoginControls accounts={accounts.current?.accounts ?? []} />
    </Section>
    <Section id="protectedMode" title="Protected mode">
      <p>Agents cannot read your files or logins. Log in once per model account as pecore-agent. Agents can read all pecore-agent logins.</p>
      <label><input type="checkbox" role="switch" checked={actualProtected} disabled={!connected || protect.busy || settings.saving || !settings.current}
        onChange={(event) => { if (event.target.checked) void protect.run(true); else setDisableDialog(true); }} /> Protected mode</label>
      <ErrorText error={protect.error} />
      {actualProtected && <LoginControls accounts={accounts.current?.accounts ?? []} protectedOnly />}
    </Section>
    <Modal open={disableDialog} onClose={() => { if (!protect.busy) setDisableDialog(false); }} title="Turn off protected mode">
      <p>Also remove the pecore-agent user?</p>
      <ErrorText error={protect.error} />
      <div className={ui.row}>
        <Button disabled={!connected || protect.busy} onClick={() => void protect.run(false)}>Keep user</Button>
        <Button kind="danger" disabled={!connected || protect.busy} onClick={() => void protect.run(false, true)}>Remove user</Button>
      </div>
    </Modal>
    <Section id="tiers" title="Profiles and tiers">
      {profiles.feedback}
      {profiles.value && <fieldset className={s.fields} disabled={!connected || profiles.saving}>
        {profiles.value.profiles.map((profile, index) => <div key={index} className={ui.stack}>
          <ProfileFields profile={profile} accounts={(accounts.current?.accounts ?? []).filter(({ kind }) => kind === "model")} update={(value) => {
            if (profiles.value) profiles.update({ ...profiles.value, profiles: profiles.value.profiles.map((item, at) => at === index ? value : item) });
          }} />
          <div><Button onClick={() => {
            if (profiles.value) profiles.update({ ...profiles.value, profiles: profiles.value.profiles.filter((_, at) => at !== index) });
          }}>Remove profile</Button></div>
        </div>)}
        <div><Button onClick={() => {
          if (profiles.value) profiles.update({ ...profiles.value, profiles: [...profiles.value.profiles, { id: "", account: "", model: "", effort: null }] });
        }}>Add profile</Button></div>
        <Issues issues={profilesResult.error?.issues} />
        <div>{profiles.button("Save profiles", !profilesResult.success)}</div>
      </fieldset>}
      {tiers.feedback}
      {tiers.value && <fieldset className={s.fields} disabled={!connected || tiers.saving}>
        {tiersList.map((tier) => <Field key={tier} label={tier + " profiles (comma separated)"}>
          <input value={tiers.value?.tiers[tier].join(",")} onChange={(event) => {
            if (tiers.value) tiers.update({ ...tiers.value, tiers: { ...tiers.value.tiers, [tier]: event.target.value ? event.target.value.split(",") : [] } });
          }} />
        </Field>)}
        <Issues issues={tiersResult.error?.issues} />
        <div>{tiers.button("Save tiers", !tiersResult.success)}</div>
      </fieldset>}
    </Section>
    <Connectors />
    {settings.feedback}
    {settings.value && <>
      <fieldset className={s.fields} disabled={!connected || settings.saving || protect.busy}>
        <SettingsFields value={settings.value} update={settings.update} profiles={profiles.current?.profiles ?? []} savedKey={settings.editKey} dirtyJson={invalidJson}
          markJson={(key, invalid) => {
            if (invalid && settings.value) settings.update(settings.value);
            setInvalidJson((old) => invalid ? [...new Set([...old, key])] : old.filter((item) => item !== key));
          }} />
      </fieldset>
      <Issues issues={settingsResult.error?.issues} />
      <div>{settings.button("Save settings", !settingsResult.success || !!invalidJson.length || protect.busy)}</div>
    </>}
  </Page>;
}
