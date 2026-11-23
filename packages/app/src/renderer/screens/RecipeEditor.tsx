import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { Connection, XYPosition } from "@xyflow/react";
import { EdgePort, Name, Outcome, RecipeEnd, RecipeEndResult } from "@pecore/schemas";
import type { DefinitionEntry } from "@pecore/schemas";
import { call } from "../api/client";
import { useAction, useData } from "../api/hooks";
import { defaultDefinitionIcon, definitionIconName, DefinitionIcon, DefinitionIconField, useDefinitionIcons } from "../components/DefinitionIcon";
import { restorePageScroll } from "../components/usePageScroll";
import { ErrorText, Page, Panel } from "../components/ui";
import { Button, IconButton } from "../ds/button";
import { Checkbox } from "../ds/choice";
import { Card } from "../ds/feedback";
import { TextArea, TextField } from "../ds/field";
import { GearIcon, TrashIcon } from "../ds/icons";
import { Dialog } from "../ds/overlay";
import { MultiCombobox, Select } from "../ds/select";
import type { Option } from "../ds/select";
import { NumberField } from "../ds/values";
import { DefinitionErrors, definitionUrl, object, parseDraft, string, useDefinitionDraft, useUnsaved } from "./NodeEditor";
import type { NewDefinition } from "./NodeEditor";
import { RecipeGraph } from "./RecipeGraph";
import type { RecipeCanvas, RecipeGraphLink, RecipeGraphNode } from "./RecipeGraph";
import { NodeCard, RecipeNodeKindBadge, recipeNodeKind } from "../components/NodeCard";
import { RecipePalette } from "./RecipePalette";
import type { PaletteNode } from "./RecipePalette";
import { arrangeRecipe, freeRecipeSlot, recipeEnd, recipeLayout, recipeStart, snapRecipePosition, withRecipeBoundaries } from "./recipeLayout";
import type { RecipeLayout, RecipeLink } from "./recipeLayout";
import { templateTitle } from "../components/templateTitle";
import s from "./Editors.module.css";

const failureOutcomes: ReadonlySet<string> = new Set<string>([
  "failed", "conflict", "unexpected_pass", "stale", "ci_failed", "ci_exhausted", "ci_timeout",
]);
const endLabels: Record<RecipeEndResult, string> = { succeeded: "Success", failed: "Failure", not_delivered: "Not delivered" };
const endOptions: Option[] = ["succeeded", "failed"].map((value) => ({ value, label: endLabels[value as RecipeEndResult] }));
type DraftConnection = RecipeLink & { result?: RecipeEndResult };

function graphTitle(id: string): string {
  if (id === recipeStart) return "Start";
  if (id === recipeEnd) return "End";
  return templateTitle(id);
}

function RecipeFile({ path, project, newTemplate }: { path: string; project?: string; newTemplate: boolean }) {
  const navigate = useNavigate();
  const scope: string = newTemplate ? "templates" : project ? `projects/${project}` : path.slice(0, path.lastIndexOf("/recipes/"));
  const creation = useMemo<NewDefinition | undefined>(() => newTemplate || project ? {
    content: JSON.stringify({ $schema: newTemplate ? "../../schemas/recipe.json" : "../../../schemas/recipe.json", name: "", description: "", icon: defaultDefinitionIcon.recipe, nodes: {}, edges: [], ends: [] }, null, 2) + "\n",
    path(content) {
      const name = Name.safeParse(parseDraft(content)?.name);
      return name.success ? `${scope}/recipes/${name.data}.json` : "";
    },
  } : undefined, [newTemplate, project, scope]);
  const file = useDefinitionDraft(path, false, creation);
  const icons = useDefinitionIcons();
  const duplicate = useAction(async () => {
    const source = parseDraft(file.content);
    if (!source || file.dirty) return;
    const recipes = await call("listDefinitions", { query: { dir: "templates/recipes" } });
    const used: Set<string> = new Set(recipes.map((entry) => entry.path));
    const base: string = string(source.name) + "-copy";
    let name: string = base;
    for (let index: number = 2; used.has(`templates/recipes/${name}.json`); index++) name = `${base}-${index}`;
    const target: string = `templates/recipes/${name}.json`;
    const icon: string = string(source.icon) || definitionIconName(icons.data, "recipe", string(source.name));
    const content: string = JSON.stringify({ ...source, name, icon }, null, 2) + "\n";
    await call("saveDefinition", { params: { path: target }, body: { content, baseSha256: null } });
    await navigate(definitionUrl("recipe", target));
  });
  const [destination, setDestination] = useState<string>();
  const warn = useUnsaved(file.dirty && !destination);
  useEffect(() => {
    const saved: string | undefined = destination ?? file.savedPath;
    if (saved) void navigate(definitionUrl("recipe", saved), { replace: true });
  }, [destination, file.savedPath]);
  const [selected, setSelected] = useState("");
  const [connection, setConnection] = useState<DraftConnection>();
  const canvas = useRef<RecipeCanvas>(null);
  const projectId: string | undefined = project ?? /^projects\/([^/]+)$/.exec(scope)?.[1];
  const directory: string = scope + "/nodes";
  const definitions = useData(() => call("listDefinitions", { query: { dir: directory } }), [directory], (event) => event.type === "definition.changed" && event.path.startsWith(directory + "/"));
  const [recipeTemplate, setRecipeTemplate] = useState<string | null>(null);
  const [templateNode, setTemplateNode] = useState<string | null>(null);
  const recipeTemplates = useTemplates("recipes", !!project);
  const nodeTemplates = useTemplates("nodes", !!project);
  const importRecipe = useAction(async () => {
    if (!project || !recipeTemplate || (file.dirty && !window.confirm("Replace your unsaved draft with this template?"))) return;
    await call("instantiate", { body: { kind: "recipe", name: recipeTemplate, project } });
    setDestination(`${scope}/recipes/${recipeTemplate}.json`);
  });
  const importNode = useAction(async () => {
    if (!project || !templateNode) return;
    await call("instantiate", { body: { kind: "node", name: templateNode, project } });
    definitions.reload();
    setTemplateNode(null);
  });
  const importing: boolean = importRecipe.busy || importNode.busy;
  const editable: boolean = file.editable && !importing;
  const draft = parseDraft(file.content);
  const nodes = object(draft?.nodes);
  const ci = object(draft?.ci);
  const entries = Object.entries(nodes);
  const edges: unknown[] = Array.isArray(draft?.edges) ? draft.edges : [];
  const selectedNode = object(nodes[selected]);
  const palette = (definitions.data ?? []).filter((item) => item.path.endsWith(".json") && !item.errors.length && string(object(item.value).name) && object(item.value).kind !== "source");
  const nodeDefinitions = new Map<string, DefinitionEntry>(palette.map((item) => [string(object(item.value).name), item]));
  const definition: DefinitionEntry | undefined = nodeDefinitions.get(string(selectedNode.use));
  const nodeValue = object(definition?.value);
  const selectedKind = recipeNodeKind(nodeValue.kind);
  const paletteNodes: PaletteNode[] = palette.flatMap(({ value }) => {
    const node = object(value);
    const kind = recipeNodeKind(node.kind);
    if (!kind) return [];
    const name: string = string(node.name);
    return [{
      name,
      title: templateTitle(name),
      tags: Array.isArray(node.tags) ? node.tags.map(string).filter(Boolean) : [],
      icon: <DefinitionIcon icons={icons.data} type="node" name={name} selected={string(node.icon)} size="lg" />,
      kind,
    }];
  });
  const stepOptions: Option[] = entries.map(([value]) => ({ value, label: templateTitle(value) }));
  const questionParameter = object(object(object(nodeValue.params).properties).question);
  const update = (changes: Record<string, unknown>): void => file.update(JSON.stringify({ ...draft, ...changes }, null, 2) + "\n");
  const updateNode = (key: string, value: unknown): void => update({ nodes: { ...nodes, [selected]: { ...selectedNode, [key]: value } } });
  const highlight = (key: string): boolean => !!file.errors?.some(({ path: at }) => at === key || at.startsWith(key + "."));
  const start: string = string(draft?.start);
  const ends: RecipeEnd[] = Array.isArray(draft?.ends)
    ? draft.ends.flatMap((value) => {
      const parsed = RecipeEnd.safeParse(value);
      return parsed.success ? [parsed.data] : [];
    })
    : entries.flatMap(([from, value]) => {
      const node = object(nodeDefinitions.get(string(object(value).use))?.value);
      const declared: unknown = node.failOutcomes;
      return outcomesFor(from).filter((on) => !edges.some((edge) => object(edge).from === from && object(edge).on === on)).map((on) => {
        const failed: boolean = on === "stale" || (Array.isArray(declared) && declared.includes(on))
          || (from === ci.after && ["ci_failed", "ci_exhausted", "ci_timeout"].includes(on));
        const succeeded: boolean = Array.isArray(draft?.successOutcomes) && draft.successOutcomes.includes(`${from}:${on}`);
        return { from, on, result: failed ? "failed" : succeeded ? "succeeded" : "not_delivered" };
      });
    });
  const updateGraph = (changes: Record<string, unknown>): void => update({ ends, successOutcomes: undefined, ...changes });
  const graphNodes: RecipeGraphNode[] = entries.map(([id, value]) => {
    const name: string = string(object(value).use);
    const stepTitle: string = templateTitle(id);
    const title: string = templateTitle(name) || stepTitle;
    const definitionValue = object(nodeDefinitions.get(name)?.value);
    const kind = recipeNodeKind(definitionValue.kind);
    const showStepTitle: boolean = stepTitle !== title && stepTitle.toLowerCase() !== kind;
    return {
      id,
      label: <>
        <NodeCard icon={<DefinitionIcon icons={icons.data} type="node" name={name} selected={string(definitionValue.icon)} size="lg" />} title={title} kind={kind} />
        {showStepTitle && <small className={s.stepCaption} title={stepTitle}>{stepTitle}</small>}
      </>,
      invalid: highlight("nodes." + id),
    };
  });
  const graphEdges: RecipeGraphLink[] = edges.flatMap((value, index) => {
    const edge = object(value);
    const from: string = string(edge.from);
    const to: string = string(edge.to);
    if (!Object.hasOwn(nodes, from) || !Object.hasOwn(nodes, to)) return [];
    const on: string = string(edge.on);
    const definitionName: string = string(object(nodes[from]).use);
    const declaredFailures: unknown = object(nodeDefinitions.get(definitionName)?.value).failOutcomes;
    return [{
      from,
      to,
      on,
      maxRounds: typeof edge.maxRounds === "number" ? edge.maxRounds : undefined,
      sourcePort: EdgePort.safeParse(edge.sourcePort).data,
      targetPort: EdgePort.safeParse(edge.targetPort).data,
      invalid: highlight("edges." + index),
      failed: failureOutcomes.has(on) || (Array.isArray(declaredFailures) && declaredFailures.includes(on)),
    }];
  });
  const automatic: RecipeLayout = arrangeRecipe(Object.keys(nodes), graphEdges, string(draft?.start), string(draft?.onBaseChanged));
  const savedLayout: RecipeLayout = Object.fromEntries(Object.entries(object(draft?.layout)).flatMap(([id, value]) => {
    const { x, y } = object(value);
    return typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y) ? [[id, { x, y }]] : [];
  }));
  const layout: RecipeLayout = recipeLayout(automatic, savedLayout);
  const graphLayout: RecipeLayout = recipeLayout(withRecipeBoundaries(layout, start), { ...savedLayout, ...layout });
  const startTarget: string = entries.length ? start : recipeEnd;
  const startPorts = object(draft?.startPorts);
  const boundaryLinks: RecipeGraphLink[] = ends.filter(({ from }) => Object.hasOwn(nodes, from)).map(({ from, on, result, sourcePort, targetPort }) => ({
    from, on, to: recipeEnd, sourcePort, targetPort,
    caption: `${on} · ${endLabels[result]}`, invalid: false, failed: result === "failed", neutral: result === "not_delivered",
  }));
  if (startTarget === recipeEnd || Object.hasOwn(nodes, startTarget)) {
    boundaryLinks.push({
      from: recipeStart, on: "", to: startTarget,
      sourcePort: EdgePort.safeParse(startPorts.sourcePort).data, targetPort: EdgePort.safeParse(startPorts.targetPort).data,
      failed: false, invalid: false,
    });
  }
  const boundaryNodes: RecipeGraphNode[] = [recipeStart, recipeEnd].map((id) => ({
    id, label: <strong>{graphTitle(id)}</strong>, invalid: id === recipeStart && highlight("start"),
  }));
  const add = (template: string, point: XYPosition): void => {
    if (!editable || !nodeDefinitions.has(template)) return;
    const drop: XYPosition | undefined = canvas.current?.dropPosition(point);
    if (!drop) return;
    let id: string = template;
    for (let number: number = 2; Object.hasOwn(nodes, id); number++) id = template + "-" + number;
    const position: XYPosition = freeRecipeSlot(graphLayout, snapRecipePosition(drop));
    updateGraph({
      nodes: { ...nodes, [id]: { use: template } },
      layout: { ...savedLayout, ...layout, [id]: position },
      startPorts: entries.length ? draft?.startPorts : undefined,
    });
    setSelected(id);
  };
  const removeSelected = (): void => {
    if (!editable || !draft || !Object.hasOwn(nodes, selected)) return;
    const remaining: Record<string, unknown> = Object.fromEntries(entries.filter(([id]) => id !== selected).map(([id, value]) => {
      const node = object(value);
      const agent = object(node.agent);
      const requires: unknown = Array.isArray(node.requires) ? node.requires.filter((ref) => ref !== selected) : node.requires;
      const providerNot: unknown = Array.isArray(agent.providerNot) ? agent.providerNot.filter((ref) => ref !== selected) : agent.providerNot;
      return [id, { ...node, requires, agent: node.agent && { ...agent, providerNot } }];
    }));
    updateGraph({
      nodes: remaining,
      edges: edges.filter((value) => object(value).from !== selected && object(value).to !== selected),
      layout: Object.fromEntries(Object.entries(graphLayout).filter(([id]) => id !== selected)),
      start: draft.start === selected ? undefined : draft.start,
      startPorts: draft.start === selected ? undefined : draft.startPorts,
      onBaseChanged: draft.onBaseChanged === selected ? undefined : draft.onBaseChanged,
      ci: ci.after === selected ? undefined : draft.ci,
      ends: ends.filter(({ from }) => from !== selected),
    });
    setSelected("");
  };
  const connect = ({ source, target, sourceHandle, targetHandle }: Connection): void => {
    if (!editable || source === recipeEnd || target === recipeStart) return;
    const sourcePort = EdgePort.safeParse(sourceHandle).data;
    const targetPort = EdgePort.safeParse(targetHandle).data;
    if (source === recipeStart) {
      if (Object.hasOwn(nodes, target) || (target === recipeEnd && entries.length === 0)) {
        updateGraph({ start: target === recipeEnd ? undefined : target, startPorts: { sourcePort, targetPort } });
      }
      return;
    }
    setConnection({
      from: source,
      to: target,
      on: "",
      sourcePort,
      targetPort,
    });
  };
  function outcomesFor(id: string): string[] {
    const node = object(nodes[id]);
    const sourceOutcomes: unknown = object(nodeDefinitions.get(string(node.use))?.value).outcomes;
    const outcomes: string[] = Array.isArray(sourceOutcomes) ? sourceOutcomes.map(string).filter(Boolean) : [];
    if (Array.isArray(node.requires) && node.requires.length) outcomes.push("stale");
    if (node.optional === true) outcomes.push("skipped");
    if (id === ci.after) {
      const trigger: number = outcomes.indexOf(string(ci.on));
      if (trigger >= 0) outcomes.splice(trigger, 1);
      outcomes.push("ci_passed", "ci_failed", "ci_exhausted", "ci_timeout");
    }
    return outcomes;
  }
  const outcomes: Option[] = connection ? outcomesFor(connection.from).map((outcome) => ({ value: outcome, label: outcome })) : [];
  const inspectorOutcomes: string[] = selected ? outcomesFor(selected) : [];
  const required: string[] = Array.isArray(selectedNode.requires) ? selectedNode.requires.map(string) : [];

  const recipeOptions = templateOptions(recipeTemplates.data);
  const nodeOptions = templateOptions(nodeTemplates.data).filter(({ value }) => !palette.some((item) => object(item.value).name === value));
  return <Page fillHeight title={creation ? "New Recipe" : templateTitle(string(draft?.name)) || "Recipe editor"} actions={<>
    {!creation && scope === "templates" && <Button loading={duplicate.busy} disabled={!editable || !file.ready || !draft || file.dirty}
      onClick={() => void duplicate.run()}>Duplicate</Button>}
    {file.saveButton(importing)}
  </>}>
    {projectId && <Link to={`/projects/${encodeURIComponent(projectId)}?tab=recipes`} state={restorePageScroll}>Back to recipes</Link>}
    {scope === "templates" && <Link to="/templates?tab=recipes" state={restorePageScroll}>Back to templates</Link>}
    {file.feedback}
    <ErrorText error={duplicate.error} />
    {project && <Panel><div className={s.importRow}>
      <Select label="Recipe template" value={recipeTemplate} onValueChange={setRecipeTemplate} options={recipeOptions} disabled={!editable || !recipeOptions.length} placeholder="Choose a template" />
      <Button loading={importRecipe.busy} disabled={!editable || !recipeTemplate} onClick={() => void importRecipe.run()}>Import template</Button>
    </div><ErrorText error={recipeTemplates.error ?? importRecipe.error} /></Panel>}
    {file.ready && <div className={s.recipePanel}>
      {draft ? <>
        <RecipePalette nodes={paletteNodes} disabled={!editable} loading={definitions.loading} onAdd={add}>
          <ErrorText error={definitions.error} />
          {project && <div className={s.projectPalette}>
            <div className={s.importRow}>
              <Select label="Node template" value={templateNode} onValueChange={setTemplateNode} options={nodeOptions}
                disabled={!editable || !nodeOptions.length} placeholder="Choose a node" />
              <Button loading={importNode.busy} disabled={!editable || !templateNode} onClick={() => void importNode.run()}>Import node</Button>
            </div>
            <ErrorText error={nodeTemplates.error ?? importNode.error} />
          </div>}
        </RecipePalette>
        <div className={s.workspace}>
          <RecipeGraph ref={canvas} steps={[...graphNodes, ...boundaryNodes]} links={[...graphEdges, ...boundaryLinks]}
            layout={graphLayout} automatic={withRecipeBoundaries(automatic, start)}
            start={recipeStart} editable={editable} selected={selected} onSelect={setSelected}
            onConnect={connect} onLayout={(next) => update({ layout: next })} />
          <Card title={selected ? templateTitle(string(selectedNode.use) || selected) : "Recipe settings"}
            actions={selected ? <div className={s.inspectorActions}>
              <IconButton label="Recipe settings" icon={<GearIcon />} onClick={() => setSelected("")} />
              <IconButton label="Remove node" icon={<TrashIcon />} disabled={!editable} onClick={removeSelected} />
            </div> : undefined}
            className={s.inspector}>
            <fieldset className={s.inspectorFields} disabled={!editable}>
              {selected ? <>
                <div className={s.inspectorMeta}>
                  <DefinitionIcon icons={icons.data} type="node" name={string(selectedNode.use)} selected={string(nodeValue.icon)} size="sm" />
                  {selectedKind && <RecipeNodeKindBadge kind={selectedKind} />}
                  {nodeValue.kind === "human" && nodeValue.mode === "decision" && <span>Decision</span>}
                  {nodeValue.kind === "human" && nodeValue.mode === "review" && <span>Review</span>}
                  {definition && file.editable && <Link to={definitionUrl("node", definition.path)}>Edit definition</Link>}
                </div>
                {!!inspectorOutcomes.length && <div className={s.inspectorOutcomes}>
                  <strong>Outcomes</strong>
                  <span>{inspectorOutcomes.join(", ")}</span>
                </div>}
                {nodeValue.kind === "human" && nodeValue.mode === "decision" && questionParameter.type === "string" && <TextField label="Question"
                  value={string(object(selectedNode.params).question)} placeholder={string(questionParameter.default)} disabled={!editable}
                  onValueChange={(question) => updateNode("params", { ...object(selectedNode.params), question: question.trim() ? question : undefined })} />}
                <MultiCombobox label="Requires" placeholder="Choose nodes" value={required} disabled={!editable}
                  options={stepOptions.filter(({ value }) => value !== selected || required.includes(value))}
                  onValueChange={(next) => updateNode("requires", next)} />
                <Checkbox label="Optional" checked={selectedNode.optional === true} disabled={!editable} onCheckedChange={(checked) => updateNode("optional", checked)} />
                <Checkbox label="Skip when unchanged" checked={selectedNode.skipWhenUnchanged === true} disabled={!editable} onCheckedChange={(checked) => updateNode("skipWhenUnchanged", checked)} />
                {edges.map((value, index) => {
                  const edge = object(value);
                  return edge.from === selected && <div key={index} className={s.inspectorEdge}>
                    <div className={s.inspectorEdgeHeader}>
                      <strong>{templateTitle(string(edge.on).replaceAll("_", "-"))} → {templateTitle(string(edge.to))}</strong>
                      <IconButton label="Remove edge" icon={<TrashIcon />} disabled={!editable}
                        onClick={() => updateGraph({ edges: edges.filter((_, i) => i !== index) })} />
                    </div>
                    <NumberField label="Max rounds" min={1} disabled={!editable} value={typeof edge.maxRounds === "number" ? edge.maxRounds : null}
                      onValueChange={(next) => update({ edges: edges.map((item, i) => i === index ? { ...edge, maxRounds: next ?? undefined } : item) })} />
                  </div>;
                })}
                {ends.filter(({ from }) => from === selected).map((end) => <div className={s.inspectorEdge} key={end.on}>
                  <div className={s.inspectorEdgeHeader}>
                    <strong>{end.on} → End</strong>
                    <IconButton label="Remove connection to End" icon={<TrashIcon />} disabled={!editable}
                      onClick={() => updateGraph({ ends: ends.filter((item) => item !== end) })} />
                  </div>
                  <Select label="Result" value={end.result} disabled={!editable}
                    options={end.result === "not_delivered" ? [...endOptions, { value: end.result, label: endLabels[end.result] }] : endOptions}
                    onValueChange={(value) => {
                      const result = RecipeEndResult.safeParse(value);
                      if (result.success) updateGraph({ ends: ends.map((item) => item === end ? { ...item, result: result.data } : item) });
                    }} />
                </div>)}
              </> : <>
                {creation && <TextField label="Name" required disabled={!editable} value={string(draft.name)}
                  onValueChange={(name) => update({ name })} description="Lowercase letters, digits and hyphens. Start with a letter." />}
                <TextArea label="Description" required disabled={!editable} value={string(draft.description)}
                  onValueChange={(description) => update({ description })} className={s.recipeDescription} />
                <DefinitionIconField icons={icons.data} type="recipe" name={string(draft.name)} value={string(draft.icon)} disabled={!editable}
                  onChange={(icon) => update({ icon })} />
                <NumberField label="Max node runs" min={1} value={typeof draft.maxNodeRuns === "number" ? draft.maxNodeRuns : null}
                  disabled={!editable} onValueChange={(next) => update({ maxNodeRuns: next ?? undefined })} />
              </>}
            </fieldset>
          </Card>
        </div>
      </> : <ErrorText error="Unable to read the recipe definition." />}
      <DefinitionErrors errors={file.errors} />
    </div>}
    <Dialog open={!!connection} onOpenChange={(open) => { if (!open) setConnection(undefined); }} title="Connect nodes"
      description={connection && `${graphTitle(connection.from)} → ${graphTitle(connection.to)}`}
      footer={<>
        <Button variant="ghost" onClick={() => setConnection(undefined)}>Cancel</Button>
        <Button variant="primary" type="submit" form="recipe-connection"
          disabled={!connection || !editable || !Outcome.safeParse(connection.on).success || (connection.to === recipeEnd && !connection.result)}>Connect</Button>
      </>}>
      {connection && <form id="recipe-connection" className={s.inspectorFields} onSubmit={(event) => {
        event.preventDefault();
        if (!editable || !Outcome.safeParse(connection.on).success) return;
        const { from, on, to, sourcePort, targetPort, result } = connection;
        const remainingEdges: unknown[] = edges.filter((value) => object(value).from !== from || object(value).on !== on);
        const remainingEnds: RecipeEnd[] = ends.filter((item) => item.from !== from || item.on !== on);
        if (to === recipeEnd) {
          if (!result) return;
          updateGraph({ edges: remainingEdges, ends: [...remainingEnds, { from, on, result, sourcePort, targetPort }] });
        } else {
          updateGraph({ edges: [...remainingEdges, { from, on, to, sourcePort, targetPort }], ends: remainingEnds });
        }
        setConnection(undefined);
      }}>
        {outcomes.length
          ? <Select label="Outcome" disabled={!editable} value={connection.on || null} options={outcomes}
            onValueChange={(on) => setConnection({ ...connection, on: on ?? "" })} />
          : <TextField label="Outcome" disabled={!editable} value={connection.on} onValueChange={(on) => setConnection({ ...connection, on })} />}
        {connection.to === recipeEnd && <Select label="Result" options={endOptions} value={connection.result ?? null} disabled={!editable}
          onValueChange={(value) => setConnection({ ...connection, result: RecipeEndResult.safeParse(value).data })} />}
      </form>}
    </Dialog>
    {warn}
  </Page>;
}

function useTemplates(section: "recipes" | "nodes", enabled: boolean) {
  const dir: string = `templates/${section}`;
  return useData(() => enabled ? call("listDefinitions", { query: { dir } }) : Promise.resolve([]), [dir, enabled],
    (event) => event.type === "definition.changed" && event.path.startsWith(dir + "/"));
}

function templateOptions(entries: DefinitionEntry[] | undefined): { value: string; label: string }[] {
  return (entries ?? []).flatMap(({ path, value, errors }) => {
    const name: string = string(object(value).name);
    return path.endsWith(".json") && name && !errors.length && object(value).kind !== "source" ? [{ value: name, label: templateTitle(name) }] : [];
  });
}

export function RecipeEditor({ newTemplate = false }: { newTemplate?: boolean }) {
  const { id, "*": path = "" } = useParams();
  return <RecipeFile key={newTemplate ? "new-template" : id ?? path} path={path} project={id} newTemplate={newTemplate} />;
}
