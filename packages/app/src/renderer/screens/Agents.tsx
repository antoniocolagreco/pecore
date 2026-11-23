import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { BuiltInHarness, ChatAgent, NodeAgentCatalog, Compaction, compactionSizes } from "@pecore/schemas";
import type { Account, AgentDefinition, AssistantTraitId, ModelAccount, NodeAgent, Role } from "@pecore/schemas";
import { call } from "../api/client";
import { useAction, useAutoSave, useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { PageActions } from "../components/PageActions";
import { ErrorText, Page } from "../components/ui";
import { restorePageScroll } from "../components/usePageScroll";
import { ModelPicker, Traits } from "../components/AgentFields";
import { NodeIconTile } from "../components/DefinitionIcon";
import { NodeCard } from "../components/NodeCard";
import { Button } from "../ds/button";
import { Badge, Card, EmptyState, Skeleton, Spinner } from "../ds/feedback";
import { TextArea, TextField } from "../ds/field";
import { PlusIcon, SparkIcon, TrashIcon } from "../ds/icons";
import { Dialog } from "../ds/overlay";
import { Select } from "../ds/select";
import { install } from "../shell/SetupBanner";
import { Sidecar, useUnsaved } from "./NodeEditor";
import s from "./Agents.module.css";
import templates from "./Templates.module.css";

const harnessColors: Readonly<Record<BuiltInHarness, string>> = {
  "claude-code": "light-dark(#9b492f, #d97757)",
  codex: "light-dark(#5143b9, #a89aff)",
  opencode: "light-dark(#626262, #aeaeae)",
};

function sizeOptions(sizes: readonly number[]): { value: string; label: string }[] {
  return sizes.map((size) => ({ value: String(size), label: `${size / 1024}K tokens` }));
}

function useAgentCatalog() {
  const catalog = useData(() => call("getAgents"), [], (event) => event.type === "definition.changed" && event.path === "agents.json");
  const accounts = useData(() => call("getAccounts"), [], (event) => event.type === "definition.changed" && event.path === "accounts.json");
  const modelAccounts: ModelAccount[] = accounts.data?.value.accounts.filter((account) => account.kind === "model") ?? [];
  return { catalog, modelAccounts, accountsError: accounts.error };
}

export function Agents() {
  const navigate = useNavigate();
  const { catalog, modelAccounts, accountsError } = useAgentCatalog();
  const connected: boolean = useConnected();
  const agents: NodeAgent[] = catalog.data?.value.agents ?? [];
  const newAgent = <Button variant="primary" icon={<PlusIcon />} disabled={!connected || !catalog.data}
    onClick={() => void navigate("/agents/edit")}>New agent</Button>;

  return <Page title="Agents" actions={catalog.data && agents.length === 0 ? undefined : newAgent}>
    <ErrorText error={catalog.error ?? accountsError} />
    {catalog.loading && !catalog.data && <ul className={`${templates.list} ${s.list}`} aria-hidden="true">
      {[0, 1, 2].map((index) => <li key={index} className={templates.entry}>
        <Skeleton height={120} />
        <div className={s.details}><Skeleton width="65%" /><Skeleton width="90%" /></div>
      </li>)}
    </ul>}
    {catalog.data && (
      agents.length === 0
        ? <Card padded><EmptyState icon={<SparkIcon size="md" />} title="No agents yet" action={newAgent} /></Card>
        : <ul className={`${templates.list} ${s.list}`} aria-label="Agents">
          {agents.map((agent) => {
            const to: string = `/agents/edit/${encodeURIComponent(agent.id)}`;
            const modelAccount: ModelAccount | undefined = modelAccounts.find(({ id }) => id === agent.model?.account);
            const builtIn: BuiltInHarness | undefined = BuiltInHarness.safeParse(modelAccount?.connector).data;
            const harness: string = builtIn ? install[builtIn].name : modelAccount?.connector ?? "Not set";
            const contents = <>
              <NodeCard icon={<NodeIconTile size="lg"><SparkIcon size="md" /></NodeIconTile>} title={agent.name} badge={
                <span className={s.harnessBadge} style={builtIn ? { "--harness-color": harnessColors[builtIn] } as CSSProperties : undefined}>
                  <Badge dot><span className={s.harnessName} title={modelAccount ? harness : undefined}>{modelAccount ? harness : "No harness"}</span></Badge>
                </span>
              } />
              <dl className={`${templates.description} ${s.agentSettings}`}>
                <dt>Provider</dt><dd>{modelAccount?.provider ?? "Not set"}</dd>
                <dt>Harness</dt><dd>{harness}</dd>
                <dt>Model</dt><dd>{agent.model?.model ?? "Not set"}</dd>
                <dt>Effort</dt><dd>{agent.model ? agent.model.effort ?? "Default" : "Not set"}</dd>
              </dl>
            </>;
            return <li key={agent.id}>
              {connected ? <Link to={to} className={templates.entry} aria-label={agent.name}>{contents}</Link> : <div className={templates.entry}>{contents}</div>}
            </li>;
          })}
        </ul>
    )}
  </Page>;
}

export function AgentCatalogEditor() {
  const { id } = useParams();
  const { catalog, modelAccounts, accountsError } = useAgentCatalog();
  const connected: boolean = useConnected();
  const [draft] = useState<NodeAgent>(() => ({ id: `agent-${crypto.randomUUID()}`, kind: "agent", name: "", model: null, compaction: Compaction.parse({}) }));
  const agent: NodeAgent | undefined = id ? catalog.data?.value.agents.find((entry) => entry.id === id) : draft;
  if (!catalog.data || !agent) return <Page title="Agents">
    <Link to="/agents" state={restorePageScroll}>Back to agents</Link>
    <ErrorText error={catalog.error ?? (catalog.data && !agent ? "Agent not found." : null)} />
    {catalog.loading && <Spinner />}
  </Page>;
  return <AgentEditor key={agent.id} initial={agent} title={id ? agent.name : "New agent"} baseSha256={catalog.data.sha256}
    catalog={catalog.data.value} accounts={modelAccounts} accountsError={accountsError} creating={!id} disabled={!connected} />;
}

function CatalogNavigation({ dirty, completed }: { dirty: boolean; completed: boolean }) {
  const navigate = useNavigate();
  const warning = useUnsaved(dirty && !completed);
  useEffect(() => {
    if (completed) void navigate("/agents", { replace: true, state: restorePageScroll });
  }, [completed, navigate]);
  return warning;
}

export function ChatAgentSettings({ role, project }: { role: Role; project?: string }) {
  const query: { role: Role; project?: string } = { role, ...(project ? { project } : {}) };
  const settings = useData(() => call("getChatAgentSettings", { query }), [role, project], (event) => event.type === "definition.changed" && ["agents.json", "settings.json", "profiles.json"].includes(event.path));
  const accounts = useData(() => call("getAccounts"), [], (event) => event.type === "definition.changed" && event.path === "accounts.json");
  const connected: boolean = useConnected();
  const data = settings.data;
  const automatic: boolean = project === undefined;
  const autosave = useAutoSave(settings, (body) => call("putChatAgentSettings", { query, body }), (value) => ChatAgent.safeParse(value).success);
  return <>
    <ErrorText error={settings.error ?? accounts.error ?? autosave.error} />
    {settings.loading && !data && <Spinner />}
    {data && <AgentEditor key={data.value.id} initial={automatic ? autosave.value ?? data.value : data.value} baseSha256={data.sha256} scope={query}
      title={project ? "Project Manager" : "Configuration"}
      effectiveModel={data.effectiveModel} accounts={accounts.data?.value.accounts.filter(({ kind }) => kind === "model") ?? []}
      creating={false} disabled={!connected} onSaved={() => settings.reload()}
      onAutoChange={automatic ? (update) => autosave.update((current) => {
        const next: AgentDefinition = update(current);
        return next.kind === "agent" ? current : next;
      }) : undefined} />}
  </>;
}

function AgentEditor({ initial, baseSha256, catalog, title, accounts, accountsError, scope, effectiveModel, creating, disabled, onSaved, onAutoChange }: {
  initial: AgentDefinition;
  baseSha256: string;
  catalog?: NodeAgentCatalog;
  title: string;
  accounts: Account[];
  accountsError?: Error | null;
  scope?: { role: Role; project?: string };
  effectiveModel?: AgentDefinition["model"];
  creating: boolean;
  disabled: boolean;
  onSaved?(): void;
  onAutoChange?(update: (agent: AgentDefinition) => AgentDefinition): void;
}) {
  const [completed, setCompleted] = useState<boolean>(false);
  const [removing, setRemoving] = useState<boolean>(false);
  const [edit, setEdit] = useState<{ value: AgentDefinition; base: AgentDefinition | null; sha256: string } | null>(null);
  useEffect(() => {
    if (!creating && edit && edit.base === edit.value && edit.sha256 === baseSha256) setEdit(null);
  }, [baseSha256, creating, edit]);
  const agent: AgentDefinition = edit?.value ?? initial;
  const saved: AgentDefinition | null = edit ? edit.base : creating ? null : initial;
  const changeAgent = (update: (agent: AgentDefinition) => AgentDefinition): void => {
    if (onAutoChange) {
      onAutoChange(update);
      return;
    }
    setEdit((prior) => ({ value: update(prior?.value ?? initial), base: prior ? prior.base : saved, sha256: prior?.sha256 ?? baseSha256 }));
  };
  const [draft, setDraft] = useState<{ content: string; sha256: string | undefined } | null>(null);
  const formId: string = useId();
  const contextLabelId: string = useId();
  const upload = useRef<HTMLInputElement>(null);
  const showContext: boolean = !scope || !!scope.project;
  const context = useData(() => showContext && !creating ? call("getAgentContext", { params: { id: agent.id } }) : Promise.resolve(undefined), [agent.id, creating, showContext]);
  const content: string = draft?.content ?? context.data?.content ?? "";
  const duplicate: boolean = catalog?.agents.some((entry) => entry.id !== agent.id && entry.name.toLowerCase() === agent.name.trim().toLowerCase()) ?? false;
  const dirty: boolean = JSON.stringify(agent) !== JSON.stringify(saved);
  const contextDirty: boolean = showContext && draft !== null && content !== (context.data?.content ?? "");
  const save = useAction(async () => {
    if (dirty) {
      const sha: string = edit?.sha256 ?? baseSha256;
      if (scope && agent.kind !== "agent") {
        const { sha256 } = await call("putChatAgentSettings", { query: scope, body: { value: agent, baseSha256: sha } });
        setEdit({ value: agent, base: agent, sha256 });
      } else if (catalog && agent.kind === "agent") {
        const agents: NodeAgent[] = saved ? catalog.agents.map((entry) => entry.id === agent.id ? agent : entry) : [...catalog.agents, agent];
        const value: NodeAgentCatalog = NodeAgentCatalog.parse({ ...catalog, agents });
        const { sha256 } = await call("putAgents", { body: { value, baseSha256: sha } });
        setEdit({ value: agent, base: agent, sha256 });
      }
    }
    if (contextDirty) {
      const params = { id: agent.id };
      const sha: string = draft?.sha256 ?? (await call("getAgentContext", { params })).sha256;
      await call("putAgentContext", { params, body: { content, baseSha256: sha } });
      setDraft(null);
      context.reload();
    }
    if (scope) onSaved?.();
    else setCompleted(true);
  });
  const changeContent = (content: string): void => setDraft((prior) => ({ content, sha256: prior?.sha256 ?? context.data?.sha256 }));
  const destroy = useAction(async () => {
    if (!catalog) return;
    const value: NodeAgentCatalog = { ...catalog, agents: catalog.agents.filter(({ id }) => id !== agent.id) };
    await call("putAgents", { body: { value, baseSha256 } });
    setRemoving(false);
    setCompleted(true);
  });
  const readContext = useAction(async (file: File) => changeContent(await file.text()));
  const busy: boolean = save.busy || destroy.busy;
  const editable: boolean = !disabled && !busy && !completed;
  const contextEditable: boolean = editable && (creating || context.data !== undefined);
  const contextError: string | undefined = context.error?.message ?? (content.length > 1_000_000 ? "Keep the context below 1,000,000 characters." : undefined);
  const tooLong: boolean = agent.name.trim().length > (agent.kind === "pm" ? 24 : 80);
  const valid: boolean = !!agent.name.trim() && !duplicate && !tooLong && (agent.model === null ? !!scope : !!agent.model.model) && content.length <= 1_000_000;
  const inheritance: string | undefined = scope?.project ? "Project Manager Default" : scope?.role === "pm" ? "Default model" : scope ? "Auto-configured model" : undefined;
  const submit = <Button type="submit" form={formId} variant="primary" disabled={!editable || !valid || (!dirty && !contextDirty)}>{saved ? "Save" : "Create"}</Button>;
  const form = <form id={formId} onSubmit={(event) => { event.preventDefault(); if (!onAutoChange && editable && valid && (dirty || contextDirty)) void save.run(); }}>
    <Card title={scope ? title : "Configuration"} actions={scope && !onAutoChange && <PageActions>{submit}</PageActions>}>
      <div className={s.fields}>
        {(agent.kind !== "pm" || scope?.project) && <div className={s.pair}>
          <TextField label={agent.kind === "agent" ? "Title" : "Name"} value={agent.name} disabled={!editable}
            error={duplicate ? "This name is already in use." : tooLong ? "This name is too long." : onAutoChange && !agent.name.trim() ? "Enter a name." : undefined}
            onValueChange={(name) => changeAgent((entry) => ({ ...entry, name }))} />
          {agent.kind === "pm" && scope?.project && <label className={s.color}>Colour
            <input type="color" value={agent.color.toLowerCase()} disabled={!editable} onChange={(event) => {
              const color: string = event.target.value.toUpperCase();
              changeAgent((entry) => entry.kind === "pm" ? { ...entry, color } : entry);
            }} />
          </label>}
        </div>}
        <ModelPicker accounts={accounts} choice={agent.model} inherit={inheritance} disabled={!editable} onChoice={(model) => changeAgent((entry) => ({ ...entry, model }))} />
        {scope && !agent.model && effectiveModel && <p className={s.hint}>Current model · {effectiveModel.model}{effectiveModel.effort && ` · ${effectiveModel.effort}`}</p>}
        {!accounts.length && <p className={s.hint}>Connect an AI provider in <Link to="/settings?section=accounts">Accounts</Link>.</p>}
        <div className={s.pair}>
          <Select label="Auto compaction" description="After 5 minutes without messages." disabled={!editable} value={String(agent.compaction.auto)}
            options={sizeOptions(compactionSizes.slice(0, -1))} onValueChange={(value) => {
              const auto: number = Number(value);
              if (auto) changeAgent((entry) => ({ ...entry, compaction: { auto, max: Math.max(entry.compaction.max, auto * 2) } }));
            }} />
          <Select label="Maximum context" description="Compact as soon as this threshold is reached." disabled={!editable} value={String(agent.compaction.max)}
            options={sizeOptions(compactionSizes.filter((size) => size >= agent.compaction.auto * 2))} onValueChange={(value) => {
              const max: number = Number(value);
              if (max) changeAgent((entry) => ({ ...entry, compaction: { ...entry.compaction, max } }));
            }} />
        </div>
        {(agent.kind === "assistant" || (agent.kind === "pm" && scope?.project)) && <Traits value={agent.traits} disabled={!editable}
          onChange={(traits: AssistantTraitId[]) => changeAgent((entry) => entry.kind === "agent" ? entry : { ...entry, traits })} />}
        {scope?.project && <TextArea label="Initial context" rows={5} value={content} onValueChange={changeContent}
          disabled={!contextEditable} error={contextError} />}
        {!scope && <div className={s.context} role="group" aria-labelledby={contextLabelId}>
          <div className={s.contextHeader}>
            <span id={contextLabelId}>Initial context</span>
            <Button disabled={!contextEditable || readContext.busy} onClick={() => upload.current?.click()}>Upload Markdown</Button>
          </div>
          <input type="file" ref={upload} accept=".md,text/markdown" hidden onChange={(event) => {
            const file: File | undefined = event.target.files?.[0];
            event.target.value = "";
            if (file) void readContext.run(file);
          }} />
          <Sidecar isMarkdown paper content={content} disabled={!contextEditable} change={changeContent} className={s.markdown} />
          <ErrorText error={contextError ?? readContext.error} />
        </div>}
        <ErrorText error={save.error} />
      </div>
    </Card>
  </form>;
  if (scope) return form;
  return <Page title={title} width={820} actions={<>
    {!creating && <Button icon={<TrashIcon />} disabled={!editable} onClick={() => { destroy.clear(); setRemoving(true); }}>Delete</Button>}
    {submit}
  </>}>
    <CatalogNavigation dirty={contextDirty || (dirty && (!creating || edit !== null))} completed={completed} />
    {busy ? <span className={s.hint}>Back to agents</span> : <Link to="/agents" state={restorePageScroll}>Back to agents</Link>}
    <ErrorText error={accountsError} />
    {form}
    {removing && <Dialog open onOpenChange={(open) => { if (!open && !destroy.busy) setRemoving(false); }} title={`Delete ${initial.name}?`} footer={<>
      <Button disabled={destroy.busy} onClick={() => setRemoving(false)}>Cancel</Button>
      <Button variant="danger" loading={destroy.busy} disabled={disabled} onClick={() => void destroy.run()}>Delete</Button>
    </>}>
      <ErrorText error={destroy.error} />
    </Dialog>}
  </Page>;
}
