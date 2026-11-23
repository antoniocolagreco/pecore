import { useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { appName, ProjectManagerIdentity } from "@pecore/schemas";
import type { DefinitionEntry, ForgeAccount, Project, ProjectView } from "@pecore/schemas";
import { ProjectManagerField, useProjectManagers } from "../components/ProjectManager";
import { call } from "../api/client";
import { useAction, useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { DefinitionIcon, useDefinitionIcons } from "../components/DefinitionIcon";
import { Button, Empty, ErrorText, Page, ui } from "../components/ui";
import { Button as DsButton, IconButton } from "../ds/button";
import { RadioGroup } from "../ds/choice";
import { Table, Tabs } from "../ds/data";
import { Alert, Card, Spinner } from "../ds/feedback";
import { TextArea, TextField } from "../ds/field";
import { PlusIcon, TrashIcon } from "../ds/icons";
import { Dialog } from "../ds/overlay";
import { Select } from "../ds/select";
import { JobTable, useJobs } from "./Jobs";
import { KnowledgeBase } from "./KnowledgeBase";
import { object, string } from "./NodeEditor";
import { ProjectsSidebar } from "./Projects";
import { ProjectExportDialog } from "./ProjectShareDialogs";
import s from "./ProjectPage.module.css";

const pageSize: number = 100;

function Recipes({ id }: { id: string }) {
  const connected: boolean = useConnected();
  const icons = useDefinitionIcons();
  const dir: string = `projects/${id}/recipes`;
  const templatesDir: string = "templates/recipes";
  const entries = useData(() => call("listDefinitions", { query: { dir } }), [dir], (m) => m.type === "project.updated" && m.projectId === id);
  const available = useData(() => call("listDefinitions", { query: { dir: templatesDir } }), [], (m) => m.type === "definition.changed" && m.path.startsWith(templatesDir + "/"));
  const [name, setName] = useState<string>("");
  const [page, setPage] = useState<number>(0);
  const add = useAction(async () => {
    await call("instantiate", { body: { kind: "recipe", name, project: id } });
    setName("");
    entries.reload();
  });
  const remove = useAction(async (name: string) => {
    const path: string = `projects/${id}/project.json`;
    const project = await call("getDefinition", { params: { path } });
    const value = object(JSON.parse(project.content));
    if (!Array.isArray(value.recipes)) return;
    const content: string = JSON.stringify({ ...value, recipes: value.recipes.filter((recipe) => recipe !== name) }, null, 2) + "\n";
    await call("saveDefinition", { params: { path }, body: { content, baseSha256: project.sha256 } });
    entries.reload();
  });
  const files: DefinitionEntry[] = (entries.data ?? []).filter((entry) => entry.path.endsWith(".json"));
  const templates: DefinitionEntry[] = (available.data ?? []).filter((entry) => entry.path.endsWith(".json") && entry.errors.length === 0 && !files.some(({ path }) => entry.path === path));
  const start: number = Math.min(page, Math.max(0, Math.ceil(files.length / pageSize) - 1)) * pageSize;
  return (
    <div className={ui.stack}>
      <ErrorText error={entries.error ?? available.error} />
      {entries.loading && !entries.data ? <Spinner /> :
        files.length === 0 && !entries.error ? <Empty>No recipes selected</Empty> : (
          <ul className={s.files}>{files.slice(start, start + pageSize).map(({ path, value, errors }) => {
            const name: string = string(object(value).name);
            const label = <><DefinitionIcon icons={icons.data} type="recipe" name={name} selected={string(object(value).icon)} size="sm" /> {name}</>;
            return <li key={path}>
              {connected
                ? <Link className={s.file} to={`/edit/recipe/${path.split("/").map(encodeURIComponent).join("/")}`}>{label}</Link>
                : <span className={s.file}>{label}</span>}
              {errors.length > 0 && <span className={ui.error}> · Definition errors</span>}
              {path.startsWith("templates/") && <Button disabled={!connected || remove.busy} onClick={() => void remove.run(name)}>Remove</Button>}
            </li>;
          })}</ul>
        )}
      {files.length > pageSize && <div className={ui.row}>
        <Button disabled={!connected || start === 0} onClick={() => setPage(start / pageSize - 1)}>Previous</Button>
        <Button disabled={!connected || start + pageSize >= files.length} onClick={() => setPage(start / pageSize + 1)}>Show more</Button>
      </div>}
      <div className={s.instantiate}>
        <Select
          label="Add from templates"
          value={name || null}
          disabled={!connected || add.busy || templates.length === 0}
          onValueChange={(v) => setName(v ?? "")}
          options={templates.map(({ path }) => path.slice(templatesDir.length + 1, -5)).map((template) => ({ value: template, label: template }))}
          placeholder="Choose a template"
        />
        <Button disabled={!connected || add.busy || !name} onClick={() => void add.run()}>Add to project</Button>
      </div>
      <ErrorText error={add.error ?? remove.error} />
    </div>
  );
}


type SettingsForm = { name: string; baseBranch: string; services: string; folder: string; remote: boolean; account: string; url: string; pm: ProjectManagerIdentity };

function useProjectDefinition(id: string) {
  const path: string = `projects/${id}/project.json`;
  const file = useData(() => call("getDefinition", { params: { path } }), [path], (m) => m.type === "definition.changed" && m.path === path);
  const raw: Record<string, unknown> | null = (() => {
    try {
      return file.data ? JSON.parse(file.data.content) as Record<string, unknown> : null;
    } catch {
      return null;
    }
  })();
  return { path, file, raw };
}

function ProjectSettings({ id, onSaved, projectActions, deleteNotice }: { id: string; onSaved(): void; projectActions: ReactNode; deleteNotice: ReactNode }) {
  const connected: boolean = useConnected();
  const { path, file, raw } = useProjectDefinition(id);
  const accounts = useData(() => call("getAccounts"), [], (m) => m.type === "definition.changed" && m.path === "accounts.json");
  const forgeAccounts: ForgeAccount[] = (accounts.data?.value.accounts ?? []).filter((account) => account.kind === "forge");
  const { managers, ready: managersReady, error: managersError } = useProjectManagers(id);
  const [draft, setDraft] = useState<{ values: SettingsForm; sha256: string } | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const repo: Project["repo"] = raw?.repo as Project["repo"] | undefined ?? null;
  const current: SettingsForm | null = raw && {
    name: String(raw.name ?? ""),
    baseBranch: String(raw.baseBranch ?? "main"),
    services: typeof raw.services === "string" ? raw.services : "",
    folder: typeof raw.folder === "string" ? raw.folder : "",
    remote: repo !== null,
    account: repo?.account ?? "",
    url: repo?.url ?? "",
    pm: ProjectManagerIdentity.safeParse(raw.pm).data ?? { name: "", color: "#808080" },
  };
  const value: SettingsForm | null = draft?.values ?? current;
  const dirty: boolean = draft !== null && JSON.stringify(draft.values) !== JSON.stringify(current);
  const set = (changes: Partial<SettingsForm>): void => {
    if (file.data && value) setDraft({ values: { ...value, ...changes }, sha256: draft?.sha256 ?? file.data.sha256 });
  };
  const save = useAction(async () => {
    if (!raw || !value || !draft) return;
    const next = {
      ...raw,
      name: value.name.trim(),
      baseBranch: value.baseBranch.trim(),
      services: value.services.trim() || null,
      folder: value.folder.trim() || null,
      repo: value.remote ? { url: value.url.trim(), account: value.account } : null,
      createRepo: value.remote && value.url.trim() === repo?.url ? raw.createRepo ?? null : null,
      pm: value.pm,
    };
    Reflect.deleteProperty(next, "limits");
    Reflect.deleteProperty(next, "defaultRecipe");
    await call("saveDefinition", { params: { path }, body: { content: JSON.stringify(next, null, 2) + "\n", baseSha256: draft.sha256 } });
    setDraft(null);
    setSavedAt(Date.now());
    file.reload();
    onSaved();
  });
  if (!value || !current) return <ErrorText error={file.error ?? (file.data ? "project.json is not valid JSON." : null)} />;
  const disabled: boolean = !connected || save.busy;
  const folder: string | null = current.folder.replace(/\/+$/, "") || null;
  const account: ForgeAccount | undefined = forgeAccounts.find(({ id }) => id === value.account);
  const existingRemote: boolean = current.remote && value.account === current.account && value.url === current.url;
  const managerId: string = value.pm.agentId ?? `legacy-${id}`;
  const valid: boolean = !!value.name.trim() && !!value.baseBranch.trim() && managersReady && managers.some(({ agentId }) => agentId === managerId) && (!value.remote || existingRemote || (!!account && !!value.url.trim()));
  const pickCompose = async (): Promise<void> => {
    setPickError(null);
    const picked: string | null = await window.pecore.pickFile(folder);
    if (!picked) return;
    if (folder === null || !picked.startsWith(`${folder}/`)) setPickError(folder === null ? "This project has no folder: type the path in the repository." : `Choose a file inside ${folder}.`);
    else set({ services: picked.slice(folder.length + 1) });
  };
  return (
    <form className={s.form} onSubmit={(e) => { e.preventDefault(); if (dirty && valid && !disabled) void save.run(); }}>
      <dl className={`${ui.kv} ${s.details}`}>
        <dt>Project ID</dt><dd>{id}</dd>
      </dl>
      <div className={s.pair}>
        <TextField label="Name" value={value.name} onValueChange={(name) => set({ name })} disabled={disabled} error={value.name.trim() ? undefined : "Give the project a name."} />
        <TextField label="Base branch" mono value={value.baseBranch} onValueChange={(baseBranch) => set({ baseBranch })} disabled={disabled} description="New jobs start from here." />
      </div>
      <ProjectManagerField value={managerId} managers={managers} disabled={disabled || !managersReady} onChange={(pm) => set({ pm })} />
      <ErrorText error={managersError} />
      <RadioGroup label="Repository" value={value.remote ? "remote" : "local"} disabled={disabled}
        options={[{ value: "local", label: "Local only" }, { value: "remote", label: "Existing remote repository" }]}
        onValueChange={(mode) => set({ remote: mode === "remote", account: value.account || (forgeAccounts.length === 1 ? forgeAccounts[0]!.id : "") })} />
      {value.remote && <div className={s.pair}>
        <Select label="Forge account" value={account?.id ?? null} disabled={disabled || forgeAccounts.length === 0}
          options={forgeAccounts.map(({ id, host }) => ({ value: id, label: `${id} · ${host}` }))} placeholder="Select an account"
          onValueChange={(id) => set({ account: id ?? "", url: forgeAccounts.find((entry) => entry.id === id)?.host === account?.host ? value.url : "" })} />
        <TextField label="Repository URL" mono value={value.url} onValueChange={(url) => set({ url })} disabled={disabled || !account}
          placeholder={account ? `https://${account.host}/owner/name.git` : undefined} />
      </div>}
      {value.remote && <ErrorText error={accounts.error} />}
      {value.remote && accounts.data && forgeAccounts.length === 0 && <Alert tone="warning">Add a forge account in <Link to="/settings">Settings</Link>.</Alert>}
      {repo && (value.remote ? value.url.trim() !== repo.url : true) && <span className={ui.muted}>Changing the remote keeps your local files and the old repository. Review the project's recipes for the new setup.</span>}
      <TextField label="Folder" mono value={value.folder} onValueChange={(folder) => set({ folder })} disabled={disabled}
        description={folder ? "Enter a new path or choose an empty folder to move your copy of the code." : "Choose an existing checkout or an empty folder to create a local copy."}
        action={<DsButton disabled={disabled} onClick={() => void window.pecore.pickFolder().then((picked) => picked && set({ folder: picked }))}>Choose…</DsButton>} />
      <TextField label="Services compose file" mono value={value.services} onValueChange={(services) => { setPickError(null); set({ services }); }} disabled={disabled}
        placeholder="Automatic" error={pickError ?? undefined} description="Empty: a compose file at the repository root, if there is one."
        action={<DsButton disabled={disabled} onClick={() => void pickCompose()}>Choose…</DsButton>} />
      <ErrorText error={save.error} />
      {deleteNotice}
      <div className={s.formActions}>
        <div className={`${s.grow} ${ui.row}`}>{projectActions}</div>
        {savedAt && !dirty && <span className={ui.muted} role="status">Saved</span>}
        <DsButton disabled={!dirty || disabled} onClick={() => setDraft(null)}>Discard</DsButton>
        <DsButton type="submit" variant="primary" disabled={!dirty || !valid || disabled} loading={save.busy}>Save settings</DsButton>
      </div>
    </form>
  );
}

type VariableRow = { id: string; name: string; value: VariableValue };
type ScalarKind = "text" | "number" | "boolean" | "null";
type VariableValue = { kind: ScalarKind; text: string } | { kind: "object" | "list"; rows: VariableRow[] };

const variableKinds: { value: VariableValue["kind"]; label: string }[] = [
  { value: "text", label: "Text" }, { value: "number", label: "Number" },
  { value: "boolean", label: "Yes / No" }, { value: "null", label: "Null" },
  { value: "list", label: "List" }, { value: "object", label: "Object" },
];

function variableValue(value: unknown): VariableValue {
  if (value === null) return { kind: "null", text: "" };
  if (typeof value === "object") return {
    kind: Array.isArray(value) ? "list" : "object",
    rows: Object.entries(value).map(([name, item], index) => ({ id: String(index), name, value: variableValue(item) })),
  };
  if (typeof value === "boolean" || typeof value === "number") return { kind: typeof value === "boolean" ? "boolean" : "number", text: String(value) };
  return { kind: "text", text: String(value) };
}

function newVariable(): VariableRow {
  return { id: crypto.randomUUID(), name: "", value: { kind: "text", text: "" } };
}

function VariableTypeSelect({ value, disabled, onChange }: { value: VariableValue; disabled: boolean; onChange(value: VariableValue): void }) {
  return <Select ariaLabel="Value type" value={value.kind} options={variableKinds} disabled={disabled} onValueChange={(next) => {
      const kind: VariableValue["kind"] | undefined = variableKinds.find((option) => option.value === next)?.value;
      if (!kind || kind === value.kind) return;
      if (kind === "list" || kind === "object") {
        const rows: VariableRow[] = "rows" in value ? value.rows : [];
        onChange({ kind, rows: kind === "object" && value.kind === "list" ? rows.map((row, index) => ({ ...row, name: String(index) })) : rows });
      } else onChange({ kind, text: kind === "boolean" ? "true" : kind === "null" || !("text" in value) ? "" : value.text });
  }} />;
}

function VariableCell({ value, disabled, onChange }: { value: VariableValue; disabled: boolean; onChange(value: VariableValue): void }) {
  if ("rows" in value) return <details className={s.nestedValues}>
      <summary>{value.rows.length} {value.kind === "list" ? "items" : "keys"}</summary>
      <VariableTable label={value.kind === "list" ? "List items" : "Object keys"} keyLabel={value.kind === "object" ? "Key" : undefined}
        rows={value.rows} disabled={disabled} onChange={(rows) => onChange({ ...value, rows })} />
      <DsButton size="sm" icon={<PlusIcon />} disabled={disabled} onClick={() => onChange({ ...value, rows: [...value.rows, newVariable()] })}>{value.kind === "list" ? "Add item" : "Add key"}</DsButton>
    </details>;
  if (value.kind === "null") return null;
  if (value.kind === "boolean") return <Select ariaLabel="Value" value={value.text} options={[{ value: "true", label: "Yes" }, { value: "false", label: "No" }]}
    disabled={disabled} onValueChange={(text) => { if (text) onChange({ ...value, text }); }} />;
  return value.text.includes("\n")
    ? <TextArea ariaLabel="Value" mono value={value.text} disabled={disabled} onValueChange={(text) => onChange({ ...value, text })} />
    : <TextField ariaLabel="Value" mono value={value.text} disabled={disabled} onValueChange={(text) => onChange({ ...value, text })} />;
}

function VariableTable({ label, keyLabel, rows, disabled, onChange }: {
  label: string; keyLabel?: string; rows: VariableRow[]; disabled: boolean;
  onChange(rows: VariableRow[]): void;
}) {
  const update = (id: string, changes: Partial<Pick<VariableRow, "name" | "value">>): void => onChange(rows.map((row) => row.id === id ? { ...row, ...changes } : row));
  return <div className={s.variableTable}><Table label={label} rows={rows} rowKey={(row) => row.id} columns={[
    ...(keyLabel ? [{ key: "name", header: keyLabel, width: "30%", cell: (row: VariableRow) => <TextField ariaLabel={keyLabel} autoFocus={!row.name} mono disabled={disabled} value={row.name} onValueChange={(name) => update(row.id, { name })} /> }] : []),
    { key: "type", header: "Type", width: "9.5rem", cell: (row) => <VariableTypeSelect value={row.value} disabled={disabled} onChange={(value) => update(row.id, { value })} /> },
    { key: "value", header: "Value", cell: (row) => <VariableCell value={row.value} disabled={disabled} onChange={(value) => update(row.id, { value })} /> },
    { key: "remove", header: "", width: "3rem", cell: (row) => <IconButton label={row.name ? `Remove ${row.name}` : "Remove row"} icon={<TrashIcon />}
      disabled={disabled} onClick={() => onChange(rows.filter(({ id }) => id !== row.id))} /> },
  ]} /></div>;
}

function rowsToRecord(rows: VariableRow[], parent?: string): Record<string, unknown> {
  const label: string = parent === undefined ? "variable" : "key";
  const names: Set<string> = new Set();
  return Object.fromEntries(rows.map(({ name, value }) => {
    if (!name.trim()) throw new Error(`Enter a name for each ${label}.`);
    if (names.has(name)) throw new Error(`Duplicate ${label} name: ${name}.`);
    names.add(name);
    return [name, parseVariable(value, parent === undefined ? name : `${parent}.${name}`)];
  }));
}

function parseVariable(value: VariableValue, name: string): unknown {
  if ("rows" in value) return value.kind === "list"
    ? value.rows.map((row, index) => parseVariable(row.value, `${name}[${index}]`))
    : rowsToRecord(value.rows, name);
  if (value.kind === "null") return null;
  if (value.kind === "boolean") return value.text === "true";
  if (value.kind === "text") return value.text;
  const number: number = Number(value.text);
  if (!value.text.trim() || !Number.isFinite(number)) throw new Error(`Enter a number for ${name}.`);
  return number;
}

function ProjectVariables({ id, onSaved }: { id: string; onSaved(): void }) {
  const connected: boolean = useConnected();
  const { path, file, raw } = useProjectDefinition(id);
  const [draft, setDraft] = useState<{ rows: VariableRow[]; sha256: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const current: VariableRow[] | null = raw && Object.entries(object(raw.variables))
    .map(([name, value], index) => ({ id: String(index), name, value: variableValue(value) }));
  const rows: VariableRow[] | null = draft?.rows ?? current;
  const dirty: boolean = !!draft && JSON.stringify(draft.rows) !== JSON.stringify(current);
  const set = (rows: VariableRow[]): void => {
    if (file.data) setDraft({ rows, sha256: draft?.sha256 ?? file.data.sha256 });
    setSaved(false);
  };
  const save = useAction(async () => {
    if (!raw || !draft) return;
    const content: string = JSON.stringify({ ...raw, variables: rowsToRecord(draft.rows) }, null, 2) + "\n";
    await call("saveDefinition", { params: { path }, body: { content, baseSha256: draft.sha256 } });
    setDraft(null);
    setSaved(true);
    file.reload();
    onSaved();
  });
  if (!rows) return file.loading ? <Spinner /> : <ErrorText error={file.error ?? "Unable to read the project definition."} />;
  const disabled: boolean = !connected || save.busy;
  return (
    <form className={s.form} onSubmit={(event) => { event.preventDefault(); if (dirty && !disabled) void save.run(); }}>
      <section className={s.keyValues}>
        <h2>Project variables</h2>
        <p className={ui.muted}>A recipe can use a variable such as <code>build-dir</code> with <code>{"{project.vars.build-dir}"}</code>.</p>
        <VariableTable label="Project variables" keyLabel="Name" rows={rows} disabled={disabled} onChange={set} />
      </section>
      <ErrorText error={save.error ?? file.error} />
      <div className={s.formActions}>
        <div className={`${s.grow} ${ui.row}`}>
          <DsButton icon={<PlusIcon />} disabled={disabled} onClick={() => set([...rows, newVariable()])}>Add variable</DsButton>
        </div>
        {saved && <span className={ui.muted} role="status">Saved</span>}
        <DsButton disabled={!dirty || disabled} onClick={() => { setDraft(null); save.clear(); }}>Discard</DsButton>
        <DsButton type="submit" variant="primary" disabled={!dirty || disabled} loading={save.busy}>Save changes</DsButton>
      </div>
    </form>
  );
}

function NewJobDialog({ id, onClose }: { id: string; onClose(): void }) {
  const connected: boolean = useConnected();
  const dir: string = `projects/${id}/recipes`;
  const recipes = useData(() => call("listDefinitions", { query: { dir } }), [dir], (m) => m.type === "project.updated" && m.projectId === id);
  const names: string[] = (recipes.data ?? []).filter(({ path, errors }) => path.endsWith(".json") && errors.length === 0).map(({ value }) => string(object(value).name));
  const [title, setTitle] = useState<string>("");
  const [text, setText] = useState<string>("");
  const [chosen, setChosen] = useState<string | null>(null);
  const recipe: string | null = chosen ?? (names.length === 1 ? names[0]! : null);
  const valid: boolean = !!title.trim() && !!text.trim() && recipe !== null;
  const create = useAction(async () => {
    await call("createJob", { body: { project: id, recipe: recipe!, title: title.trim(), ticket: { text: text.trim() }, parentJobId: null } });
    onClose();
  });
  const disabled: boolean = !connected || create.busy;
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !create.busy) onClose(); }} title="New job" width={560}
      footer={<>
        <DsButton disabled={create.busy} onClick={onClose}>Cancel</DsButton>
        <DsButton variant="primary" loading={create.busy} disabled={disabled || !valid} onClick={() => void create.run()}>Create job</DsButton>
      </>}>
      <form className={s.form} onSubmit={(e) => { e.preventDefault(); if (valid && !disabled) void create.run(); }}>
        <TextField label="Title" required autoFocus value={title} onValueChange={setTitle} disabled={disabled} placeholder="e.g. Add dark mode" />
        <TextArea label="What to do" required value={text} onValueChange={setText} disabled={disabled} placeholder="Describe the change, as in a ticket." />
        {recipes.data && names.length === 0
          ? <Alert tone="warning">This project has no recipes. Add one in the Recipes tab.</Alert>
          : <Select label="Recipe" value={recipe} onValueChange={setChosen} disabled={disabled || names.length < 2} options={names.map((name) => ({ value: name, label: name }))} />}
        <ErrorText error={recipes.error ?? create.error} />
      </form>
    </Dialog>
  );
}

function ProjectDetails({ id }: { id: string }) {
  const connected: boolean = useConnected();
  const navigate = useNavigate();
  const [query] = useSearchParams();
  const tab: string | null = query.get("tab");
  const [activeTab, setActiveTab] = useState<string>(tab === "recipes" || tab === "variables" || tab === "knowledge" ? tab : "jobs");
  const [deleting, setDeleting] = useState<boolean>(false);
  const [exporting, setExporting] = useState<boolean>(false);
  const [creatingJob, setCreatingJob] = useState<boolean>(false);
  const data = useData(() => call("getProject", { params: { id } }), [id], (m) =>
    (m.type === "project.updated" && m.projectId === id) || (m.type === "definition.changed" && (m.path.startsWith(`projects/${id}/`) || m.path === "agents.json")),
  );
  const jobs = useJobs("false", id);
  const running: boolean = jobs.data?.some((job) => job.state === "running") ?? false;
  const remove = useAction(async () => {
    await call("deleteProject", { params: { id } });
    await navigate("/projects");
  });
  const view: ProjectView | undefined = data.data;
  const project: ProjectView["project"] | undefined = view?.project;
  return (
    <Page title={project?.name ?? id} fillHeight={activeTab === "knowledge"} actions={project && !view?.creating &&
      <DsButton variant="primary" icon={<PlusIcon />} disabled={!connected} onClick={() => setCreatingJob(true)}>New job</DsButton>}>
      {creatingJob && <NewJobDialog id={id} onClose={() => setCreatingJob(false)} />}
      {exporting && <ProjectExportDialog id={id} onClose={() => setExporting(false)} />}
      <ErrorText error={data.error} />
      {data.loading && !view && <Spinner />}
      {view?.errors.map(({ file, path, message }, index) => <ErrorText key={index} error={`${file}${path ? ` · ${path}` : ""}: ${message}`} />)}
      {view?.creating ? <Alert tone="warning" actions={connected && <Link to={`/projects/new?resume=${id}`}>Resume creation</Link>}>This project was not fully created.</Alert> : project && (
        <>
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            fill={activeTab === "knowledge"}
            tabs={[
              {
                value: "jobs",
                label: "Jobs",
                content: <><ErrorText error={jobs.error} /><JobTable jobs={jobs.data ?? []} project={false} loading={jobs.loading} empty="No jobs in this project yet." /></>,
              },
              {
                value: "settings",
                label: "Settings",
                content: (
                  <Card padded className={s.narrow}>
                    <ProjectSettings
                      id={id}
                      onSaved={data.reload}
                      projectActions={<>
                        <DsButton variant="danger" disabled={!connected || !jobs.data || !!jobs.error || running} onClick={() => setDeleting(true)}>Delete project</DsButton>
                        <DsButton disabled={!connected} onClick={() => setExporting(true)}>Export</DsButton>
                      </>}
                      deleteNotice={<>
                        <ErrorText error={jobs.error} />
                        {running && <span className={ui.muted}>Stop the running jobs, in the Jobs tab, before deleting this project.</span>}
                      </>}
                    />
                  </Card>
                ),
              },
              { value: "variables", label: "Variables", content: <Card padded className={s.narrow}><ProjectVariables id={id} onSaved={data.reload} /></Card> },
              { value: "recipes", label: "Recipes", content: <Card padded className={s.narrow}><Recipes id={id} /></Card> },
              { value: "knowledge", label: "Knowledge", content: <KnowledgeBase id={id} /> },
            ]}
          />
          <Dialog
            open={deleting}
            onOpenChange={(open) => { if (!open && !remove.busy) setDeleting(false); }}
            title={`Delete ${project.name}?`}
            description={`${appName}'s copy of the repository, work folders, artifacts, logs, database, definitions and service containers are removed. Your project folder and the repositories and pull requests on the forge stay.`}
            width={460}
            footer={<>
              <Button disabled={!connected || remove.busy} onClick={() => setDeleting(false)}>Cancel</Button>
              <DsButton variant="dangerSolid" loading={remove.busy} disabled={!connected || !jobs.data || !!jobs.error || running} onClick={() => void remove.run()}>Delete project</DsButton>
            </>}
          >
            {running && <span>Stop the running jobs first.</span>}
            <ErrorText error={remove.error} />
          </Dialog>
        </>
      )}
    </Page>
  );
}

export function ProjectPage() {
  const { id } = useParams();
  return <>
    <ProjectsSidebar active={id} />
    {id ? <ProjectDetails key={id} id={id} /> : <Page title="Project"><Empty>Project not found</Empty></Page>}
  </>;
}
