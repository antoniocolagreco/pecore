import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import type { Connection, XYPosition } from "@xyflow/react";
import { AgentSession, assistantAgentId, builtInAgentNames, defaultAgentId, EdgePort, HumanInterface, humanInterfaces, KnowledgeFileName, Name, Outcome, ProjectId, RecipeEnd, RecipeEndResult } from "@pecore/schemas";
import type { DefinitionEntry, NodeAgent } from "@pecore/schemas";
import { call } from "../api/client";
import { useAction, useData } from "../api/hooks";
import { defaultDefinitionIcon, definitionIconName, DefinitionIcon, DefinitionIconField, useDefinitionIcons } from "../components/DefinitionIcon";
import { AgentSessionField } from "../components/AgentFields";
import { restorePageScroll } from "../components/usePageScroll";
import { ErrorText, Page } from "../components/ui";
import { Button, IconButton } from "../ds/button";
import { Checkbox } from "../ds/choice";
import { Card } from "../ds/feedback";
import { TextArea, TextField } from "../ds/field";
import { TrashIcon } from "../ds/icons";
import { Dialog, FieldHelp } from "../ds/overlay";
import { MultiCombobox, Select } from "../ds/select";
import type { Option } from "../ds/select";
import { NumberField } from "../ds/values";
import { DefinitionErrors, DeleteTemplateButton, definitionUrl, object, parseDraft, string, useDefinitionDraft, useUnsaved } from "./NodeEditor";
import type { NewDefinition } from "./NodeEditor";
import { RecipeGraph } from "./RecipeGraph";
import type { RecipeCanvas, RecipeGraphLink, RecipeGraphNode } from "./RecipeGraph";
import { BoundaryCard, NodeCard, RecipeNodeKindBadge, recipeNodeKind, useNodeAgents } from "../components/NodeCard";
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

function RecipeFile({ path, project, projectContext, newTemplate }: { path: string; project?: string; projectContext?: string; newTemplate: boolean }) {
  const navigate = useNavigate();
  const scope: string = newTemplate ? "templates" : project ? `projects/${project}` : path.slice(0, path.lastIndexOf("/recipes/"));
  const creation = useMemo<NewDefinition | undefined>(() => newTemplate || project ? {
    content: JSON.stringify({ name: "", description: "", icon: defaultDefinitionIcon.recipe, nodes: {}, edges: [], ends: [] }, null, 2) + "\n",
    path(content) {
      const name = Name.safeParse(parseDraft(content)?.name);
      return name.success ? `${scope}/recipes/${name.data}.json` : "";
    },
  } : undefined, [newTemplate, project, scope]);
  const file = useDefinitionDraft(path, false, creation);
  const knowledgeMode: boolean = !!projectContext;
  const projectFile = useDefinitionDraft(projectContext ? `projects/${projectContext}/project.json` : "");
  const projectConfig = parseDraft(projectFile.content);
  const knowledgeDir: string = projectContext ? `projects/${projectContext}/knowledge` : "";
  const knowledgeFiles = useData((): Promise<DefinitionEntry[]> => knowledgeDir
    ? call("listDefinitions", { query: { dir: knowledgeDir } }) : Promise.resolve([]),
  [knowledgeDir], (event) => event.type === "definition.changed" && event.path.startsWith(knowledgeDir + "/"));
  const icons = useDefinitionIcons();
  const agents: NodeAgent[] | undefined = useNodeAgents();
  const defaultAgent: NodeAgent | undefined = agents?.find(({ id }) => id === defaultAgentId);
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
  const warn = useUnsaved((file.dirty && !destination) || projectFile.dirty);
  useEffect(() => {
    const saved: string | undefined = destination ?? file.savedPath;
    if (saved) void navigate(definitionUrl("recipe", saved), { replace: true });
  }, [destination, file.savedPath]);
  const [selected, setSelected] = useState("");
  const [connection, setConnection] = useState<DraftConnection>();
  const canvas = useRef<RecipeCanvas>(null);
  const projectId: string | undefined = projectContext ?? project ?? /^projects\/([^/]+)$/.exec(scope)?.[1];
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
  const editable: boolean = file.editable && !importing && !knowledgeMode;
  const draft = parseDraft(file.content);
  const nodes = object(draft?.nodes);
  const ci = object(draft?.ci);
  const entries = Object.entries(nodes);
  const edges: unknown[] = Array.isArray(draft?.edges) ? draft.edges : [];
  const selectedNode = object(nodes[selected]);
  const palette = (definitions.data ?? []).filter((item) => item.path.endsWith(".json") && !item.errors.length && string(object(item.value).name));
  const nodeDefinitions = new Map<string, DefinitionEntry>(palette.map((item) => [string(object(item.value).name), item]));
  const definition: DefinitionEntry | undefined = nodeDefinitions.get(string(selectedNode.use));
  const nodeValue = object(definition?.value);
  const selectedKind = recipeNodeKind(nodeValue.kind);
  const selectedAgentId: string = string(selectedNode.agentId) || defaultAgentId;
  const agentOptions: Option[] = [
    { value: defaultAgentId, label: builtInAgentNames.get(defaultAgentId)! },
    ...(agents ?? []).filter(({ id }) => id !== assistantAgentId && id !== defaultAgentId).map(({ id, name }) => ({ value: id, label: name })),
  ];
  if (!agentOptions.some(({ value }) => value === selectedAgentId)) agentOptions.push({ value: selectedAgentId, label: `${selectedAgentId} (Unavailable)` });
  const templateSession: AgentSession = AgentSession.safeParse(nodeValue.agentSession).data ?? "job";
  const stepSession: AgentSession | undefined = AgentSession.safeParse(selectedNode.agentSession).data;
  const recipeName: string = string(draft?.name);
  const projectRecipes: unknown = projectConfig?.recipes;
  const knowledgeEditable: boolean = projectFile.editable && !!projectConfig &&
    (scope === "templates" ? Array.isArray(projectRecipes) && projectRecipes.includes(recipeName) : scope === `projects/${projectContext}`);
  const allKnowledge = object(projectConfig?.recipeKnowledge);
  const recipeKnowledge = Object.hasOwn(allKnowledge, recipeName) ? object(allKnowledge[recipeName]) : {};
  const stepKnowledge: unknown = Object.hasOwn(recipeKnowledge, selected) ? recipeKnowledge[selected] : nodeValue.knowledge;
  const knowledge: string[] = Array.isArray(stepKnowledge) ? stepKnowledge.map(string).filter(Boolean) : [];
  const knowledgeOptions: string[] = (knowledgeFiles.data ?? []).map(({ path }) => path.slice(knowledgeDir.length + 1))
    .filter((name) => KnowledgeFileName.safeParse(name).success);
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
  const parameters = object(object(nodeValue.params).properties);
  const questionParameter = object(parameters.question);
  const trackerParameters: { key: string; label: string }[] = [
    { key: "query", label: "Query" }, { key: "ticket", label: "Ticket ID or link" }, { key: "comment", label: "Comment" },
  ];
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
    const agentId: string = string(object(value).agentId) || defaultAgentId;
    const showStepTitle: boolean = stepTitle !== title && stepTitle.toLowerCase() !== kind;
    return {
      id,
      label: <>
        <NodeCard icon={<DefinitionIcon icons={icons.data} type="node" name={name} selected={string(definitionValue.icon)} size="lg" />} title={title} kind={kind} agent={agents?.find(({ id }) => id === agentId)} />
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
    id, label: <BoundaryCard boundary={id === recipeStart ? "start" : "end"} />, invalid: id === recipeStart && highlight("start"),
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
      const reads: unknown = Array.isArray(node.reads) ? node.reads.filter((ref) => ref !== selected) : node.reads;
      const providerNot: unknown = Array.isArray(agent.providerNot) ? agent.providerNot.filter((ref) => ref !== selected) : agent.providerNot;
      return [id, { ...node, requires, reads, agent: node.agent && { ...agent, providerNot } }];
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
  const reads: string[] = Array.isArray(selectedNode.reads) ? selectedNode.reads.map(string) : [];
  const nodeInputs: string[] = [...(Array.isArray(nodeValue.inputs) ? nodeValue.inputs : []), ...(Array.isArray(nodeValue.optionalInputs) ? nodeValue.optionalInputs : [])].map(string);
  const humanInterface: HumanInterface | undefined = nodeValue.kind === "human" ? HumanInterface.safeParse(nodeValue.interface).data : undefined;

  const recipeOptions = templateOptions(recipeTemplates.data);
  const nodeOptions = templateOptions(nodeTemplates.data).filter(({ value }) => !palette.some((item) => object(item.value).name === value));
  const title: string = templateTitle(string(draft?.name) || path.split("/").at(-1)?.replace(/\.json$/, "") || "");
  return <Page fillHeight title={creation ? "New Recipe" : title || "Recipe editor"} actions={<>
    {!knowledgeMode && !creation && scope === "templates" && <DeleteTemplateButton path={path} sha256={file.sha256} title={title}
      disabled={!editable || duplicate.busy || file.dirty} />}
    {!knowledgeMode && !creation && scope === "templates" && <Button loading={duplicate.busy} disabled={!editable || !file.ready || !draft || file.dirty}
      onClick={() => void duplicate.run()}>Duplicate</Button>}
    {knowledgeMode ? projectFile.saveButton(!knowledgeEditable) : file.saveButton(importing)}
  </>}>
    {projectId && <Link to={`/projects/${encodeURIComponent(projectId)}?tab=recipes`} state={restorePageScroll}>Back to recipes</Link>}
    {!knowledgeMode && scope === "templates" && <Link to="/templates?tab=recipes" state={restorePageScroll}>Back to templates</Link>}
    {file.feedback}
    {knowledgeMode && <>{projectFile.feedback}<ErrorText error={knowledgeFiles.error} /></>}
    <ErrorText error={duplicate.error} />
    {project && <Card padded><div className={s.importRow}>
      <Select label="Recipe template" value={recipeTemplate} onValueChange={setRecipeTemplate} options={recipeOptions} disabled={!editable || !recipeOptions.length} placeholder="Choose a template" />
      <Button loading={importRecipe.busy} disabled={!editable || !recipeTemplate} onClick={() => void importRecipe.run()}>Import template</Button>
    </div><ErrorText error={recipeTemplates.error ?? importRecipe.error} /></Card>}
    {file.ready && <div className={s.recipePanel}>
      {draft ? <>
        {!knowledgeMode && <RecipePalette nodes={paletteNodes} defaultAgent={defaultAgent} disabled={!editable} loading={definitions.loading} onAdd={add}>
          <ErrorText error={definitions.error} />
          {project && <div className={s.projectPalette}>
            <div className={s.importRow}>
              <Select label="Node template" value={templateNode} onValueChange={setTemplateNode} options={nodeOptions}
                disabled={!editable || !nodeOptions.length} placeholder="Choose a node" />
              <Button loading={importNode.busy} disabled={!editable || !templateNode} onClick={() => void importNode.run()}>Import node</Button>
            </div>
            <ErrorText error={nodeTemplates.error ?? importNode.error} />
          </div>}
        </RecipePalette>}
        <div className={s.workspace}>
          <RecipeGraph ref={canvas} steps={[...graphNodes, ...boundaryNodes]} links={[...graphEdges, ...boundaryLinks]}
            layout={graphLayout} automatic={withRecipeBoundaries(automatic, start)}
            start={recipeStart} editable={editable} inspectable={knowledgeMode} selected={selected} onSelect={setSelected}
            onConnect={connect} onLayout={(next) => update({ layout: next })} />
          <Card title={selected ? templateTitle(string(selectedNode.use) || selected) : knowledgeMode ? "Knowledge" : "Recipe settings"}
            actions={selected && !knowledgeMode ? <div className={s.inspectorActions}>
              <IconButton label="Remove node" icon={<TrashIcon />} disabled={!editable} onClick={removeSelected} />
            </div> : undefined}
            className={s.inspector}>
            {knowledgeMode ? <div className={s.inspectorFields}>
              {selectedKind === "agent" ? <MultiCombobox label="Knowledge" placeholder="Choose knowledge files"
                disabled={!knowledgeEditable || !knowledgeFiles.data || !!knowledgeFiles.error} value={knowledge}
                options={[...new Set([...knowledgeOptions, ...knowledge])].map((name) => ({ value: name, label: name }))}
                onValueChange={(next) => projectFile.update(JSON.stringify({ ...projectConfig, recipeKnowledge: {
                  ...allKnowledge, [recipeName]: { ...recipeKnowledge, [selected]: next },
                } }, null, 2) + "\n")} />
                : <p>Select an agent node to attach project knowledge.</p>}
            </div> : <fieldset className={s.inspectorFields} disabled={!editable}>
              {selected ? <>
                <div className={s.inspectorMeta}>
                  <DefinitionIcon icons={icons.data} type="node" name={string(selectedNode.use)} selected={string(nodeValue.icon)} size="sm" />
                  {selectedKind && <RecipeNodeKindBadge kind={selectedKind} agent={agents?.find(({ id }) => id === selectedAgentId)} />}
                  {humanInterface && <span>{humanInterfaces[humanInterface].label}</span>}
                  {definition && file.editable && <Link to={definitionUrl("node", definition.path)}>Edit definition</Link>}
                </div>
                {selectedKind === "agent" && <>
                  <Select label="Agent card" value={selectedAgentId} options={agentOptions} disabled={!editable || !agents}
                    onValueChange={(id) => { if (id) updateNode("agentId", id === defaultAgentId ? undefined : id); }} />
                  <AgentSessionField value={stepSession ?? templateSession} disabled={!editable}
                    description={stepSession === undefined ? "Uses the node template setting." : "Overrides the node template setting."}
                    onChange={(value) => updateNode("agentSession", value)} />
                  {stepSession !== undefined && <Button variant="ghost" disabled={!editable} onClick={() => updateNode("agentSession", undefined)}>Use template session</Button>}
                </>}
                {!!inspectorOutcomes.length && <div className={s.inspectorOutcomes}>
                  <strong>Outcomes</strong>
                  <span>{inspectorOutcomes.join(", ")}</span>
                </div>}
                <MultiCombobox label="Reads from" placeholder="Choose nodes" value={reads} disabled={!editable}
                  labelAction={<FieldHelp title="Reads from">The nodes whose latest output this step receives, for example the spec writer's spec or a check's log. Agents and people also always receive the ticket and the job's current changes.</FieldHelp>}
                  description={("inputs" in nodeValue) && nodeInputs.length ? `This command takes ${nodeInputs.join(", ")}. Read one node for each.` : undefined}
                  options={stepOptions.filter(({ value }) => value !== selected || reads.includes(value))}
                  onValueChange={(next) => updateNode("reads", next.length ? next : undefined)} />
                {humanInterface === "decision" && questionParameter.type === "string" && <TextField label="Question"
                  value={string(object(selectedNode.params).question)} placeholder={string(questionParameter.default)} disabled={!editable}
                  onValueChange={(question) => updateNode("params", { ...object(selectedNode.params), question: question.trim() ? question : undefined })} />}
                {selectedKind === "tracker" && trackerParameters.filter(({ key }) => object(parameters[key]).type === "string").map(({ key, label }) =>
                  <TextField key={key} label={label} value={string(object(selectedNode.params)[key])} placeholder={string(object(parameters[key]).default)}
                    disabled={!editable} onValueChange={(value) => updateNode("params", { ...object(selectedNode.params), [key]: value.trim() ? value : undefined })} />)}
                <MultiCombobox label="Requires" placeholder="Choose nodes" value={required} disabled={!editable}
                  labelAction={<FieldHelp title="Requires">Steps that must have passed on the current code before this step runs. If the code changed after they passed, this step does not run and ends with stale, which you can connect, for example back to the checks. Commit uses it to commit only checked code.</FieldHelp>}
                  options={stepOptions.filter(({ value }) => value !== selected || required.includes(value))}
                  onValueChange={(next) => updateNode("requires", next)} />
                <div className={s.checkHelp}>
                  <Checkbox label="Optional" checked={selectedNode.optional === true} disabled={!editable} onCheckedChange={(checked) => updateNode("optional", checked)} />
                  <FieldHelp title="Optional">Being in the recipe is not enough: the step runs only if the Spec Writer lists it in the job's specification, because the ticket needs it. For example, an Update docs step that runs only for tickets that change documented behaviour. Otherwise it ends at once with skipped, so connect skipped to the next step.</FieldHelp>
                </div>
                <div className={s.checkHelp}>
                  <Checkbox label="Keep result after a clean rebase" checked={selectedNode.skipWhenUnchanged === true} disabled={!editable} onCheckedChange={(checked) => updateNode("skipWhenUnchanged", checked)} />
                  <FieldHelp title="Keep result after a clean rebase">After the base branch moves, if the rebase was clean and the job's own changes are the same as before, the step does not run again and keeps its previous result. Use it for reviews and approvals; checks should always run.</FieldHelp>
                </div>
                {edges.map((value, index) => {
                  const edge = object(value);
                  return edge.from === selected && <div key={index} className={s.inspectorEdge}>
                    <div className={s.inspectorEdgeHeader}>
                      <strong>{templateTitle(string(edge.on).replaceAll("_", "-"))} → {templateTitle(string(edge.to))}</strong>
                      <IconButton label="Remove edge" icon={<TrashIcon />} disabled={!editable}
                        onClick={() => updateGraph({ edges: edges.filter((_, i) => i !== index) })} />
                    </div>
                    <NumberField label="Max rounds" min={0} fullWidth disabled={!editable} value={typeof edge.maxRounds === "number" ? edge.maxRounds : 0}
                      unit={typeof edge.maxRounds === "number" ? undefined : "No limit"}
                      labelAction={<FieldHelp title="Max rounds">How many times this arrow can send the job here. When it is reached, the job pauses and asks you whether to allow more rounds or end it. 0 means no limit.</FieldHelp>}
                      onValueChange={(next) => update({ edges: edges.map((item, i) => i === index ? { ...edge, maxRounds: next ? next : undefined } : item) })} />
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
              </>}
            </fieldset>}
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
    return path.endsWith(".json") && name && !errors.length ? [{ value: name, label: templateTitle(name) }] : [];
  });
}

export function RecipeEditor({ newTemplate = false }: { newTemplate?: boolean }) {
  const { id, "*": path = "" } = useParams();
  const [query] = useSearchParams();
  const projectContext: string | undefined = !newTemplate ? ProjectId.safeParse(query.get("project")).data : undefined;
  return <RecipeFile key={newTemplate ? "new-template" : `${id ?? path}:${projectContext ?? ""}`} path={path} project={id} projectContext={projectContext} newTemplate={newTemplate} />;
}
