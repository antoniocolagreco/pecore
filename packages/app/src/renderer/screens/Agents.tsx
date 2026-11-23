import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { ChatAgent, NodeAgentCatalog, Compaction, compactionSizes } from "@pecore/schemas";
import type { Account, AgentDefinition, AssistantTraitId, NodeAgent, Role } from "@pecore/schemas";
import { call } from "../api/client";
import { useAction, useAutoSave, useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { ErrorText, Page, ui } from "../components/ui";
import { ModelPicker, Traits } from "../components/AgentFields";
import { Button } from "../ds/button";
import { Card, Spinner } from "../ds/feedback";
import { TextField } from "../ds/field";
import { Dialog } from "../ds/overlay";
import { Select } from "../ds/select";
import { SidebarItem, SidebarSection } from "../shell/sidebar";
import { Sidecar } from "./NodeEditor";
import s from "./Agents.module.css";

function sizeOptions(sizes: readonly number[]): { value: string; label: string }[] {
  return sizes.map((size) => ({ value: String(size), label: `${size / 1024}K tokens` }));
}

export function Agents() {
  const catalog = useData(() => call("getAgents"), [], (event) => event.type === "definition.changed" && event.path === "agents.json");
  const accounts = useData(() => call("getAccounts"), [], (event) => event.type === "definition.changed" && event.path === "accounts.json");
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<NodeAgent | null>(null);
  const connected: boolean = useConnected();
  const agents: NodeAgent[] = catalog.data?.value.agents ?? [];
  const agent: NodeAgent | undefined = draft ?? agents.find(({ id }) => id === selected) ?? agents[0];
  const choose = (id: string | null): void => {
    setDraft(null);
    setSelected(id);
  };
  return <Page title="Agents" width={900} actions={<Button disabled={!connected || !catalog.data}
    onClick={() => setDraft({ id: `agent-${crypto.randomUUID()}`, kind: "agent", name: "", model: null, compaction: Compaction.parse({}) })}>New agent</Button>}>
    <SidebarSection title="Agents" label="Agents">
      {agents.map((entry) => <SidebarItem key={entry.id} active={agent?.id === entry.id} onClick={() => choose(entry.id)}>{entry.name}</SidebarItem>)}
    </SidebarSection>
    <ErrorText error={catalog.error ?? accounts.error} />
    {catalog.data && !agent && <Card><p className={ui.muted}>No agent configurations yet.</p></Card>}
    {agent && catalog.data && <AgentEditor key={agent.id} initial={agent} title={draft ? "New agent" : agent.name} baseSha256={catalog.data.sha256}
      catalog={catalog.data.value} accounts={accounts.data?.value.accounts.filter(({ kind }) => kind === "model") ?? []}
      creating={draft !== null} disabled={!connected} onSaved={(id) => { choose(id); catalog.reload(); }}
      onDeleted={() => { choose(null); catalog.reload(); }} />}
  </Page>;
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

function AgentEditor({ initial, baseSha256, catalog, title, accounts, scope, effectiveModel, creating, disabled, onSaved, onDeleted, onAutoChange }: {
  initial: AgentDefinition;
  baseSha256: string;
  catalog?: NodeAgentCatalog;
  title?: string;
  accounts: Account[];
  scope?: { role: Role; project?: string };
  effectiveModel?: AgentDefinition["model"];
  creating: boolean;
  disabled: boolean;
  onSaved(id: string): void;
  onDeleted?(): void;
  onAutoChange?(update: (agent: AgentDefinition) => AgentDefinition): void;
}) {
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
  const [remove, setRemove] = useState<boolean>(false);
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
    onSaved(agent.id);
  });
  const destroy = useAction(async () => {
    if (!catalog) return;
    await call("putAgents", { body: { value: { ...catalog, agents: catalog.agents.filter(({ id }) => id !== agent.id) }, baseSha256 } });
    onDeleted?.();
  });
  const changeContent = (content: string): void => setDraft((prior) => ({ content, sha256: prior?.sha256 ?? context.data?.sha256 }));
  const readContext = useAction(async (file: File) => changeContent(await file.text()));
  const editable: boolean = !disabled && !save.busy && !destroy.busy;
  const contextEditable: boolean = editable && (creating || context.data !== undefined);
  const tooLong: boolean = agent.name.trim().length > (agent.kind === "pm" ? 24 : 80);
  const valid: boolean = !!agent.name.trim() && !duplicate && !tooLong && (agent.model === null ? !!scope : !!agent.model.model) && content.length <= 1_000_000;
  const inheritance: string | undefined = scope?.project ? "Project Manager Default" : scope?.role === "pm" ? "Default model" : scope ? "Auto-configured model" : undefined;
  return <form className={s.form} onSubmit={(event) => { event.preventDefault(); if (!onAutoChange && editable && valid && (dirty || contextDirty)) void save.run(); }}>
    <Card title={title} actions={<>
      {!creating && catalog && <Button disabled={!editable} onClick={() => setRemove(true)}>Delete</Button>}
      {!onAutoChange && <Button type="submit" variant="primary" disabled={!editable || !valid || (!dirty && !contextDirty)}>{saved ? "Save" : "Create"}</Button>}
    </>}>
      <div className={s.fields}>
        {(agent.kind !== "pm" || scope?.project) && <div className={s.compaction}>
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
        {scope && !agent.model && effectiveModel && <p className={ui.muted}>Current model · {effectiveModel.model}{effectiveModel.effort && ` · ${effectiveModel.effort}`}</p>}
        {!accounts.length && <p className={ui.muted}>Connect an AI provider in <Link to="/settings?section=accounts">Accounts</Link>.</p>}
        <div className={s.compaction}>
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
        {agent.kind !== "agent" && <Traits value={agent.traits} disabled={!editable}
          onChange={(traits: AssistantTraitId[]) => changeAgent((entry) => entry.kind === "agent" ? entry : { ...entry, traits })} />}
        <ErrorText error={save.error} />
      </div>
    </Card>
    {showContext && <Card title="Initial context" actions={<Button disabled={!contextEditable || readContext.busy} onClick={() => upload.current?.click()}>Upload Markdown</Button>}>
      <input type="file" ref={upload} accept=".md,text/markdown" hidden onChange={(event) => {
        const file: File | undefined = event.target.files?.[0];
        event.target.value = "";
        if (file) void readContext.run(file);
      }} />
      <Sidecar isMarkdown paper content={content} disabled={!contextEditable} change={changeContent} className={s.markdown} />
      <ErrorText error={context.error ?? readContext.error ?? (content.length > 1_000_000 ? "Keep the Markdown file below 1,000,000 characters." : null)} />
    </Card>}
    {catalog && <Dialog open={remove} onOpenChange={setRemove} title={`Delete ${agent.name}?`} footer={<>
      <Button onClick={() => setRemove(false)}>Cancel</Button>
      <Button disabled={destroy.busy} onClick={() => void destroy.run()}>Delete</Button>
    </>}>
      <ErrorText error={destroy.error} />
    </Dialog>}
  </form>;
}
