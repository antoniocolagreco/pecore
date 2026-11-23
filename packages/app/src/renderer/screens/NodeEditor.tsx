import { cloneElement, useEffect, useId, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Link, useBlocker, useNavigate, useParams } from "react-router";
import { ApiError, HumanMode, isNodeKindTag, Name, normalizeLegacyHumanNode, ReviewView } from "@pecore/schemas";
import type { DefinitionFile, Node, RouteResult } from "@pecore/schemas";
import { basicSetup, EditorView, minimalSetup } from "codemirror";
import { Compartment, EditorState } from "@codemirror/state";
import { lineNumbers } from "@codemirror/view";
import { setDiagnostics } from "@codemirror/lint";
import type { Diagnostic } from "@codemirror/lint";
import { highlight } from "../components/CodeSnapshot";
import { templateTitle } from "../components/templateTitle";
import { markdown } from "@codemirror/lang-markdown";
import { StreamLanguage } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { call } from "../api/client";
import { errorText, useAction, useData } from "../api/hooks";
import { useConnected, useLive } from "../api/live";
import { defaultDefinitionIcon, DefinitionIconField, useDefinitionIcons } from "../components/DefinitionIcon";
import { restorePageScroll } from "../components/usePageScroll";
import { Button, ErrorText, Modal, Page, Panel, ui } from "../components/ui";
import { TextArea, TextField } from "../ds/field";
import { FieldHelp } from "../ds/overlay";
import { MultiCombobox, Select } from "../ds/select";
import { nodeKindLabels } from "../components/NodeCard";
import s from "./Editors.module.css";

export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function parseDraft(content: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(content);
    return value && typeof value === "object" && !Array.isArray(value) ? object(value) : null;
  } catch {
    return null;
  }
}

export function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function definitionUrl(kind: "node" | "recipe", path: string): string {
  return "/edit/" + kind + "/" + path.split("/").map(encodeURIComponent).join("/");
}

export function settingUrl(section: string): string {
  return "/settings?section=" + encodeURIComponent(section);
}

type Validation = RouteResult<"validateDefinition">;
type Snapshot = Pick<DefinitionFile, "content"> & { sha256: string | null };
export type NewDefinition = { content: string; path(content: string): string };

export function useDefinitionDraft(existingPath: string, sidecar = false, creation?: NewDefinition, revalidate = "") {
  const connected: boolean = useConnected();
  const remote = useData(async (): Promise<Snapshot> => {
    if (creation) return { content: creation.content, sha256: null };
    try {
      return await call("getDefinition", { params: { path: existingPath } });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return { content: "", sha256: null };
      throw error;
    }
  }, [existingPath, creation]);
  const [base, setBase] = useState<Snapshot>();
  const [draft, setDraft] = useState<string>();
  const [changed, setChanged] = useState(false);
  const [compared, setCompared] = useState<Snapshot>();
  const [savedPath, setSavedPath] = useState<string>();
  const [validation, setValidation] = useState<{ content: string; result?: Validation; error?: string }>();
  const saving = useRef(false);
  const pending = useRef<{ sha256: string | null } | null>(null);
  const baseline: Snapshot | undefined = base ?? remote.data;
  const content: string = draft ?? baseline?.content ?? "";
  const path: string = creation ? creation.path(content) : existingPath;
  const dirty: boolean = draft !== undefined && content !== baseline?.content;

  useLive((message): void => {
    if (creation) return;
    if (message.type !== "definition.changed" || message.path !== path || message.sha256 === baseline?.sha256) return;
    if (saving.current) {
      pending.current = { sha256: message.sha256 };
      return;
    }
    setChanged(true);
    setCompared(undefined);
  }, [path, baseline?.sha256]);

  useEffect(() => {
    if (!base && remote.data) setBase(remote.data);
    else if (base && remote.data && remote.data.sha256 !== base.sha256) {
      setChanged(true);
      setCompared(undefined);
    }
  }, [remote.data]);

  useEffect(() => {
    if (!connected || !baseline || !path || sidecar) return;
    let active: boolean = true;
    const timer = window.setTimeout(() => {
      void call("validateDefinition", { body: { path, content } }).then(
        (result) => { if (active) setValidation({ content, result }); },
        (error: unknown) => { if (active) setValidation({ content, error: errorText(error) }); },
      );
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [path, content, connected, !!baseline, sidecar, revalidate]);

  const compare = useAction(async () => {
    try {
      setCompared(await call("getDefinition", { params: { path } }));
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) throw error;
      setCompared({ content: "", sha256: null });
    }
  });

  const save = useAction(async (overwrite?: Snapshot) => {
    if (!baseline || saving.current) return;
    saving.current = true;
    let savedHash: string | null = null;
    try {
      const result = await call("saveDefinition", { params: { path }, body: { content, baseSha256: (overwrite ?? baseline).sha256 } });
      savedHash = result.sha256;
      setBase({ content, sha256: savedHash });
      setDraft(undefined);
      setChanged(false);
      setCompared(undefined);
      if (creation) setSavedPath(path);
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 409)) throw error;
      if (creation) throw new Error("A definition with this name already exists. Choose another name.", { cause: error });
      setBase(baseline);
      setChanged(true);
      setCompared(undefined);
    } finally {
      saving.current = false;
      const notice = pending.current;
      pending.current = null;
      if (notice && notice.sha256 !== savedHash) {
        setChanged(true);
        setCompared(undefined);
      }
    }
  });

  const reload = useAction(async () => {
    if (dirty && !window.confirm("Discard your unsaved changes?")) return;
    let latest: Snapshot;
    try {
      latest = await call("getDefinition", { params: { path } });
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) throw error;
      latest = { content: "", sha256: null };
    }
    setBase(latest);
    setDraft(undefined);
    setCompared(undefined);
    setChanged(false);
    save.clear();
  });

  const errors = validation?.content === content ? validation.result?.errors : undefined;
  const warnings = validation?.content === content ? validation.result?.warnings : undefined;
  const canSave: boolean = connected && !!path && !save.busy && !compare.busy && !reload.busy && (sidecar || errors?.length === 0);

  return {
    content, dirty, ready: !!baseline && (!!creation || sidecar || baseline.sha256 !== null || dirty), errors, warnings, savedPath,
    editable: connected && !save.busy && !reload.busy,
    update(value: string): void { if (!base && baseline) setBase(baseline); setDraft(value); },
    feedback: <>
      <ErrorText error={remote.error ?? save.error ?? compare.error ?? reload.error ?? (validation?.content === content ? validation.error : undefined)} />
      {!baseline && remote.loading && <p className={ui.muted}>Loading definition…</p>}
      {baseline?.sha256 === null && !creation && !sidecar && !dirty && <ErrorText error="Definition file is missing." />}
      {changed && <Panel>
        <p>Changed elsewhere: reload, compare, keep mine</p>
        <div className={ui.row}>
          <Button disabled={!connected || save.busy || reload.busy} onClick={() => void reload.run()}>Reload</Button>
          <Button disabled={!connected || save.busy || compare.busy} onClick={() => void compare.run()}>Compare</Button>
          <Button disabled={!canSave || !compared} onClick={() => void save.run(compared)}>Keep mine</Button>
        </div>
        {compared && <div className={s.compare}><div>On disk<pre>{compared.sha256 === null ? "File removed" : compared.content}</pre></div><div>Mine<pre>{content}</pre></div></div>}
      </Panel>}
    </>,
    saveButton: (disabled = false): ReactNode => <Button kind="primary" disabled={disabled || !canSave || !dirty || changed} onClick={() => void save.run()}>Save{sidecar ? " file" : ""}</Button>,
  };
}

export function useUnsaved(dirty: boolean): ReactNode {
  const connected: boolean = useConnected();
  const blocker = useBlocker(dirty);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent): void => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  return <Modal open={blocker.state === "blocked"} onClose={() => blocker.reset?.()} title="Unsaved changes">
    <p>Leave this editor and discard your changes?</p>
    <div className={ui.row}>
      <Button disabled={!connected} onClick={() => blocker.reset?.()}>Stay</Button>
      <Button kind="danger" disabled={!connected} onClick={() => blocker.proceed?.()}>Discard and leave</Button>
    </div>
  </Modal>;
}

export function DefinitionErrors({ errors }: { errors: RouteResult<"validateDefinition">["errors"] | undefined }) {
  return <>{errors?.map((error, index) => <ErrorText key={index} error={[error.path, error.message].filter(Boolean).join(": ")} />)}</>;
}

const editorTheme = EditorView.theme({
  "&": { backgroundColor: "var(--surface)", color: "var(--text)" },
  ".cm-gutters": { backgroundColor: "var(--surface-raised)", color: "var(--text-muted)" },
  ".cm-content": { caretColor: "var(--text)", fontFamily: "var(--mono)" },
  ".cm-scroller": { maxHeight: "55vh", minHeight: "12rem" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "color-mix(in srgb, var(--text) 6%, transparent)" },
  ".cm-activeLineGutter": { color: "var(--text)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { backgroundColor: "color-mix(in srgb, var(--accent) 30%, transparent)" },
});

const paddedLineNumbers = lineNumbers({ formatNumber: (line, state) => String(line).padStart(String(state.doc.lines).length, "0") });

const paperTheme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "transparent", color: "var(--paper-ink)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font)", fontSize: "16px", lineHeight: "28px", overflow: "auto",
    backgroundImage: "repeating-linear-gradient(to bottom, transparent 0 27px, var(--paper-rule) 27px 28px)",
    backgroundAttachment: "local",
    backgroundPosition: "0 20px",
  },
  ".cm-content": { padding: "20px 40px 48px", caretColor: "var(--paper-ink)" },
  ".cm-line": { padding: "0" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { backgroundColor: "color-mix(in srgb, var(--accent) 25%, transparent)" },
});

type EditorIssue = { line?: number; column?: number; length?: number; message: string };
const noIssues: EditorIssue[] = [];

export function Sidecar({ content, disabled, change, isMarkdown, errors = noIssues, warnings = noIssues, paper = false, className }: {
  content: string; disabled: boolean; change(value: string): void; isMarkdown: boolean; errors?: EditorIssue[]; warnings?: EditorIssue[];
  paper?: boolean; className?: string;
}) {
  const parent = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);
  const binding = useRef({ content, disabled, change });
  const readOnly = useRef(new Compartment());
  const syncing = useRef(false);
  useEffect(() => { binding.current = { content, disabled, change }; });
  useEffect(() => {
    if (!parent.current) return;
    const config: Compartment = readOnly.current;
    const editor = new EditorView({
      parent: parent.current,
      doc: binding.current.content,
      extensions: [
        ...(paper ? [minimalSetup, paperTheme, EditorView.lineWrapping] : [basicSetup, editorTheme, paddedLineNumbers]),
        highlight, isMarkdown ? markdown() : StreamLanguage.define(shell),
        config.of([EditorState.readOnly.of(binding.current.disabled), EditorView.editable.of(!binding.current.disabled)]),
        EditorView.updateListener.of((event) => {
          if (event.docChanged && !syncing.current && !binding.current.disabled) binding.current.change(event.state.doc.toString());
        }),
      ],
    });
    view.current = editor;
    return () => { view.current = null; editor.destroy(); };
  }, [isMarkdown, paper]);
  useEffect(() => {
    const editor: EditorView | null = view.current;
    if (!editor) return;
    syncing.current = true;
    const current: string = editor.state.doc.toString();
    editor.dispatch({
      changes: current === content ? undefined : { from: 0, to: current.length, insert: content },
      effects: readOnly.current.reconfigure([EditorState.readOnly.of(disabled), EditorView.editable.of(!disabled)]),
    });
    syncing.current = false;
  }, [content, disabled]);
  useEffect(() => {
    const editor: EditorView | null = view.current;
    if (!editor) return;
    const doc = editor.state.doc;
    const place = (issue: EditorIssue, severity: Diagnostic["severity"]): Diagnostic[] => {
      if (!issue.line || issue.line > doc.lines) return [];
      const line = doc.line(issue.line);
      const from: number = Math.min(line.from + (issue.column ?? 1) - 1, line.to);
      const to: number = issue.length ? Math.min(from + issue.length, line.to) : line.to;
      return [{ from, to: Math.max(from, to), severity, message: issue.message }];
    };
    editor.dispatch(setDiagnostics(editor.state, [...errors.flatMap((issue) => place(issue, "error")), ...warnings.flatMap((issue) => place(issue, "warning"))]));
  }, [content, errors, warnings]);
  return <div ref={parent} className={className} />;
}

function SidecarFile({ path, name, isMarkdown, onDirty }: { path: string; name: string; isMarkdown: boolean; onDirty(dirty: boolean): void }) {
  const file = useDefinitionDraft(path, true);
  useEffect(() => { onDirty(file.dirty); return () => onDirty(false); }, [file.dirty, onDirty]);
  return <Panel>
    <h2>{isMarkdown ? "Prompt" : "Script"} <code>{name}</code></h2>
    {file.feedback}
    {file.ready && <><Sidecar content={file.content} change={file.update} disabled={!file.editable} isMarkdown={isMarkdown} />{file.saveButton()}</>}
  </Panel>;
}

const nodeKinds: { value: Node["kind"]; label: string }[] = [
  { value: "agent", label: nodeKindLabels.agent },
  { value: "command", label: nodeKindLabels.command },
  { value: "human", label: nodeKindLabels.human },
];
const humanModes: { value: HumanMode; label: string }[] = [
  { value: "decision", label: "Decision" },
  { value: "review", label: "Review" },
];
const humanFields: Record<HumanMode, Record<string, unknown>> = {
  decision: { mode: "decision", reviewView: undefined, answer: false, outcomes: ["yes", "no"] },
  review: { mode: "review", reviewView: "code", answer: true, outcomes: ["approve", "changes", "reject"] },
};
const reviewViews: { value: ReviewView; label: string }[] = [
  { value: "report", label: "Report" }, { value: "code", label: "Code" },
];
const initialNodeFields: Record<Node["kind"], Record<string, unknown>> = {
  agent: {
    outcomes: ["done"], changesFiles: false, timeoutSec: 120, agent: { tier: "standard" },
    outputSchema: { type: "object", properties: { outcome: { type: "string" } }, required: ["outcome"] },
  },
  command: {
    outcomes: ["passed", "failed"], failOutcomes: ["failed"], changesFiles: false, timeoutSec: 120,
    outcomeRules: [{ exitCode: 0, outcome: "passed" }, { exitCode: "other", outcome: "failed" }],
  },
  human: humanFields.decision,
  source: { list: {}, read: {}, comment: {}, replies: {} },
};
const sourceCommands: { key: string; label: string }[] = [
  { key: "list", label: "List command" },
  { key: "read", label: "Read command" },
  { key: "comment", label: "Comment command" },
  { key: "replies", label: "Replies command" },
];
const newNodeTemplate: NewDefinition = {
  content: JSON.stringify({ $schema: "../../schemas/node.json", name: "", description: "", icon: defaultDefinitionIcon.node }, null, 2) + "\n",
  path(content) {
    const name = Name.safeParse(parseDraft(content)?.name);
    return name.success ? `templates/nodes/${name.data}.json` : "";
  },
};

function NodeFile({ path, newTemplate }: { path: string; newTemplate: boolean }) {
  const navigate = useNavigate();
  const fieldId: string = useId();
  const creation: NewDefinition | undefined = newTemplate ? newNodeTemplate : undefined;
  const file = useDefinitionDraft(path, false, creation);
  const icons = useDefinitionIcons();
  const [sidecarDirty, setSidecarDirty] = useState(false);
  const [sidecarName, setSidecarName] = useState("");
  const warn = useUnsaved(file.dirty || sidecarDirty);
  useEffect(() => {
    if (file.savedPath) void navigate(definitionUrl("node", file.savedPath), { replace: true });
  }, [file.savedPath, navigate]);
  const parsed = parseDraft(file.content);
  const draft = parsed && normalizeLegacyHumanNode(parsed);
  const kind: string = string(draft?.kind);
  const human: boolean = kind === "human";
  const mode: string = string(draft?.mode);
  const reviewView: ReviewView | undefined = ReviewView.safeParse(draft?.reviewView).data;
  const tags: string[] = Array.isArray(draft?.tags) ? draft.tags.map(string) : [];
  const descriptiveTags: string[] = tags.filter((tag) => !isNodeKindTag(tag));
  const knowledge: string[] = Array.isArray(draft?.knowledge) ? draft.knowledge.map(string).filter(Boolean) : [];
  const knowledgeNames = useData(async () => {
    const projects = await call("listProjects");
    const lists = await Promise.all(projects.map(({ id }) => call("listDefinitions", { query: { dir: `projects/${id}/knowledge` } }).catch(() => [])));
    return [...new Set(lists.flat().map(({ path }) => path.slice(path.lastIndexOf("/") + 1)))].sort();
  }, []);
  const definitionPath: string = creation ? creation.path(file.content) : path;
  const reference: string = string(draft?.[kind === "agent" ? "prompt" : "script"]);
  const validSidecar: string = (kind === "agent" && /^[\w.-]+\.md$/.test(reference)) || (kind === "command" && /^[\w.-]+\.sh$/.test(reference)) ? reference : "";
  useEffect(() => { if (!sidecarDirty) setSidecarName(validSidecar); }, [validSidecar, sidecarDirty]);
  const update = (key: string, value: unknown): void => file.update(JSON.stringify({
    ...draft, ...(descriptiveTags.length !== tags.length ? { tags: descriptiveTags } : {}), [key]: value,
  }, null, 2) + "\n");
  const inlineKeys: string[] = [
    "description", "tags", "timeoutSec",
    ...(kind === "source" ? ["credentials"] : ["outcomes", "changesFiles"]),
    ...(kind === "agent" ? ["prompt", "resume", "knowledge"] : []),
    ...(kind === "command" ? ["script", "runsAs", "cleanCheckout"] : []),
    ...(human ? ["mode", "show", "reviewView", "answer"] : []),
  ];
  const fieldErrors = (key: string): ReactNode => <DefinitionErrors errors={file.errors?.filter(({ path }) => path.split(".")[0] === key)} />;
  const help = (label: string, text: ReactNode): ReactNode => creation && <FieldHelp title={label}>{text}</FieldHelp>;
  const field = (key: string, label: string, input: ReactElement<{ id?: string }>, text: string): ReactNode => {
    const id: string = `${fieldId}-${key}`;
    return <div>
      <div className={ui.field}>
        <div className={s.fieldHeading}><label htmlFor={id}>{label}</label>{help(label, text)}</div>
        {cloneElement(input, { id })}
      </div>
      {fieldErrors(key)}
    </div>;
  };
  const textField = (key: string, label: string, text: string): ReactNode => field(key, label,
    <input value={string(draft?.[key])} onChange={(event) => update(key, event.target.value || undefined)} />, text);
  const flag = (key: string, label: string, text: string): ReactNode => <div>
    <div className={s.fieldHeading}>
      <label><input type="checkbox" checked={draft?.[key] === true} onChange={(event) => update(key, event.target.checked)} /> {label}</label>
      {help(label, text)}
    </div>
    {fieldErrors(key)}
  </div>;
  const commandField = (label: string, value: unknown, onChange: (command: string[] | undefined) => void): ReactNode => (
    <TextArea label={label} labelAction={help(label, "Run an executable directly. Use Script file if the command needs shell features such as pipes or redirection.")}
      description="Enter the executable and each argument on its own line." value={Array.isArray(value) ? value.join("\n") : ""}
      onValueChange={(text) => onChange(text ? text.split("\n") : undefined)} />
  );
  return <Page title={creation ? "New Node" : templateTitle(string(draft?.name)) || "Node editor"} actions={file.saveButton(newTemplate && sidecarDirty)}>
    {(newTemplate || path.startsWith("templates/")) && <Link to="/templates" state={restorePageScroll}>Back to templates</Link>}
    {file.feedback}
    {file.ready && <Panel>
      {draft ? (
        <fieldset className={s.fields} disabled={!file.editable}>
          {creation ? <>
            <TextField label="Name" required value={string(draft.name)} disabled={sidecarDirty}
              labelAction={help("Name", "Recipes use this name to refer to the node template.")}
              description="Lowercase letters, digits and hyphens. Start with a letter." onValueChange={(name) => update("name", name)} />
            <Select label="Kind" labelAction={help("Kind", "Agent gives a task to an AI model. Run command runs a program or script. Human pauses the job for a person to respond.")}
              options={nodeKinds} value={kind || null} disabled={sidecarDirty} onValueChange={(value) => {
              const next: Node["kind"] | undefined = nodeKinds.find((option) => option.value === value)?.value;
              if (!next) return;
              const { $schema, name, description, icon, params } = draft;
              file.update(JSON.stringify({ $schema, name, description, icon, tags: descriptiveTags, params, kind: next, ...initialNodeFields[next] }, null, 2) + "\n");
            }} />
          </> : <p>Kind: {kind === "source" ? nodeKindLabels.source : nodeKinds.find((option) => option.value === kind)?.label ?? kind}</p>}
          {human && (creation ? <><Select label="Mode" labelAction={help("Mode", "Decision asks a question in Notifications and follows the answer you select. Review shows job artifacts and asks you to approve, request changes or reject.")}
            options={humanModes} value={mode} onValueChange={(value) => {
            const next = HumanMode.safeParse(value);
            if (next.success) file.update(JSON.stringify({ ...draft, tags: descriptiveTags, ...humanFields[next.data] }, null, 2) + "\n");
          }} />{fieldErrors("mode")}</> : <p>Mode: {humanModes.find(({ value }) => value === mode)?.label ?? mode}</p>)}
          {field("description", "Description", <textarea value={string(draft.description)} onChange={(event) => update("description", event.target.value)} />,
            human && mode === "decision" ? "Write the question the user will see in Notifications. The recipe can supply a different question if the node defines a question parameter."
              : "Say what this node does so people can identify it in Templates.")}
          {field("tags", "Tags (comma separated)", <input value={(file.dirty ? tags : descriptiveTags).join(",")} onChange={(event) => {
            update("tags", event.target.value === "" ? undefined : event.target.value.split(","));
          }} onBlur={() => { if (file.dirty && tags.length !== descriptiveTags.length) update("tags", descriptiveTags); }} />,
          "Add terms people can search for, such as lint or deployment. The kind is already searchable.")}
          <DefinitionIconField icons={icons.data} type="node" name={string(draft.name)} value={string(draft.icon)} disabled={!file.editable}
            labelAction={help("Icon", "Choose the symbol used for this node in Templates and recipe diagrams.")}
            onChange={(value) => update("icon", value)} />
          {kind && !human && field("timeoutSec", "Timeout (seconds)", <input type="number" min={1} value={typeof draft.timeoutSec === "number" ? draft.timeoutSec : ""} onChange={(event) => update("timeoutSec", event.target.value ? Number(event.target.value) : undefined)} />,
            "Set how long one attempt can run before PeCore stops it.")}
          {human && mode === "review" && <div>
              <Select label="Review view" options={reviewViews} value={reviewView ?? null}
                placeholder={Array.isArray(draft.show) && draft.show.length ? "Saved artifact list" : "Choose a view"}
                labelAction={<FieldHelp title="Review view">Report shows the latest text from the job, such as a ticket, specification or check log. Code shows the latest code changes and their risk annotations.</FieldHelp>}
                onValueChange={(value) => {
                  const next: ReviewView | undefined = ReviewView.safeParse(value).data;
                  if (!next) return;
                  file.update(JSON.stringify({ ...draft, tags: descriptiveTags, reviewView: next, show: undefined, inputs: undefined }, null, 2) + "\n");
                }} />
              {fieldErrors("reviewView")}{fieldErrors("show")}
          </div>}
          {kind && kind !== "source" && <>
            {field("outcomes", human && mode === "decision" ? "Choices (comma separated)" : "Outcomes (comma separated)", <input value={Array.isArray(draft.outcomes) ? draft.outcomes.join(",") : ""} onChange={(event) => update("outcomes", event.target.value ? event.target.value.split(",") : [])} />,
              human && mode === "decision" ? "Each choice is a button in Notifications and an outcome you can connect in the recipe. For example, yes can continue to the next node and no can go to End."
                : human ? "Review uses approve, changes and reject. Connect each result to the next node or End."
                  : "Give each possible result a name so the recipe can decide where to go next. The command's exit rules or the agent's output must return one of these names.")}
            {!human && flag("changesFiles", "Changes files", "Enable this if the node writes to the job's files. PeCore fails the step if a read-only node changes them.")}
          </>}
          {kind === "agent" && <>{textField("prompt", "Prompt file", "Enter the name of the Markdown file containing instructions for the AI model.")}
            <div>
              <MultiCombobox label="Knowledge" placeholder="Choose knowledge files" value={knowledge} disabled={!file.editable}
                labelAction={help("Knowledge", "The project knowledge files this node gives its agent, and the files they link to. Each project gives its own file with that name; a project without it gives nothing. Write them in the project's Knowledge tab.")}
                options={[...new Set([...(knowledgeNames.data ?? []), ...knowledge])].map((name) => ({ value: name, label: name }))}
                onValueChange={(next) => update("knowledge", next.length ? next : undefined)} />
              {fieldErrors("knowledge")}
            </div>
            {flag("resume", "Resume session", "Continue the previous conversation if this step runs again in the same job.")}</>}
          {kind === "command" && <>
            {creation && !draft.script && commandField("Command", draft.command, (command) => update("command", command))}
            {(!creation || !draft.command) && textField("script", "Script file", "Enter the name of the .sh file to run. Choose either a command or a script file.")}
            {field("runsAs", "Runs as", <select value={string(draft.runsAs) || "project-user"} onChange={(event) => update("runsAs", event.target.value)}><option>project-user</option><option>engine</option></select>,
              "Use project-user for commands in the job's working copy. Engine is for integrations that may need PeCore's credentials. Engine commands need a probe and must leave job files unchanged.")}
            {flag("cleanCheckout", "Clean checkout", "Run a project-user command on a temporary clean copy of the job's files.")}
          </>}
          {human && flag("answer", "Allow an optional note", "Show a Note field in Notifications. The user can add text to their answer. A later node that accepts user-note can read it.")}
          {creation && kind === "source" && sourceCommands.map(({ key, label }) => {
            const action = object(draft[key]);
            return !action.script && <div key={key}>{commandField(label, action.command, (command) => update(key, { ...action, command }))}</div>;
          })}
          {kind === "source" && field("credentials", "Credentials (comma separated)", <input value={Array.isArray(draft.credentials) ? draft.credentials.join(",") : ""} onChange={(event) => update("credentials", event.target.value ? event.target.value.split(",") : [])} />,
            "List the account names that this source needs to access its ticket system.")}
        </fieldset>
      ) : <ErrorText error="Unable to read the node definition." />}
      <DefinitionErrors errors={draft ? file.errors?.filter(({ path }) => !inlineKeys.includes(path.split(".")[0] ?? "")) : file.errors} />
    </Panel>}
    {sidecarDirty && sidecarName !== validSidecar && <p className={ui.banner}>Save the open sidecar before switching files.</p>}
    {sidecarName && definitionPath && <SidecarFile key={sidecarName} path={definitionPath.slice(0, definitionPath.lastIndexOf("/") + 1) + sidecarName} name={sidecarName} isMarkdown={sidecarName.endsWith(".md")} onDirty={setSidecarDirty} />}
    {warn}
  </Page>;
}

export function NodeEditor({ newTemplate = false }: { newTemplate?: boolean }) {
  const path: string = useParams()["*"] ?? "";
  return <NodeFile key={newTemplate ? "new-template" : path} path={path} newTemplate={newTemplate} />;
}
