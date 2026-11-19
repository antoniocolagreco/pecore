import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { DefinitionEntry, DefinitionFile, ProjectView } from "@pecore/schemas";
import { call } from "../api/client";
import { useAction, useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { ConfirmItem } from "../components/ConfirmItem";
import { Button, Empty, ErrorText, Field, Modal, Page, Panel, ui } from "../components/ui";
import { useProjectFilter } from "../shell/filter";
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
    <Panel>
      <h2 className={ui.title}>{kind === "node" ? "Nodes" : "Recipes"}</h2>
      <ErrorText error={entries.error ?? library.error} />
      {entries.loading && !entries.data ? <Empty>Loading…</Empty> :
        files.length === 0 && !entries.error ? <Empty>{kind === "node" ? "No nodes" : "No recipes"}</Empty> : (
          <ul>{files.slice(start, start + pageSize).map(({ path, errors }) => (
            <li key={path}>
              {connected ? <Link to={`/edit/${kind}/${path.split("/").map(encodeURIComponent).join("/")}`}>{path.slice(dir.length + 1)}</Link> : path.slice(dir.length + 1)}
              {errors.length > 0 && <span className={ui.error}> · Definition errors</span>}
            </li>
          ))}</ul>
        )}
      {files.length > pageSize && <div className={ui.row}>
        <Button disabled={!connected || start === 0} onClick={() => setPage(start / pageSize - 1)}>Previous</Button>
        <Button disabled={!connected || start + pageSize >= files.length} onClick={() => setPage(start / pageSize + 1)}>Show more</Button>
      </div>}
      <div className={ui.row}>
        <Field label="Library template">
          <select value={name} disabled={!connected || instantiate.busy || templates.length === 0} onChange={(e) => { setName(e.target.value); setResult(""); }}>
            <option value="">Select a template</option>
            {templates.map(({ path }) => {
              const template: string = path.slice(libraryDir.length + 1, -5);
              return <option key={path} value={template}>{template}</option>;
            })}
          </select>
        </Field>
        <Button disabled={!connected || instantiate.busy || !templates.some(({ path }) => path === `${libraryDir}/${name}.json`)}
          onClick={() => { setResult(""); void instantiate.run(); }}>Instantiate from library</Button>
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
    </Panel>
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
    <Panel>
      <h2 className={ui.title}>Knowledge</h2>
      <div className={ui.stack}>
        <ErrorText error={entries.error} />
        {entries.loading && !entries.data && <Empty>Loading…</Empty>}
        {entries.data && files.length === 0 && <Empty>No knowledge files</Empty>}
        {files.length > 0 && (
          <ul>{files.slice(start, start + pageSize).map(({ path }) => (
            <li key={path}><Button aria-pressed={path === selected} disabled={!connected} onClick={() => { setNewPath(""); setSelected(path); }}>{path.slice(dir.length + 1)}</Button></li>
          ))}</ul>
        )}
        {files.length > pageSize && <div className={ui.row}>
          <Button disabled={!connected || start === 0} onClick={() => setPage(start / pageSize - 1)}>Previous</Button>
          <Button disabled={!connected || start + pageSize >= files.length} onClick={() => setPage(start / pageSize + 1)}>Show more</Button>
        </div>}
        <form className={ui.row} onSubmit={(e) => {
          e.preventDefault();
          if (connected && validName && !exists) { setNewPath(`${dir}/${name}`); setSelected(""); }
        }}>
          <Field label="New Markdown file">
            <input placeholder="notes.md" value={newName} disabled={!connected} onChange={(e) => setNewName(e.target.value)} />
          </Field>
          <Button type="submit" disabled={!connected || !validName || exists}>New file</Button>
          {exists && <span>File already exists.</span>}
        </form>
        {newPath && <FileEditor key={newPath} path={newPath} file={null} onSaved={() => {
          entries.reload();
          setSelected(newPath);
          setNewPath("");
          setNewName("");
        }} />}
        {selected && <ExistingEditor key={selected} path={selected} />}
      </div>
    </Panel>
  );
}

function ProjectDetails({ id }: { id: string }) {
  const connected: boolean = useConnected();
  const navigate = useNavigate();
  const { setProject } = useProjectFilter();
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
  const jobsLink = <Button disabled={!connected} onClick={() => { setProject(id); void navigate("/jobs"); }}>Jobs of this project</Button>;
  return (
    <Page title={project?.name ?? id} actions={jobsLink}>
      <ErrorText error={data.error} />
      {data.loading && !view && <Empty>Loading project…</Empty>}
      {view?.errors.map(({ file, path, message }, index) => <ErrorText key={index} error={`${file}${path ? ` · ${path}` : ""}: ${message}`} />)}
      {view?.creating ? <Panel>
        {connected ? <Link to={`/projects/new?resume=${id}`}>Resume creation</Link> : "Unfinished creation"}
      </Panel> : project && (
        <>
          <Panel>
            <h2 className={ui.title}>General</h2>
            <dl className={ui.kv}>
              <dt>ID</dt><dd>{id}</dd>
              <dt>Repository</dt><dd>{project.repo?.url ?? "local only"}</dd>
              <dt>Forge account</dt><dd>{project.repo?.account ?? "None"}</dd>
            </dl>
            <ExistingEditor project path={`projects/${id}/project.json`} onSaved={data.reload} />
          </Panel>
          <Definitions id={id} kind="recipe" />
          <Definitions id={id} kind="node" />
          <Knowledge id={id} />
          <Panel>
            <h2 className={ui.title}>Services</h2>
            <p>{project.services ?? "No compose file"}</p>
            <p className={ui.muted}>Edit <code>services</code> in General.</p>
          </Panel>
          <Panel>
            <h2 className={ui.title}>Limits and budget</h2>
            <pre className={s.pre}>{JSON.stringify(project.limits, null, 2)}</pre>
            <p className={ui.muted}>Edit <code>limits</code> in General.</p>
          </Panel>
          <Panel>
            <h2 className={ui.title}>Danger zone</h2>
            <ErrorText error={jobs.error} />
            {running && <div className={ui.row}><span>Stop the running jobs before deleting this project.</span>{jobsLink}</div>}
            <Button kind="danger" disabled={!connected || !jobs.data || !!jobs.error || running} onClick={() => setDeleting(true)}>Delete project</Button>
          </Panel>
          <Modal open={deleting} onClose={() => { if (!remove.busy) setDeleting(false); }} title="Delete project">
            <p>Delete {project.name} and its project directory, workdirs, artifacts, logs, database, definitions, and service containers?</p>
            <p>Repositories and pull requests on the forge stay there.</p>
            {running && <div className={ui.row}><span>Stop the running jobs first.</span>{jobsLink}</div>}
            <ErrorText error={remove.error} />
            <div className={ui.row}>
              <Button disabled={!connected || remove.busy} onClick={() => setDeleting(false)}>Cancel</Button>
              <Button kind="danger" disabled={!connected || remove.busy || !jobs.data || !!jobs.error || running} onClick={() => void remove.run()}>Delete project</Button>
            </div>
          </Modal>
        </>
      )}
    </Page>
  );
}

export function ProjectPage() {
  const { id } = useParams();
  return id ? <ProjectDetails key={id} id={id} /> : <Page title="Project"><Empty>Project not found</Empty></Page>;
}
