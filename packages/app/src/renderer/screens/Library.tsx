import { useState } from "react";
import { Link } from "react-router";
import type { DefinitionEntry, RouteResult } from "@pecore/schemas";
import { call } from "../api/client";
import { useAction, useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { Button, Empty, ErrorText, Field, Modal, Page, Panel, ui } from "../components/ui";
import { DefinitionErrors, definitionUrl, object, string } from "./NodeEditor";

export function Library() {
  const connected: boolean = useConnected();
  const templates = useData(async () => {
    const [nodes, recipes] = await Promise.all([
      call("listDefinitions", { query: { dir: "library/nodes" } }),
      call("listDefinitions", { query: { dir: "library/recipes" } }),
    ]);
    return { node: nodes.filter((item) => item.path.endsWith(".json")), recipe: recipes.filter((item) => item.path.endsWith(".json")) };
  }, [], (event) => event.type === "definition.changed" && event.path.startsWith("library/"));
  const projects = useData(() => call("listProjects"), [], (event) => event.type === "project.updated" || (event.type === "definition.changed" && event.path.endsWith("/project.json")));
  const [kind, setKind] = useState("");
  const [project, setProject] = useState("");
  const [target, setTarget] = useState<{ kind: "node" | "recipe"; name: string }>();
  const [result, setResult] = useState<RouteResult<"instantiate">>();
  const [offset, setOffset] = useState({ node: 0, recipe: 0 });
  const instantiate = useAction(async () => {
    if (!target) return;
    const next = await call("instantiate", { body: { ...target, project } });
    setResult(next);
    setTarget(undefined);
  });

  const section = (type: "node" | "recipe", entries: DefinitionEntry[]) => {
    const start: number = Math.min(offset[type], Math.max(0, Math.ceil(entries.length / 100) - 1) * 100);
    return <Panel key={type}>
    <h2>{type === "node" ? "Node templates" : "Recipe templates"}</h2>
    {type === "node" && <Field label="Kind"><select disabled={!connected} value={kind} onChange={(event) => { setKind(event.target.value); setOffset({ ...offset, node: 0 }); }}>
      <option value="">All kinds</option>{["agent", "command", "human", "source"].map((value) => <option key={value}>{value}</option>)}
    </select></Field>}
    {templates.loading && <p className={ui.muted}>Loading templates…</p>}
    {!templates.loading && !entries.length && <Empty>No {type} templates{type === "node" && kind ? " match this kind" : ""}.</Empty>}
    <table className={ui.table}><thead><tr><th>Name</th><th>Kind</th><th>Description</th><th /></tr></thead><tbody>
      {entries.slice(start, start + 100).map((item) => {
        const value = object(item.value);
        const name: string = string(value.name);
        return <tr key={item.path}>
          <td>{connected ? <Link to={definitionUrl(type, item.path)}>{name || item.path.split("/").at(-1)}</Link> : name || item.path.split("/").at(-1)}</td>
          <td>{type === "recipe" ? "recipe" : string(value.kind)}</td>
          <td>{string(value.description)}<DefinitionErrors errors={item.errors} /></td>
          <td><Button disabled={!connected || !name || !!item.errors.length} onClick={() => { instantiate.clear(); setTarget({ kind: type, name }); }}>Instantiate into project</Button></td>
        </tr>;
      })}
    </tbody></table>
    <div className={ui.row}>
      {start > 0 && <Button disabled={!connected} onClick={() => setOffset({ ...offset, [type]: start - 100 })}>Previous</Button>}
      {entries.length > start + 100 && <Button disabled={!connected} onClick={() => setOffset({ ...offset, [type]: start + 100 })}>Show more</Button>}
    </div>
  </Panel>;
  };

  return <Page title="Library">
    <ErrorText error={templates.error} />
    {section("node", (templates.data?.node ?? []).filter((item) => !kind || object(item.value).kind === kind))}
    {section("recipe", templates.data?.recipe ?? [])}
    {result && <Panel>
      <h2>Instantiation result</h2>
      <p>Created</p>{result.created.length ? <ul>{result.created.map((path) => <li key={path}><code>{path}</code></li>)}</ul> : <p>None</p>}
      <p>Kept</p>{result.kept.length ? <ul>{result.kept.map((path) => <li key={path}><code>{path}</code></li>)}</ul> : <p>None</p>}
    </Panel>}
    <Modal open={!!target} onClose={() => { if (!instantiate.busy) setTarget(undefined); }} title="Instantiate into project">
      <p>{target?.name}</p>
      <ErrorText error={projects.error ?? instantiate.error} />
      <Field label="Project"><select disabled={!connected || instantiate.busy} value={project} onChange={(event) => setProject(event.target.value)}>
        <option value="">{projects.loading ? "Loading projects…" : "Select a project"}</option>
        {(projects.data ?? []).filter((item) => item.project && !item.creating).map((item) => <option key={item.id} value={item.id}>{item.project?.name ?? item.id}</option>)}
      </select></Field>
      {!projects.loading && !projects.data?.some((item) => item.project && !item.creating) && <Empty>No ready projects. {connected && <Link to="/projects/new">New project</Link>}</Empty>}
      <Button kind="primary" disabled={!connected || instantiate.busy || !projects.data?.some((item) => item.id === project && item.project && !item.creating)} onClick={() => void instantiate.run()}>Instantiate</Button>
    </Modal>
  </Page>;
}
