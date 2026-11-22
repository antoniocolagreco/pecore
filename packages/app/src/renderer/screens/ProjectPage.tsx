import { useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { ProjectManagerIdentity } from "@pecore/schemas";
import type { DefinitionEntry, DefinitionFile, ForgeAccount, Project, ProjectView } from "@pecore/schemas";
import { ProjectManagerField, projectManagerError } from "../components/ProjectManager";
import { call } from "../api/client";
import { useAction, useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { Button, Empty, ErrorText, Field, Page, ui } from "../components/ui";
import { Button as DsButton } from "../ds/button";
import { RadioGroup } from "../ds/choice";
import { Tabs } from "../ds/data";
import { Alert, Card, Spinner } from "../ds/feedback";
import { TextArea, TextField } from "../ds/field";
import { PlusIcon } from "../ds/icons";
import { Dialog } from "../ds/overlay";
import { Select } from "../ds/select";
import { JobTable, useJobs } from "./Jobs";
import { ProjectExportDialog } from "./ProjectShareDialogs";
import s from "./ProjectPage.module.css";

const pageSize: number = 100;

type Draft = { text: string; baseSha256: string | null };

function FileEditor({ file, path, onSaved }: {
  file: DefinitionFile | null;
  path: string;
  onSaved(file: DefinitionFile): void;
}) {
  const connected: boolean = useConnected();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [comparison, setComparison] = useState<{ sha256: string | null } | null>(null);
  const latestText: string = file?.content ?? "";
  const latestHash: string | null = file?.sha256 ?? null;
  const text: string = draft?.text ?? latestText;
  const changed: boolean = draft !== null && draft.baseSha256 !== latestHash;
  const comparing: boolean = comparison !== null && comparison.sha256 === latestHash;
  const save = useAction(async (baseSha256: string | null) => {
    const { sha256 } = await call("saveDefinition", { params: { path }, body: { content: text, baseSha256 } });
    setDraft(null);
    setComparison(null);
    onSaved({ path, content: text, sha256 });
  });
  const disabled: boolean = !connected || save.busy;
  return (
    <div className={ui.stack}>
      <Field label={path.split("/knowledge/")[1] ?? path}>
        <textarea className={s.editor} rows={10} spellCheck={false} disabled={disabled} value={text}
          onChange={(e) => setDraft({ text: e.target.value, baseSha256: draft ? draft.baseSha256 : latestHash })} />
      </Field>
      {changed && (
        <div className={ui.banner}>
          Changed elsewhere.
          <div className={ui.row}>
            <Button disabled={disabled} onClick={() => { setDraft(null); setComparison(null); save.clear(); }}>Reload</Button>
            <Button disabled={disabled} onClick={() => setComparison(comparing ? null : { sha256: latestHash })}>{comparing ? "Hide comparison" : "Compare"}</Button>
            {comparing && <Button disabled={disabled} onClick={() => void save.run(latestHash)}>Keep mine and save</Button>}
          </div>
        </div>
      )}
      {changed && comparing && <Field label="Current file"><textarea className={s.editor} rows={10} readOnly disabled={!connected} value={latestText} /></Field>}
      <ErrorText error={save.error} />
      <div>
        <Button kind="primary" disabled={disabled || changed || (file !== null && text === latestText)} onClick={() => void save.run(latestHash)}>
          {save.busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

function ExistingEditor({ path }: { path: string }) {
  const data = useData(() => call("getDefinition", { params: { path } }), [path], (m) => m.type === "definition.changed" && m.path === path);
  const [saved, setSaved] = useState<{ file: DefinitionFile; previous: DefinitionFile } | null>(null);
  const file: DefinitionFile | undefined = saved && data.data === saved.previous ? saved.file : data.data;
  return (
    <>
      <ErrorText error={data.error} />
      {data.loading && !file && <Empty>Loading file…</Empty>}
      {file && data.data && <FileEditor path={path} file={file} onSaved={(result) => {
        if (data.data) setSaved({ file: result, previous: data.data });
        data.reload();
      }} />}
    </>
  );
}

function Definitions({ id, kind }: { id: string; kind: "node" | "recipe" }) {
  const connected: boolean = useConnected();
  const dir: string = `projects/${id}/${kind}s`;
  const libraryDir: string = `library/${kind}s`;
  const entries = useData(() => call("listDefinitions", { query: { dir } }), [dir], (m) => m.type === "definition.changed" && m.path.startsWith(dir + "/"));
  const library = useData(() => kind === "node" ? call("listDefinitions", { query: { dir: libraryDir } }) : Promise.resolve([]), [libraryDir], (m) => m.type === "definition.changed" && m.path.startsWith(libraryDir + "/"));
  const navigate = useNavigate();
  const [name, setName] = useState<string>("");
  const [page, setPage] = useState<number>(0);
  const [result, setResult] = useState<string>("");
  const instantiate = useAction(async () => {
    const response = await call("instantiate", { body: { kind, name, project: id } });
    setResult(response.created.length === 0 ? "Template files already exist." : "Template instantiated.");
    entries.reload();
  });
  const files: DefinitionEntry[] = (entries.data ?? []).filter((entry) => entry.path.endsWith(".json"));
  const templates: DefinitionEntry[] = (library.data ?? []).filter((entry) => entry.path.endsWith(".json") && entry.errors.length === 0);
  const start: number = Math.min(page, Math.max(0, Math.ceil(files.length / pageSize) - 1)) * pageSize;
  return (
    <div className={ui.stack}>
      {kind === "recipe" && <div><DsButton variant="primary" icon={<PlusIcon />} disabled={!connected}
        onClick={() => void navigate(`/projects/${encodeURIComponent(id)}/recipes/new`)}>New Recipe</DsButton></div>}
      <ErrorText error={entries.error ?? library.error} />
      {entries.loading && !entries.data ? <Spinner /> :
        files.length === 0 && !entries.error ? <Empty>{kind === "node" ? "No nodes" : "No recipes"}</Empty> : (
          <ul className={s.files}>{files.slice(start, start + pageSize).map(({ path, errors }) => (
            <li key={path}>
              {connected
                ? <Link className={s.file} to={`/edit/${kind}/${path.split("/").map(encodeURIComponent).join("/")}`}>{path.slice(dir.length + 1).replace(/\.json$/, "")}</Link>
                : <span className={s.file}>{path.slice(dir.length + 1)}</span>}
              {errors.length > 0 && <span className={ui.error}> · Definition errors</span>}
            </li>
          ))}</ul>
        )}
      {files.length > pageSize && <div className={ui.row}>
        <Button disabled={!connected || start === 0} onClick={() => setPage(start / pageSize - 1)}>Previous</Button>
        <Button disabled={!connected || start + pageSize >= files.length} onClick={() => setPage(start / pageSize + 1)}>Show more</Button>
      </div>}
      {kind === "node" && <div className={s.instantiate}>
        <Select
          label="Add from the library"
          value={name || null}
          disabled={!connected || instantiate.busy || templates.length === 0}
          onValueChange={(v) => { setName(v ?? ""); setResult(""); }}
          options={templates.map(({ path }) => path.slice(libraryDir.length + 1, -5)).map((template) => ({ value: template, label: template }))}
          placeholder="Choose a template"
        />
        <Button disabled={!connected || instantiate.busy || !templates.some(({ path }) => path === `${libraryDir}/${name}.json`)}
          onClick={() => { setResult(""); void instantiate.run(); }}>Add to project</Button>
      </div>}
      <ErrorText error={instantiate.error} />
      {result && <p role="status">{result}</p>}
    </div>
  );
}

function Knowledge({ id }: { id: string }) {
  const connected: boolean = useConnected();
  const dir: string = `projects/${id}/knowledge`;
  const entries = useData(() => call("listDefinitions", { query: { dir } }), [dir], (m) => m.type === "definition.changed" && m.path.startsWith(dir + "/"));
  const [selected, setSelected] = useState<string>("");
  const [newName, setNewName] = useState<string>("");
  const [newPath, setNewPath] = useState<string>("");
  const [page, setPage] = useState<number>(0);
  const files: DefinitionEntry[] = (entries.data ?? []).filter((entry) => entry.path.endsWith(".md"));
  const start: number = Math.min(page, Math.max(0, Math.ceil(files.length / pageSize) - 1)) * pageSize;
  const name: string = newName.trim();
  const validName: boolean = /^[^/\\]+\.md$/.test(name) && !name.includes("\0") && name.length > 3;
  const exists: boolean = files.some((entry) => entry.path === `${dir}/${name}`);
  return (
    <div>
      <div className={ui.stack}>
        <span className={ui.muted}>Markdown notes every agent of this project reads: conventions, architecture, how to run the app.</span>
        <ErrorText error={entries.error} />
        {entries.loading && !entries.data && <Spinner />}
        {entries.data && files.length === 0 && <Empty>No knowledge files</Empty>}
        {files.length > 0 && (
          <ul className={s.files}>{files.slice(start, start + pageSize).map(({ path }) => (
            <li key={path}><button type="button" className={s.file} aria-pressed={path === selected} disabled={!connected} onClick={() => { setNewPath(""); setSelected(path); }}>{path.slice(dir.length + 1)}</button></li>
          ))}</ul>
        )}
        {files.length > pageSize && <div className={ui.row}>
          <Button disabled={!connected || start === 0} onClick={() => setPage(start / pageSize - 1)}>Previous</Button>
          <Button disabled={!connected || start + pageSize >= files.length} onClick={() => setPage(start / pageSize + 1)}>Show more</Button>
        </div>}
        <form className={s.instantiate} onSubmit={(e) => {
          e.preventDefault();
          if (connected && validName && !exists) { setNewPath(`${dir}/${name}`); setSelected(""); }
        }}>
          <TextField label="New Markdown file" mono placeholder="notes.md" value={newName} disabled={!connected} onValueChange={setNewName}
            error={exists ? "File already exists." : undefined} />
          <Button type="submit" disabled={!connected || !validName || exists}>New file</Button>
        </form>
        {newPath && <FileEditor key={newPath} path={newPath} file={null} onSaved={() => {
          entries.reload();
          setSelected(newPath);
          setNewPath("");
          setNewName("");
        }} />}
        {selected && <ExistingEditor key={selected} path={selected} />}
      </div>
    </div>
  );
}

type SettingsForm = { name: string; baseBranch: string; services: string; folder: string; remote: boolean; account: string; url: string; pm: ProjectManagerIdentity };

function ProjectSettings({ id, onSaved, projectActions, deleteNotice }: { id: string; onSaved(): void; projectActions: ReactNode; deleteNotice: ReactNode }) {
  const connected: boolean = useConnected();
  const path: string = `projects/${id}/project.json`;
  const file = useData(() => call("getDefinition", { params: { path } }), [path], (m) => m.type === "definition.changed" && m.path === path);
  const accounts = useData(() => call("getAccounts"), [], (m) => m.type === "definition.changed" && m.path === "accounts.json");
  const forgeAccounts: ForgeAccount[] = (accounts.data?.value.accounts ?? []).filter((account) => account.kind === "forge");
  const projects = useData(() => call("listProjects"), [], (m) => m.type === "project.updated");
  const usedManagers: ProjectManagerIdentity[] = (projects.data ?? []).flatMap(({ id: other, project }) => other !== id && project?.pm ? [project.pm] : []);
  const [draft, setDraft] = useState<{ values: SettingsForm; sha256: string } | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const raw: Record<string, unknown> | null = (() => {
    try {
      return file.data ? JSON.parse(file.data.content) as Record<string, unknown> : null;
    } catch {
      return null;
    }
  })();
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
      pm: { name: value.pm.name.trim(), color: value.pm.color },
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
  const valid: boolean = !!value.name.trim() && !!value.baseBranch.trim() && !!projects.data && projectManagerError(value.pm, usedManagers) === null && (!value.remote || existingRemote || (!!account && !!value.url.trim()));
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
      <ProjectManagerField value={value.pm} used={usedManagers} disabled={disabled} onChange={(pm) => set({ pm })} />
      <ErrorText error={projects.error} />
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

function NewJobDialog({ id, onClose }: { id: string; onClose(): void }) {
  const connected: boolean = useConnected();
  const dir: string = `projects/${id}/recipes`;
  const recipes = useData(() => call("listDefinitions", { query: { dir } }), [dir], (m) => m.type === "definition.changed" && m.path.startsWith(dir + "/"));
  const names: string[] = (recipes.data ?? []).filter(({ path, errors }) => path.endsWith(".json") && errors.length === 0).map(({ path }) => path.slice(dir.length + 1, -5));
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
  const [deleting, setDeleting] = useState<boolean>(false);
  const [exporting, setExporting] = useState<boolean>(false);
  const [creatingJob, setCreatingJob] = useState<boolean>(false);
  const data = useData(() => call("getProject", { params: { id } }), [id], (m) =>
    (m.type === "project.updated" && m.projectId === id) || (m.type === "definition.changed" && m.path.startsWith(`projects/${id}/`)),
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
    <Page title={project?.name ?? id} actions={project && !view?.creating &&
      <DsButton variant="primary" icon={<PlusIcon />} disabled={!connected} onClick={() => setCreatingJob(true)}>New job</DsButton>}>
      {creatingJob && <NewJobDialog id={id} onClose={() => setCreatingJob(false)} />}
      {exporting && <ProjectExportDialog id={id} onClose={() => setExporting(false)} />}
      <ErrorText error={data.error} />
      {data.loading && !view && <Spinner />}
      {view?.errors.map(({ file, path, message }, index) => <ErrorText key={index} error={`${file}${path ? ` · ${path}` : ""}: ${message}`} />)}
      {view?.creating ? <Alert tone="warning" actions={connected && <Link to={`/projects/new?resume=${id}`}>Resume creation</Link>}>This project was not fully created.</Alert> : project && (
        <>
          <Tabs
            defaultValue={query.get("tab") === "recipes" ? "recipes" : "jobs"}
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
              { value: "recipes", label: "Recipes", content: <Card padded className={s.narrow}><Definitions id={id} kind="recipe" /></Card> },
              { value: "nodes", label: "Nodes", content: <Card padded className={s.narrow}><Definitions id={id} kind="node" /></Card> },
              { value: "knowledge", label: "Knowledge", content: <Card padded className={s.narrow}><Knowledge id={id} /></Card> },
            ]}
          />
          <Dialog
            open={deleting}
            onOpenChange={(open) => { if (!open && !remove.busy) setDeleting(false); }}
            title={`Delete ${project.name}?`}
            description="&lt;PE/CORE&gt;'s copy of the repository, work folders, artifacts, logs, database, definitions and service containers are removed. Your project folder and the repositories and pull requests on the forge stay."
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
  return id ? <ProjectDetails key={id} id={id} /> : <Page title="Project"><Empty>Project not found</Empty></Page>;
}
