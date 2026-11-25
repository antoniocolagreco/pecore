import { useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { assistantAgentId, builtInAgentNames, NodeAgentCatalog, Compaction, compactionSizes, defaultAgentColor } from "@pecore/schemas";
import type { Account, AgentDefinition, ModelAccount, NodeAgent } from "@pecore/schemas";
import { call } from "../api/client";
import { useAction, useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { PageActions } from "../components/PageActions";
import { ErrorText, Page } from "../components/ui";
import { restorePageScroll } from "../components/usePageScroll";
import { ModelPicker } from "../components/AgentFields";
import { AgentCard } from "../components/AgentCard";
import { Button } from "../ds/button";
import { Card, EmptyState, Skeleton, Spinner } from "../ds/feedback";
import { TextArea, TextField } from "../ds/field";
import { PlusIcon, SparkIcon } from "../ds/icons";
import { Dialog } from "../ds/overlay";
import { Select } from "../ds/select";
import type { Option } from "../ds/select";
import { ColorPicker } from "../ds/values";
import { Sidecar, useUnsaved } from "./NodeEditor";
import s from "./Agents.module.css";

function sizeOptions(sizes: readonly number[]): { value: string; label: string }[] {
  return sizes.map((size) => ({ value: String(size), label: `${size / 1024}K tokens` }));
}

function useAgentCatalog() {
  const catalog = useData(() => call("getAgents"), [], (event) => event.type === "configuration.changed" && event.kind === "agents");
  const accounts = useData(() => call("getAccounts"), [], (event) => event.type === "configuration.changed" && event.kind === "accounts");
  const modelAccounts: ModelAccount[] = accounts.data?.value.accounts.filter((account) => account.kind === "model") ?? [];
  return { catalog, modelAccounts, configurationError: accounts.error };
}

export function Agents() {
  const navigate = useNavigate();
  const { catalog, modelAccounts, configurationError } = useAgentCatalog();
  const connected: boolean = useConnected();
  const agents: NodeAgent[] = catalog.data?.value.agents ?? [];
  const newAgent = <Button variant="primary" icon={<PlusIcon />} disabled={!connected || !catalog.data}
    onClick={() => void navigate("/agents/edit")}>New agent</Button>;

  return <Page title="Agents" actions={catalog.data && agents.length === 0 ? undefined : newAgent}>
    <ErrorText error={catalog.error ?? configurationError} />
    {catalog.loading && !catalog.data && <ul className={s.list} aria-hidden="true">
      {[0, 1, 2].map((index) => <li key={index}><Skeleton height={338} /></li>)}
    </ul>}
    {catalog.data && (
      agents.length === 0
        ? <Card padded><EmptyState icon={<SparkIcon size="md" />} title="No agents yet" action={newAgent} /></Card>
        : <ul className={s.list} aria-label="Agents">
          {agents.map((agent) => <li key={agent.id}>
            <AgentCard agent={agent} account={modelAccounts.find(({ id }) => id === agent.model?.account)}
              to={connected ? `/agents/edit/${encodeURIComponent(agent.id)}` : undefined} />
          </li>)}
        </ul>
    )}
  </Page>;
}

export function AgentCatalogEditor() {
  const { id } = useParams();
  const { catalog, modelAccounts, configurationError } = useAgentCatalog();
  const setup = useData(() => call("getSetup"), [], (event) => (event.type === "login.progress" && event.done)
    || (event.type === "configuration.changed" && event.kind === "accounts"));
  const connected: boolean = useConnected();
  const [draft] = useState<NodeAgent>(() => ({ id: `agent-${crypto.randomUUID()}`, kind: "agent", name: "", model: null, color: defaultAgentColor, compaction: Compaction.parse({}) }));
  const agent: NodeAgent | undefined = id ? catalog.data?.value.agents.find((entry) => entry.id === id) : draft;
  if (!catalog.data || !agent) return <Page title="Agents">
    <Link to="/agents" state={restorePageScroll}>Back to agents</Link>
    <ErrorText error={catalog.error ?? (catalog.data && !agent ? "Agent not found." : null)} />
    {catalog.loading && <Spinner />}
  </Page>;
  return <AgentEditor key={agent.id} initial={agent} title={id ? agent.name : "New agent"} baseSha256={catalog.data.sha256}
    catalog={catalog.data.value} accounts={modelAccounts} providersAvailable={setup.data?.modelAccountWorks ?? false} configurationError={configurationError ?? setup.error} creating={!id} disabled={!connected} />;
}

function CatalogNavigation({ dirty, completed }: { dirty: boolean; completed: boolean }) {
  const navigate = useNavigate();
  const warning = useUnsaved(dirty && !completed);
  useEffect(() => {
    if (completed) void navigate("/agents", { replace: true, state: restorePageScroll });
  }, [completed, navigate]);
  return warning;
}

export function ProjectManagerSettings({ project }: { project: string }) {
  const settings = useData(() => call("getChatAgentSettings", { query: { role: "pm", project } }), [project],
    (event) => event.type === "configuration.changed" && event.kind === "agents");
  const cards = useData(() => call("getAgents"), [], (event) => event.type === "configuration.changed" && event.kind === "agents");
  const connected: boolean = useConnected();
  const data = settings.data;
  const cardOptions: Option[] | undefined = cards.data?.value.agents
    .filter(({ id }) => id !== assistantAgentId).map(({ id, name }) => ({ value: id, label: name }));
  return <>
    <ErrorText error={settings.error ?? cards.error} />
    {settings.loading && !data && <Spinner />}
    {data?.value.kind === "pm" && <AgentEditor key={data.value.id} initial={{ id: data.value.id, kind: "pm", name: data.value.name, color: data.value.color, cardId: data.value.cardId }}
      baseSha256={data.sha256} project={project} title="Project Manager" accounts={[]} cardOptions={cardOptions} creating={false} disabled={!connected} onSaved={() => settings.reload()} />}
  </>;
}

function AgentEditor({ initial, baseSha256, catalog, title, accounts, providersAvailable = false, cardOptions, configurationError, project, creating, disabled, onSaved }: {
  initial: AgentDefinition;
  baseSha256: string;
  catalog?: NodeAgentCatalog;
  title: string;
  accounts: Account[];
  providersAvailable?: boolean;
  cardOptions?: Option[];
  configurationError?: Error | null;
  project?: string;
  creating: boolean;
  disabled: boolean;
  onSaved?(): void;
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
    setEdit((prior) => ({ value: update(prior?.value ?? initial), base: prior ? prior.base : saved, sha256: prior?.sha256 ?? baseSha256 }));
  };
  const [draft, setDraft] = useState<{ content: string; sha256: string | undefined } | null>(null);
  const formId: string = useId();
  const contextLabelId: string = useId();
  const upload = useRef<HTMLInputElement>(null);
  const context = useData(() => !creating ? call("getAgentContext", { params: { id: agent.id } }) : Promise.resolve(undefined), [agent.id, creating],
    (event) => event.type === "configuration.changed" && event.kind === "agents");
  const content: string = draft?.content ?? context.data?.content ?? "";
  const duplicate: boolean = catalog?.agents.some((entry) => entry.id !== agent.id && entry.name.toLowerCase() === agent.name.trim().toLowerCase()) ?? false;
  const dirty: boolean = JSON.stringify(agent) !== JSON.stringify(saved);
  const contextDirty: boolean = draft !== null && content !== (context.data?.content ?? "");
  const save = useAction(async () => {
    if (dirty) {
      const sha: string = edit?.sha256 ?? baseSha256;
      if (project && agent.kind === "pm") {
        const { sha256 } = await call("putChatAgentSettings", { query: { project }, body: { value: agent, baseSha256: sha } });
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
    if (project) onSaved?.();
    else setCompleted(true);
  });
  const changeContent = (content: string): void => setDraft((prior) => ({ content, sha256: prior?.sha256 ?? context.data?.sha256 }));
  const destroy = useAction(async () => {
    if (!catalog || builtInAgentNames.has(agent.id)) return;
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
  const fixedName: boolean = agent.kind === "agent" && builtInAgentNames.has(agent.id);
  const model: NodeAgent["model"] = agent.kind === "agent" ? agent.model : null;
  const valid: boolean = !!agent.name.trim() && !duplicate && !tooLong && (!model || !!model.model) && content.length <= 1_000_000;
  const submit = <Button type="submit" form={formId} variant="primary" disabled={!editable || !valid || (!dirty && !contextDirty)}>{saved ? "Save" : "Create"}</Button>;
  const form = <form id={formId} onSubmit={(event) => { event.preventDefault(); if (editable && valid && (dirty || contextDirty)) void save.run(); }}>
    <Card title={project ? title : "Configuration"} actions={project && <PageActions>{submit}</PageActions>}>
      <div className={s.fields}>
        {agent.kind === "pm" && <Select label="Agent card" value={agent.cardId} options={cardOptions ?? []} disabled={!editable || !cardOptions}
          onValueChange={(cardId) => { if (cardId) changeAgent((entry) => entry.kind === "pm" ? { ...entry, cardId } : entry); }} />}
        {!fixedName && <div className={s.pair}>
          <TextField label="Name" value={agent.name} disabled={!editable}
            error={duplicate ? "This name is already in use." : tooLong ? "This name is too long." : undefined}
            onValueChange={(name) => changeAgent((entry) => ({ ...entry, name }))} />
          {agent.kind === "pm" && <ColorPicker label="Colour" value={agent.color} disabled={!editable}
            onValueChange={(color) => changeAgent((entry) => entry.kind === "pm" ? { ...entry, color } : entry)} />}
        </div>}
        {agent.kind === "agent" && <>
          <ModelPicker accounts={accounts} choice={agent.model} available={providersAvailable} disabled={!editable} onChoice={(model) => changeAgent((entry) => entry.kind === "agent" ? { ...entry, model } : entry)} />
          {!providersAvailable && <p className={s.hint}>Connect an AI provider in <Link to="/settings?section=accounts">Accounts</Link>.</p>}
          <div className={s.pair}>
            <Select label="Auto compaction" description="After 5 minutes without messages." disabled={!editable} value={String(agent.compaction.auto)}
              options={sizeOptions(compactionSizes.slice(0, -1))} onValueChange={(value) => {
                const auto: number = Number(value);
                if (auto) changeAgent((entry) => entry.kind === "agent" ? { ...entry, compaction: { auto, max: Math.max(entry.compaction.max, auto * 2) } } : entry);
              }} />
            <Select label="Maximum context" description="Compact as soon as this threshold is reached." disabled={!editable} value={String(agent.compaction.max)}
              options={sizeOptions(compactionSizes.filter((size) => size >= agent.compaction.auto * 2))} onValueChange={(value) => {
                const max: number = Number(value);
                if (max) changeAgent((entry) => entry.kind === "agent" ? { ...entry, compaction: { ...entry.compaction, max } } : entry);
              }} />
          </div>
          <ColorPicker label="Card colour" value={agent.color} disabled={!editable}
            onValueChange={(color) => changeAgent((entry) => entry.kind === "agent" ? { ...entry, color } : entry)} />
        </>}
        {project && <TextArea label="Custom context" rows={10} value={content} onValueChange={changeContent}
          disabled={!contextEditable} error={contextError} />}
        {!project && <div className={s.context} role="group" aria-labelledby={contextLabelId}>
          <div className={s.contextHeader}>
            <span id={contextLabelId}>Custom context</span>
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
  if (project) return form;
  return <Page title={title} width={820} actions={<>
    {!creating && !fixedName && <Button variant="danger" disabled={!editable} onClick={() => { destroy.clear(); setRemoving(true); }}>Delete agent</Button>}
    {submit}
  </>}>
    <CatalogNavigation dirty={contextDirty || (dirty && (!creating || edit !== null))} completed={completed} />
    {busy ? <span className={s.hint}>Back to agents</span> : <Link to="/agents" state={restorePageScroll}>Back to agents</Link>}
    <ErrorText error={configurationError} />
    {form}
    {removing && <Dialog open onOpenChange={(open) => { if (!open && !destroy.busy) setRemoving(false); }} title={`Delete ${initial.name}?`} footer={<>
      <Button disabled={destroy.busy} onClick={() => setRemoving(false)}>Cancel</Button>
      <Button variant="dangerSolid" loading={destroy.busy} disabled={disabled} onClick={() => void destroy.run()}>Delete agent</Button>
    </>}>
      <ErrorText error={destroy.error} />
    </Dialog>}
  </Page>;
}
