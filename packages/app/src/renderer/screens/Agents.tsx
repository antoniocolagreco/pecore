import { useRef, useState } from "react";
import { Link } from "react-router";
import { AgentDefinitions, Compaction, compactionSizes, freeProjectManager } from "@pecore/schemas";
import type { Account, AgentDefinition, AssistantTraitId } from "@pecore/schemas";
import { call } from "../api/client";
import { useAction, useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { ErrorText, Page, ui } from "../components/ui";
import { Button } from "../ds/button";
import { Card } from "../ds/feedback";
import { TextField } from "../ds/field";
import { Dialog } from "../ds/overlay";
import { Select } from "../ds/select";
import { SidebarItem, SidebarSection } from "../shell/sidebar";
import { Sidecar } from "./NodeEditor";
import { ModelPicker, Traits } from "./Settings";
import s from "./Agents.module.css";

const kindLabels: Record<AgentDefinition["kind"], string> = { assistant: "Assistant", pm: "Project Manager", worker: "Worker" };

function newAgent(kind: "pm" | "worker", agents: AgentDefinition[]): AgentDefinition {
  const id: string = `agent-${crypto.randomUUID()}`;
  const compaction: AgentDefinition["compaction"] = Compaction.parse({});
  const name: string = "";
  if (kind === "worker") return { id, kind, name, model: null, compaction };
  const managers = agents.filter((agent) => agent.kind === "pm");
  return { id, kind, name, color: freeProjectManager(managers)?.color ?? "#808080", model: null, compaction, traits: [] };
}

function sizeOptions(sizes: readonly number[]): { value: string; label: string }[] {
  return sizes.map((size) => ({ value: String(size), label: `${size / 1024}K tokens` }));
}

export function Agents() {
  const catalog = useData(() => call("getAgents"), [], (event) => event.type === "project.updated" || (event.type === "definition.changed" && ["agents.json", "settings.json", "profiles.json"].includes(event.path)));
  const accounts = useData(() => call("getAccounts"), [], (event) => event.type === "definition.changed" && event.path === "accounts.json");
  const projects = useData(() => call("listProjects"), [], (event) => event.type === "project.updated" || (event.type === "definition.changed" && event.path === "agents.json"));
  const [selected, setSelected] = useState<string>("assistant");
  const [draft, setDraft] = useState<AgentDefinition | null>(null);
  const connected: boolean = useConnected();
  const agents: AgentDefinition[] = catalog.data?.value.agents ?? [];
  const agent: AgentDefinition | undefined = draft ?? agents.find(({ id }) => id === selected);
  const project: string | undefined = projects.data?.find(({ project }) => project?.pm?.agentId === agent?.id)?.project?.name;
  const choose = (id: string): void => {
    setDraft(null);
    setSelected(id);
  };
  const create = (kind: "pm" | "worker"): void => setDraft(newAgent(kind, agents));
  return <Page title="Agents" width={900} actions={<>
    <Button disabled={!connected || !catalog.data} onClick={() => create("pm")}>New Project Manager</Button>
    <Button disabled={!connected || !catalog.data} onClick={() => create("worker")}>New Worker</Button>
  </>}>
    <SidebarSection title="Agents" label="Agents">
      {(["assistant", "pm", "worker"] as const).map((kind) => agents.filter((entry) => entry.kind === kind).map((entry) =>
        <SidebarItem key={entry.id} active={agent?.id === entry.id} onClick={() => choose(entry.id)}>{entry.name}</SidebarItem>))}
    </SidebarSection>
    <ErrorText error={catalog.error ?? accounts.error ?? projects.error} />
    {agent && catalog.data && <AgentEditor key={agent.id} initial={agent} catalog={catalog.data} accounts={accounts.data?.value.accounts.filter(({ kind }) => kind === "model") ?? []}
      project={project} creating={draft !== null} disabled={!connected} onSaved={(id) => { choose(id); catalog.reload(); }}
      onDeleted={() => { choose("assistant"); catalog.reload(); }} />}
  </Page>;
}

function AgentEditor({ initial, catalog, accounts, project, creating, disabled, onSaved, onDeleted }: {
  initial: AgentDefinition;
  catalog: { value: AgentDefinitions; sha256: string };
  accounts: Account[];
  project?: string;
  creating: boolean;
  disabled: boolean;
  onSaved(id: string): void;
  onDeleted(): void;
}) {
  const [edit, setEdit] = useState<{ value: AgentDefinition; base: AgentDefinition | null; sha256: string } | null>(null);
  const agent: AgentDefinition = edit?.value ?? initial;
  const saved: AgentDefinition | null = edit ? edit.base : creating ? null : initial;
  const changeAgent = (update: (agent: AgentDefinition) => AgentDefinition): void => {
    setEdit((prior) => ({ value: update(prior?.value ?? initial), base: prior ? prior.base : saved, sha256: prior?.sha256 ?? catalog.sha256 }));
  };
  const [draft, setDraft] = useState<{ content: string; sha256: string | undefined } | null>(null);
  const [remove, setRemove] = useState<boolean>(false);
  const upload = useRef<HTMLInputElement>(null);
  const context = useData(() => creating ? Promise.resolve(undefined) : call("getAgentContext", { params: { id: agent.id } }), [agent.id, creating]);
  const content: string = draft?.content ?? context.data?.content ?? "";
  const duplicate: boolean = catalog.value.agents.some((entry) => entry.id !== agent.id && entry.name.toLowerCase() === agent.name.trim().toLowerCase());
  const dirty: boolean = JSON.stringify(agent) !== JSON.stringify(saved);
  const contextDirty: boolean = draft !== null && content !== (context.data?.content ?? "");
  const save = useAction(async () => {
    if (dirty) {
      const agents: AgentDefinition[] = saved ? catalog.value.agents.map((entry) => entry.id === agent.id ? agent : entry) : [...catalog.value.agents, agent];
      const value: AgentDefinitions = AgentDefinitions.parse({ ...catalog.value, agents });
      const { sha256 } = await call("putAgents", { body: { value, baseSha256: edit?.sha256 ?? catalog.sha256 } });
      setEdit({ value: agent, base: agent, sha256 });
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
    await call("putAgents", { body: { value: { ...catalog.value, agents: catalog.value.agents.filter(({ id }) => id !== agent.id) }, baseSha256: catalog.sha256 } });
    onDeleted();
  });
  const changeContent = (content: string): void => setDraft((prior) => ({ content, sha256: prior?.sha256 ?? context.data?.sha256 }));
  const readContext = useAction(async (file: File) => changeContent(await file.text()));
  const editable: boolean = !disabled && !save.busy && !destroy.busy;
  const contextEditable: boolean = editable && (creating || context.data !== undefined);
  const tooLong: boolean = agent.name.trim().length > (agent.kind === "pm" ? 24 : 80);
  const valid: boolean = !!agent.name.trim() && !duplicate && !tooLong && !!agent.model?.model && content.length <= 1_000_000;
  return <form className={s.form} onSubmit={(event) => { event.preventDefault(); if (editable && valid && (dirty || contextDirty)) void save.run(); }}>
    <Card title={kindLabels[agent.kind]} actions={<>
      {!creating && agent.kind !== "assistant" && <Button disabled={!editable || !!project} onClick={() => setRemove(true)}>Delete</Button>}
      <Button type="submit" variant="primary" disabled={!editable || !valid || (!dirty && !contextDirty)}>{saved ? "Save" : "Create"}</Button>
    </>}>
      <div className={s.fields}>
        {agent.kind === "pm" && <p className={ui.muted}>{project ? `Assigned to ${project}` : "Available for a project"}</p>}
        <div className={s.compaction}>
          <TextField label={agent.kind === "worker" ? "Title" : "Name"} value={agent.name} disabled={!editable}
            error={duplicate ? "This name is already in use." : tooLong ? "This name is too long." : undefined}
            onValueChange={(name) => changeAgent((entry) => ({ ...entry, name }))} />
          {agent.kind === "pm" && <label className={s.color}>Colour
            <input type="color" value={agent.color.toLowerCase()} disabled={!editable} onChange={(event) => {
              const color: string = event.target.value.toUpperCase();
              changeAgent((entry) => entry.kind === "pm" ? { ...entry, color } : entry);
            }} />
          </label>}
        </div>
        <ModelPicker accounts={accounts} choice={agent.model} disabled={!editable} onChoice={(model) => changeAgent((entry) => ({ ...entry, model }))} />
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
        {agent.kind !== "worker" && <Traits value={agent.traits} disabled={!editable}
          onChange={(traits: AssistantTraitId[]) => changeAgent((entry) => entry.kind === "worker" ? entry : { ...entry, traits })} />}
        <ErrorText error={save.error} />
      </div>
    </Card>
    <Card title="Initial context" actions={<Button disabled={!contextEditable || readContext.busy} onClick={() => upload.current?.click()}>Upload Markdown</Button>}>
      <input type="file" ref={upload} accept=".md,text/markdown" hidden onChange={(event) => {
        const file: File | undefined = event.target.files?.[0];
        event.target.value = "";
        if (file) void readContext.run(file);
      }} />
      <Sidecar isMarkdown paper content={content} disabled={!contextEditable} change={changeContent} className={s.markdown} />
      <ErrorText error={context.error ?? readContext.error ?? (content.length > 1_000_000 ? "Keep the Markdown file below 1,000,000 characters." : null)} />
    </Card>
    <Dialog open={remove} onOpenChange={setRemove} title={`Delete ${agent.name}?`} footer={<>
      <Button onClick={() => setRemove(false)}>Cancel</Button>
      <Button disabled={destroy.busy} onClick={() => void destroy.run()}>Delete</Button>
    </>}>
      <ErrorText error={destroy.error} />
    </Dialog>
  </form>;
}
