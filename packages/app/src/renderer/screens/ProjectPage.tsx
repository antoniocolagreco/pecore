import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { DefinitionEntry, DefinitionFile, ProjectView } from "@pecore/schemas";
import { call } from "../api/client";
import { useAction, useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { ConfirmItem } from "../components/ConfirmItem";
import { Button, Empty, ErrorText, Field, Page, Panel, ui } from "../components/ui";
import { Button as DsButton } from "../ds/button";
import { Tabs } from "../ds/data";
import { Alert, Card, Spinner } from "../ds/feedback";
import { TextField } from "../ds/field";
import { LinkIcon } from "../ds/icons";
import { Dialog } from "../ds/overlay";
import { Select } from "../ds/select";
import s from "./ProjectPage.module.css";

const pageSize: number = 100;

type Draft = { text: string; baseSha256: string | null };

function projectText(content: string, editable?: string): string {
  const original: Record<string, unknown> = JSON.parse(content);
  if (editable === undefined) {
    const fields: Record<string, unknown> = { ...original };
    delete fields.id;
    delete fields.repo;
    return JSON.stringify(fields, null, 2);
  }
  const fields: unknown = JSON.parse(editable);
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw new Error("Enter a JSON object");
  return JSON.stringify({ ...fields, id: original.id, repo: original.repo }, null, 2) + "\n";
}

function FileEditor({ file, path, project, onSaved }: {
  file: DefinitionFile | null;
  path: string;
  project?: boolean;
  onSaved(file: DefinitionFile): void;
}) {
  const connected: boolean = useConnected();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [comparison, setComparison] = useState<{ sha256: string | null } | null>(null);
  const latestText: string = file ? project ? projectText(file.content) : file.content : "";
  const latestHash: string | null = file?.sha256 ?? null;
  const text: string = draft?.text ?? latestText;
  const changed: boolean = draft !== null && draft.baseSha256 !== latestHash;
  const comparing: boolean = comparison !== null && comparison.sha256 === latestHash;
  const save = useAction(async (baseSha256: string | null) => {
    const content: string = project && file ? projectText(file.content, text) : text;
    const { sha256 } = await call("saveDefinition", { params: { path }, body: { content, baseSha256 } });
    setDraft(null);
    setComparison(null);
    onSaved({ path, content, sha256 });
  });
  const disabled: boolean = !connected || save.busy;
  return (
    <div className={ui.stack}>
      <Field label={project ? "Project settings (JSON)" : path.split("/knowledge/")[1] ?? path}>
        <textarea className={s.editor} rows={project ? 13 : 10} spellCheck={false} disabled={disabled} value={text}
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

function ExistingEditor({ path, project, onSaved }: { path: string; project?: boolean; onSaved?(): void }) {
  const data = useData(() => call("getDefinition", { params: { path } }), [path], (m) => m.type === "definition.changed" && m.path === path);
  const [saved, setSaved] = useState<{ file: DefinitionFile; previous: DefinitionFile } | null>(null);
  const file: DefinitionFile | undefined = saved && data.data === saved.previous ? saved.file : data.data;
  const valid: boolean = !project || !file || (() => {
    try {
      const value: unknown = JSON.parse(file.content);
      return value !== null && typeof value === "object" && !Array.isArray(value);
    } catch {
      return false;
    }
  })();
  return (
    <>
      <ErrorText error={data.error} />
      {!valid && <ErrorText error="Project settings must be a JSON object." />}
      {data.loading && !file && <Empty>Loading file…</Empty>}
      {file && data.data && valid && <FileEditor path={path} file={file} project={project} onSaved={(result) => {
        if (data.data) setSaved({ file: result, previous: data.data });
        data.reload();
        onSaved?.();
      }} />}
    </>
  );
}

function Definitions({ id, kind }: { id: string; kind: "node" | "recipe" }) {
  const connected: boolean = useConnected();
  const dir: string = `projects/${id}/${kind}s`;
  const libraryDir: string = `library/${kind}s`;
  const entries = useData(() => call("listDefinitions", { query: { dir } }), [dir], (m) => m.type === "definition.changed" && m.path.startsWith(dir + "/"));
  const library = useData(() => call("listDefinitions", { query: { dir: libraryDir } }), [libraryDir], (m) => m.type === "definition.changed" && m.path.startsWith(libraryDir + "/"));
  const [name, setName] = useState<string>("");
  const [page, setPage] = useState<number>(0);
  const [confirmIds, setConfirmIds] = useState<string[]>([]);
  const [confirmPage, setConfirmPage] = useState<number>(0);
  const [result, setResult] = useState<string>("");
  const instantiate = useAction(async () => {
    const response = await call("instantiate", { body: { kind, name, project: id } });
    setConfirmIds((ids) => [...new Set([...ids, ...response.confirmItemIds])]);
    setResult(response.created.length === 0 ? "Template files already exist." : "Template instantiated.");
    entries.reload();
  });
  const files: DefinitionEntry[] = (entries.data ?? []).filter((entry) => entry.path.endsWith(".json"));
  const templates: DefinitionEntry[] = (library.data ?? []).filter((entry) => entry.path.endsWith(".json") && entry.errors.length === 0);
  const start: number = Math.min(page, Math.max(0, Math.ceil(files.length / pageSize) - 1)) * pageSize;
  return (
    <div className={ui.stack}>
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
      <div className={s.instantiate}>
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
      </div>
      <ErrorText error={instantiate.error} />
      {result && <p role="status">{result}</p>}
      {confirmIds.length > 0 && <div className={ui.stack}>
        {confirmIds.slice(confirmPage * 10, (confirmPage + 1) * 10).map((itemId) => <Panel key={itemId}><ConfirmItem itemId={itemId} /></Panel>)}
        {confirmIds.length > 10 && <div className={ui.row}>
          <Button disabled={!connected || confirmPage === 0} onClick={() => setConfirmPage(confirmPage - 1)}>Previous</Button>
          <Button disabled={!connected || (confirmPage + 1) * 10 >= confirmIds.length} onClick={() => setConfirmPage(confirmPage + 1)}>Show more</Button>
        </div>}
      </div>}
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

type SettingsForm = { name: string; baseBranch: string; defaultRecipe: string; services: string };

function ProjectSettings({ id, onSaved }: { id: string; onSaved(): void }) {
  const connected: boolean = useConnected();
  const path: string = `projects/${id}/project.json`;
  const file = useData(() => call("getDefinition", { params: { path } }), [path], (m) => m.type === "definition.changed" && m.path === path);
  const recipes = useData(() => call("listDefinitions", { query: { dir: `projects/${id}/recipes` } }), [id], (m) => m.type === "definition.changed" && m.path.startsWith(`projects/${id}/recipes/`));
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const raw: Record<string, unknown> | null = (() => {
    try {
      return file.data ? JSON.parse(file.data.content) as Record<string, unknown> : null;
    } catch {
      return null;
    }
  })();
  const current: SettingsForm | null = raw && {
    name: String(raw.name ?? ""),
    baseBranch: String(raw.baseBranch ?? "main"),
    defaultRecipe: String(raw.defaultRecipe ?? ""),
    services: typeof raw.services === "string" ? raw.services : "",
  };
  const value: SettingsForm | null = form ?? current;
  const dirty: boolean = form !== null && JSON.stringify(form) !== JSON.stringify(current);
  const set = (changes: Partial<SettingsForm>) => value && setForm({ ...value, ...changes });
  const save = useAction(async () => {
    if (!raw || !value || !file.data) return;
    const next = {
      ...raw,
      name: value.name.trim(),
      baseBranch: value.baseBranch.trim(),
      defaultRecipe: value.defaultRecipe || null,
      services: value.services.trim() || null,
    };
    Reflect.deleteProperty(next, "limits");
    await call("saveDefinition", { params: { path }, body: { content: JSON.stringify(next, null, 2) + "\n", baseSha256: file.data.sha256 } });
    setForm(null);
    setSavedAt(Date.now());
    file.reload();
    onSaved();
  });
  if (!value) return <ErrorText error={file.error ?? (file.data ? "project.json is not valid JSON." : null)} />;
  const recipeNames: string[] = (recipes.data ?? []).filter((r) => r.path.endsWith(".json")).map((r) => r.path.split("/").pop()!.replace(/\.json$/, ""));
  const disabled: boolean = !connected || save.busy;
  return (
    <form className={s.form} onSubmit={(e) => { e.preventDefault(); if (dirty) void save.run(); }}>
      <div className={s.pair}>
        <TextField label="Name" value={value.name} onValueChange={(name) => set({ name })} disabled={disabled} error={value.name.trim() ? undefined : "Give the project a name."} />
        <TextField label="Base branch" mono value={value.baseBranch} onValueChange={(baseBranch) => set({ baseBranch })} disabled={disabled} description="New jobs start from here." />
      </div>
      <Select label="Default recipe" value={value.defaultRecipe || null} onValueChange={(v) => set({ defaultRecipe: v ?? "" })} disabled={disabled}
        options={recipeNames.map((name) => ({ value: name, label: name }))} description="Used when a job does not choose one." />
      <TextField label="Services compose file" mono value={value.services} onValueChange={(services) => set({ services })} disabled={disabled}
        placeholder="compose.yaml" description="Containers PeCore starts for each job, relative to the repository." />
      <ErrorText error={save.error} />
      <div className={s.formActions}>
        {savedAt && !dirty && <span className={ui.muted} role="status">Saved</span>}
        <DsButton disabled={!dirty || disabled} onClick={() => setForm(null)}>Discard</DsButton>
        <DsButton type="submit" variant="primary" disabled={!dirty || !value.name.trim() || !value.baseBranch.trim()} loading={save.busy}>Save settings</DsButton>
      </div>
    </form>
  );
}

function ProjectDetails({ id }: { id: string }) {
  const connected: boolean = useConnected();
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState<boolean>(false);
  const data = useData(() => call("getProject", { params: { id } }), [id], (m) =>
    (m.type === "project.updated" && m.projectId === id) || (m.type === "definition.changed" && m.path.startsWith(`projects/${id}/`)),
  );
  const jobs = useData(() => call("listJobs", { query: { project: id } }), [id], (m) => m.type === "job.updated" && m.projectId === id);
  const running: boolean = jobs.data?.some((job) => job.state === "running") ?? false;
  const remove = useAction(async () => {
    await call("deleteProject", { params: { id } });
    await navigate("/projects");
  });
  const view: ProjectView | undefined = data.data;
  const project: ProjectView["project"] | undefined = view?.project;
  const jobsLink = <Button disabled={!connected} onClick={() => void navigate(`/jobs?project=${encodeURIComponent(id)}`)}>Jobs of this project</Button>;
  return (
    <Page title={project?.name ?? id} actions={jobsLink}>
      {project && (
        <div className={s.meta}>
          <span className={s.metaItem}><LinkIcon />{project.repo?.url ?? "Local only"}</span>
          {project.repo && <span className={s.metaItem}>Account {project.repo.account}</span>}
          <span className={s.metaItem}>ID <code>{id}</code></span>
        </div>
      )}
      <ErrorText error={data.error} />
      {data.loading && !view && <Spinner />}
      {view?.errors.map(({ file, path, message }, index) => <ErrorText key={index} error={`${file}${path ? ` · ${path}` : ""}: ${message}`} />)}
      {view?.creating ? <Alert tone="warning" actions={connected && <Link to={`/projects/new?resume=${id}`}>Resume creation</Link>}>This project was not fully created.</Alert> : project && (
        <>
          <Card padded>
            <Tabs
              tabs={[
                {
                  value: "settings",
                  label: "Settings",
                  content: (
                    <div className={ui.stack}>
                      <ProjectSettings id={id} onSaved={data.reload} />
                      <details className={s.advanced}>
                        <summary>Edit project.json</summary>
                        <ExistingEditor project path={`projects/${id}/project.json`} onSaved={data.reload} />
                      </details>
                    </div>
                  ),
                },
                { value: "recipes", label: "Recipes", content: <Definitions id={id} kind="recipe" /> },
                { value: "nodes", label: "Nodes", content: <Definitions id={id} kind="node" /> },
                { value: "knowledge", label: "Knowledge", content: <Knowledge id={id} /> },
              ]}
            />
          </Card>
          <Card title="Danger zone">
            <div className={s.danger}>
              <span className={ui.muted}>Deletes the project folder, work folders, artifacts, logs and history. The forge is untouched.</span>
              <Button kind="danger" disabled={!connected || !jobs.data || !!jobs.error || running} onClick={() => setDeleting(true)}>Delete project</Button>
            </div>
            <ErrorText error={jobs.error} />
            {running && <div className={ui.row}><span>Stop the running jobs before deleting this project.</span>{jobsLink}</div>}
          </Card>
          <Dialog
            open={deleting}
            onOpenChange={(open) => { if (!open && !remove.busy) setDeleting(false); }}
            title={`Delete ${project.name}?`}
            description="Its folder, work folders, artifacts, logs, database, definitions and service containers are removed. Repositories and pull requests on the forge stay there."
            width={460}
            footer={<>
              <Button disabled={!connected || remove.busy} onClick={() => setDeleting(false)}>Cancel</Button>
              <DsButton variant="dangerSolid" loading={remove.busy} disabled={!connected || !jobs.data || !!jobs.error || running} onClick={() => void remove.run()}>Delete project</DsButton>
            </>}
          >
            {running && <div className={ui.row}><span>Stop the running jobs first.</span>{jobsLink}</div>}
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
