import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Background, Controls, ReactFlow } from "@xyflow/react";
import type { Connection, Edge, Node, NodeChange, NodePositionChange, ReactFlowInstance, XYPosition } from "@xyflow/react";
import { Name, Outcome } from "@pecore/schemas";
import type { DefinitionEntry } from "@pecore/schemas";
import { call } from "../api/client";
import { useAction, useData } from "../api/hooks";
import { Button, Empty, ErrorText, Field, Modal, Page, Panel, ui } from "../components/ui";
import { Button as DsButton } from "../ds/button";
import { TextField } from "../ds/field";
import { Select } from "../ds/select";
import { DefinitionErrors, definitionUrl, object, parseDraft, string, useDefinitionDraft, useUnsaved } from "./NodeEditor";
import type { NewDefinition } from "./NodeEditor";
import "@xyflow/react/dist/style.css";
import s from "./Editors.module.css";

type LinkDraft = { from: string; to: string; on: string };
const grid: [number, number] = [20, 20];
const emptyRecipe: string = JSON.stringify({ $schema: "../../../schemas/recipe.json", name: "", description: "", nodes: {}, edges: [] }, null, 2) + "\n";

function position(layout: Record<string, unknown>, id: string, index: number): XYPosition {
  const point = object(layout[id]);
  return typeof point.x === "number" && typeof point.y === "number" ? { x: point.x, y: point.y } : { x: index % 4 * 200, y: Math.floor(index / 4) * 120 };
}

function RecipeFile({ path, project }: { path: string; project?: string }) {
  const navigate = useNavigate();
  const creation = useMemo<NewDefinition | undefined>(() => project ? {
    content: emptyRecipe,
    path(content) {
      const name = Name.safeParse(parseDraft(content)?.name);
      return name.success ? `projects/${project}/recipes/${name.data}.json` : "";
    },
  } : undefined, [project]);
  const file = useDefinitionDraft(path, false, creation);
  const [destination, setDestination] = useState<string>();
  const warn = useUnsaved(file.dirty && !destination);
  useEffect(() => {
    const saved: string | undefined = destination ?? file.savedPath;
    if (saved) void navigate(definitionUrl("recipe", saved), { replace: true });
  }, [destination, file.savedPath]);
  const [json, setJson] = useState(false);
  const [selected, setSelected] = useState("");
  const [template, setTemplate] = useState("");
  const [connection, setConnection] = useState<LinkDraft>();
  const [drag, setDrag] = useState<Record<string, XYPosition>>({});
  const [flow, setFlow] = useState<ReactFlowInstance>();
  const scope: string = project ? `projects/${project}` : path.slice(0, path.lastIndexOf("/recipes/"));
  const projectId: string | undefined = project ?? /^projects\/([^/]+)$/.exec(scope)?.[1];
  const directory: string = scope + "/nodes";
  const definitions = useData(() => call("listDefinitions", { query: { dir: directory } }), [directory], (event) => event.type === "definition.changed" && event.path.startsWith(directory + "/"));
  const [recipeTemplate, setRecipeTemplate] = useState<string | null>(null);
  const [libraryNode, setLibraryNode] = useState<string | null>(null);
  const recipeTemplates = useRecipeLibrary("recipes", !!creation);
  const nodeTemplates = useRecipeLibrary("nodes", !!creation);
  const importRecipe = useAction(async () => {
    if (!project || !recipeTemplate || (file.dirty && !window.confirm("Replace your unsaved draft with this template?"))) return;
    await call("instantiate", { body: { kind: "recipe", name: recipeTemplate, project } });
    setDestination(`${scope}/recipes/${recipeTemplate}.json`);
  });
  const importNode = useAction(async () => {
    if (!project || !libraryNode) return;
    await call("instantiate", { body: { kind: "node", name: libraryNode, project } });
    definitions.reload();
    setTemplate(libraryNode);
    setLibraryNode(null);
  });
  const importing: boolean = importRecipe.busy || importNode.busy;
  const editable: boolean = file.editable && !importing;
  const draft = parseDraft(file.content);
  const nodes = object(draft?.nodes);
  const layout = object(draft?.layout);
  const entries = Object.entries(nodes);
  const edges: unknown[] = Array.isArray(draft?.edges) ? draft.edges : [];
  useEffect(() => { void flow?.fitView(); }, [entries.length]);
  const selectedNode = object(nodes[selected]);
  const palette = (definitions.data ?? []).filter((item) => item.path.endsWith(".json") && !item.errors.length && string(object(item.value).name) && object(item.value).kind !== "source");
  const definition = palette.find((item) => object(item.value).name === selectedNode.use);
  const nodeValue = object(definition?.value);
  const update = (changes: Record<string, unknown>): void => file.update(JSON.stringify({ ...draft, ...changes }, null, 2) + "\n");
  const updateNode = (key: string, value: unknown): void => update({ nodes: { ...nodes, [selected]: { ...selectedNode, [key]: value } } });
  const layoutNow = (): Record<string, unknown> => ({ ...layout, ...Object.fromEntries(entries.map(([id], index) => [id, position(layout, id, index)])) });
  const highlight = (key: string): boolean => !!file.errors?.some(({ path: at }) => at === key || at.startsWith(key + "."));
  const graphNodes: Node[] = entries.map(([id, value], index) => ({
    id,
    position: drag[id] ?? position(layout, id, index),
    data: { label: <>{id}<br /><small>{string(object(value).use)}</small>{highlight("nodes." + id) && <><br /><strong>Invalid</strong></>}</> },
    selected: selected === id,
    style: highlight("nodes." + id) ? { borderColor: "var(--status-failed)" } : undefined,
  }));
  const graphEdges: Edge[] = edges.flatMap((value, index) => {
    const edge = object(value);
    const invalid: boolean = highlight("edges." + index);
    if (!Object.hasOwn(nodes, string(edge.from)) || !Object.hasOwn(nodes, string(edge.to))) return [];
    return [{ id: String(index), source: string(edge.from), target: string(edge.to), label: invalid ? string(edge.on) + " (invalid)" : string(edge.on), style: invalid ? { stroke: "var(--status-failed)", strokeWidth: 2 } : undefined }];
  });
  const add = (): void => {
    if (!palette.some((item) => object(item.value).name === template)) return;
    let id: string = template;
    for (let number: number = 2; Object.hasOwn(nodes, id); number++) id = template + "-" + number;
    update({ nodes: { ...nodes, [id]: { use: template } }, start: draft?.start ?? id, layout: { ...layoutNow(), [id]: position({}, id, entries.length) } });
    setSelected(id);
    setTemplate("");
  };
  const move = (changes: NodeChange<Node>[]): void => {
    if (!editable) return;
    const moves = changes.filter((change): change is NodePositionChange & { position: XYPosition } => change.type === "position" && !!change.position);
    if (!moves.length) return;
    setDrag((previous) => {
      const next: Record<string, XYPosition> = { ...previous };
      for (const change of moves) {
        if (change.dragging) next[change.id] = change.position;
        else delete next[change.id];
      }
      return next;
    });
    const finished = moves.filter((change) => !change.dragging);
    if (finished.length) update({ layout: { ...layoutNow(), ...Object.fromEntries(finished.map((change) => [change.id, change.position])) } });
  };
  const connect = ({ source, target }: Connection): void => {
    if (editable) setConnection({ from: source, to: target, on: "" });
  };
  const nodeSelect = (key: string, label: string): ReactNode => <Field label={label}><select value={string(draft?.[key])} onChange={(event) => update({ [key]: event.target.value || undefined })}>
    <option value="">None</option>{entries.map(([id]) => <option key={id}>{id}</option>)}
  </select></Field>;
  const outcomeSource = connection && palette.find((item) => object(item.value).name === object(nodes[connection.from]).use);
  const outcomes: unknown = object(outcomeSource?.value).outcomes;

  const recipeOptions = templateOptions(recipeTemplates.data);
  const nodeOptions = templateOptions(nodeTemplates.data).filter(({ value }) => !palette.some((item) => object(item.value).name === value));
  return <Page title={creation ? "New Recipe" : string(draft?.name) || "Recipe editor"} actions={file.saveButton(importing)}>
    {projectId && <Link to={`/projects/${encodeURIComponent(projectId)}?tab=recipes`}>Back to recipes</Link>}
    {file.feedback}
    {creation && <Panel><div className={s.importRow}>
      <Select label="Recipe template" value={recipeTemplate} onValueChange={setRecipeTemplate} options={recipeOptions} disabled={!editable || !recipeOptions.length} placeholder="Choose a template" />
      <DsButton loading={importRecipe.busy} disabled={!editable || !recipeTemplate} onClick={() => void importRecipe.run()}>Import template</DsButton>
    </div><ErrorText error={recipeTemplates.error ?? importRecipe.error} /></Panel>}
    {file.ready && <Panel>
      <div className={ui.row}>
        <Button disabled={!file.connected || !draft} aria-pressed={!json && !!draft} onClick={() => setJson(false)}>Graph</Button>
        <Button disabled={!file.connected} aria-pressed={json || !draft} onClick={() => setJson(true)}>JSON</Button>
      </div>
      {json || !draft ? <Field label="Recipe JSON"><textarea className={s.json} disabled={!editable} value={file.content} onChange={(event) => { setJson(true); file.update(event.target.value); }} /></Field> :
        <div className={s.workspace}>
          <div className={ui.stack}>
            <ErrorText error={definitions.error} />
            <div className={ui.row}>
              <select aria-label="Node definition" disabled={!editable} value={template} onChange={(event) => setTemplate(event.target.value)}>
                <option value="">{definitions.loading ? "Loading nodes…" : "Select a node"}</option>
                {palette.map((item) => <option key={item.path}>{string(object(item.value).name)}</option>)}
              </select>
              <Button disabled={!editable || !template || !palette.some((item) => object(item.value).name === template)} onClick={add}>Add node</Button>
            </div>
            {creation && <>
              <div className={s.importRow}>
                <Select label="Library node" value={libraryNode} onValueChange={setLibraryNode} options={nodeOptions} disabled={!editable || !nodeOptions.length} placeholder="Choose a node" />
                <DsButton loading={importNode.busy} disabled={!editable || !libraryNode} onClick={() => void importNode.run()}>Import node</DsButton>
              </div>
              <ErrorText error={nodeTemplates.error ?? importNode.error} />
            </>}
            {!creation && !definitions.loading && !palette.length && <Empty>No valid node definitions in this scope.</Empty>}
            <div className={s.graph} inert={!editable}>
              <ReactFlow nodes={graphNodes} edges={graphEdges} snapToGrid snapGrid={grid} fitView onInit={setFlow} deleteKeyCode={null}
                onNodesChange={move} onConnect={connect} nodesDraggable={editable} nodesConnectable={editable}
                onNodeClick={(_, node) => setSelected(node.id)} onPaneClick={() => setSelected("")}>
                <Background gap={grid[0]} /><Controls showInteractive={false} />
              </ReactFlow>
            </div>
          </div>
          <fieldset className={s.fields} disabled={!editable}>
            {Object.hasOwn(nodes, selected) ? <>
              <div className={ui.row}><strong>{selected}</strong><Button onClick={() => setSelected("")}>Recipe settings</Button></div>
              <Field label="Use"><select value={string(selectedNode.use)} onChange={(event) => updateNode("use", event.target.value)}>
                {!definition && <option>{string(selectedNode.use)}</option>}
                {palette.map((item) => <option key={item.path}>{string(object(item.value).name)}</option>)}
              </select></Field>
              {definition && <><span>{string(nodeValue.kind)}{Array.isArray(nodeValue.outcomes) && " · " + nodeValue.outcomes.join(", ")}</span>{file.editable && <Link to={definitionUrl("node", definition.path)}>Edit node</Link>}</>}
              <Field label="Requires (comma separated)"><input value={Array.isArray(selectedNode.requires) ? selectedNode.requires.join(",") : ""} onChange={(event) => updateNode("requires", event.target.value ? event.target.value.split(",") : [])} /></Field>
              <label><input type="checkbox" checked={selectedNode.optional === true} onChange={(event) => updateNode("optional", event.target.checked)} /> Optional</label>
              <label><input type="checkbox" checked={selectedNode.skipWhenUnchanged === true} onChange={(event) => updateNode("skipWhenUnchanged", event.target.checked)} /> Skip when unchanged</label>
              {edges.map((value, index) => {
                const edge = object(value);
                return edge.from === selected && <Field key={index} label={string(edge.on) + " → " + string(edge.to) + " · Max rounds"}>
                  <input type="number" min={1} value={typeof edge.maxRounds === "number" ? edge.maxRounds : ""} onChange={(event) => update({ edges: edges.map((item, i) => i === index ? { ...edge, maxRounds: event.target.value ? Number(event.target.value) : undefined } : item) })} />
                  <Button onClick={() => update({ edges: edges.filter((_, i) => i !== index) })}>Remove edge</Button>
                </Field>;
              })}
            </> : <>
              <strong>Recipe settings</strong>
              {creation && <>
                <TextField label="Name" required value={string(draft.name)} onValueChange={(name) => update({ name })} description="Lowercase letters, digits and hyphens. Start with a letter." />
                <TextField label="Description" required value={string(draft.description)} onValueChange={(description) => update({ description })} />
              </>}
              {nodeSelect("start", "Start")}
              {nodeSelect("onBaseChanged", "On base changed")}
              <Field label="Max node runs"><input type="number" min={1} value={typeof draft.maxNodeRuns === "number" ? draft.maxNodeRuns : ""} placeholder="100" onChange={(event) => update({ maxNodeRuns: event.target.value ? Number(event.target.value) : undefined })} /></Field>
              <Field label="Success outcomes (comma separated)"><input value={Array.isArray(draft.successOutcomes) ? draft.successOutcomes.join(",") : ""} onChange={(event) => update({ successOutcomes: event.target.value ? event.target.value.split(",") : [] })} /></Field>
            </>}
          </fieldset>
        </div>}
      <DefinitionErrors errors={file.errors} />
    </Panel>}
    <Modal open={!!connection} onClose={() => setConnection(undefined)} title="Connect nodes">
      {connection && <form className={ui.stack} onSubmit={(event) => {
        event.preventDefault();
        if (!file.editable || !Outcome.safeParse(connection.on).success) return;
        update({ edges: [...edges, connection] });
        setConnection(undefined);
      }}>
        <p>{connection.from} → {connection.to}</p>
        <Field label="Outcome"><input disabled={!file.editable} list="edge-outcomes" value={connection.on} onChange={(event) => setConnection({ ...connection, on: event.target.value })} /></Field>
        <datalist id="edge-outcomes">{Array.isArray(outcomes) && outcomes.map((value) => <option key={string(value)} value={string(value)} />)}</datalist>
        <Button type="submit" kind="primary" disabled={!file.editable || !Outcome.safeParse(connection.on).success}>Connect</Button>
      </form>}
    </Modal>
    {warn}
  </Page>;
}

function useRecipeLibrary(section: "recipes" | "nodes", enabled: boolean) {
  const dir: string = `library/${section}`;
  return useData(() => enabled ? call("listDefinitions", { query: { dir } }) : Promise.resolve([]), [dir, enabled],
    (event) => event.type === "definition.changed" && event.path.startsWith(dir + "/"));
}

function templateOptions(entries: DefinitionEntry[] | undefined): { value: string; label: string }[] {
  return (entries ?? []).flatMap(({ path, value, errors }) => {
    const name: string = string(object(value).name);
    return path.endsWith(".json") && name && !errors.length && object(value).kind !== "source" ? [{ value: name, label: name }] : [];
  });
}

export function RecipeEditor() {
  const { id, "*": path = "" } = useParams();
  return <RecipeFile key={id ?? path} path={path} project={id} />;
}
