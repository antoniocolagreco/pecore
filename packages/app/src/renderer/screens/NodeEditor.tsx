import { cloneElement, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { ReactElement, ReactNode, Ref } from "react";
import { Link, useBlocker, useNavigate, useParams } from "react-router";
import { AgentSession, ApiError, ArtifactType, HumanInterface, humanInterfaces, isForgeOperation, isNodeKindTag, Name, NodeOutputType } from "@pecore/schemas";
import type { DefinitionFile, Node, RouteResult } from "@pecore/schemas";
import { basicSetup, EditorView, minimalSetup } from "codemirror";
import { Compartment, EditorState } from "@codemirror/state";
import { lineNumbers } from "@codemirror/view";
import { setDiagnostics } from "@codemirror/lint";
import type { Diagnostic } from "@codemirror/lint";
import { highlight } from "../components/CodeSnapshot";
import { AgentSessionField } from "../components/AgentFields";
import { templateTitle } from "../components/templateTitle";
import { markdown } from "@codemirror/lang-markdown";
import { StreamLanguage } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { call } from "../api/client";
import { errorText, useAction, useData } from "../api/hooks";
import { useConnected, useLive } from "../api/live";
import { defaultDefinitionIcon, DefinitionIconField, useDefinitionIcons } from "../components/DefinitionIcon";
import { restorePageScroll } from "../components/usePageScroll";
import { ErrorText, Page, ui } from "../components/ui";
import { Button } from "../ds/button";
import { Alert, Card } from "../ds/feedback";
import { Checkbox, Chip, Chips } from "../ds/choice";
import { TextArea, TextField } from "../ds/field";
import { NumberField } from "../ds/values";
import { Dialog, FieldHelp } from "../ds/overlay";
import { Select } from "../ds/select";
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
type Snapshot = Pick<DefinitionFile, "content" | "chatApproval"> & { sha256: string | null };
export type NewDefinition = { content: string; path(content: string): string };

export function useDefinitionDraft(existingPath: string, sidecar = false, creation?: NewDefinition, revalidate = "", showLoading = true) {
  const connected: boolean = useConnected();
  const remote = useData(async (): Promise<Snapshot> => {
    if (creation || !existingPath) return { content: creation?.content ?? "", sha256: null };
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
      throw error;
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
  const canCommit: boolean = canSave && dirty && !changed;

  return {
    content, dirty, ready: !!baseline && (!!creation || sidecar || baseline.sha256 !== null || dirty), errors, warnings, savedPath,
    sha256: baseline?.sha256 ?? null, chatApproval: baseline?.chatApproval,
    canCommit, canWrite: canSave && !changed, commit: save.run,
    editable: connected && !save.busy && !reload.busy,
    update(value: string): void { if (!base && baseline) setBase(baseline); setDraft(value); },
    feedback: <>
      <ErrorText error={remote.error ?? save.error ?? compare.error ?? reload.error ?? (validation?.content === content ? validation.error : undefined)} />
      {showLoading && !baseline && remote.loading && <p className={ui.muted}>Loading definition…</p>}
      {baseline?.sha256 === null && !creation && !sidecar && !dirty && <ErrorText error="Definition is missing." />}
      {changed && <Card padded>
        <p>Changed elsewhere: reload, compare, keep mine</p>
        <div className={ui.row}>
          <Button disabled={!connected || save.busy || reload.busy} onClick={() => void reload.run()}>Reload</Button>
          <Button disabled={!connected || save.busy || compare.busy} onClick={() => void compare.run()}>Compare</Button>
          <Button disabled={!canSave || !compared} onClick={() => void save.run(compared)}>Keep mine</Button>
        </div>
        {compared && <div className={s.compare}><div>On disk<pre>{compared.sha256 === null ? "File removed" : compared.content}</pre></div><div>Mine<pre>{content}</pre></div></div>}
      </Card>}
    </>,
    saveButton: (disabled = false): ReactNode => <Button variant="primary" disabled={disabled || !canCommit} onClick={() => void save.run()}>Save</Button>,
  };
}

export function DeleteTemplateButton({ path, sha256, title, disabled }: {
  path: string; sha256: string | null; title: string; disabled: boolean;
}) {
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);
  const isRecipe: boolean = path.startsWith("templates/recipes/");
  const label: string = isRecipe ? "Delete recipe" : "Delete node";
  const name: string = path.slice("templates/nodes/".length, -5);
  const usage = useData((): Promise<string[]> => isRecipe ? Promise.resolve([]) : call("getNodeTemplateUsage", { params: { name } }),
    [path], (event) => !isRecipe && (event.type === "project.updated" ||
      (event.type === "definition.changed" && event.path.includes("/recipes/"))));
  const reason: string | undefined = isRecipe ? undefined
    : usage.error ? "Could not check whether this node is in use."
      : !usage.data ? "Checking whether this node is in use…"
        : usage.data.length ? `Used by ${usage.data.join(", ")}.` : undefined;
  const unavailable: boolean = disabled || !sha256 || !!reason;
  const remove = useAction(async () => {
    if (!sha256) return;
    try {
      await call("deleteTemplate", { params: { path }, body: { baseSha256: sha256 } });
    } catch (error) {
      if (!isRecipe) usage.reload();
      throw error;
    }
    await navigate(isRecipe ? "/templates?tab=recipes" : "/templates", { replace: true, state: restorePageScroll });
  });
  const trigger = <Button variant="danger" disabled={unavailable} onClick={() => { remove.clear(); setDeleting(true); }}>{label}</Button>;
  return <>
    {reason ? <span title={reason}>{trigger}</span> : trigger}
    <Dialog open={deleting} onOpenChange={(open) => { if (!open && !remove.busy) setDeleting(false); }}
      title={`Delete ${title}?`} footer={<>
        <Button disabled={remove.busy} onClick={() => setDeleting(false)}>Cancel</Button>
        <Button variant="dangerSolid" loading={remove.busy} disabled={unavailable} onClick={() => void remove.run()}>{label}</Button>
      </>}>
      <ErrorText error={remove.error} />
    </Dialog>
  </>;
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
  return <Dialog
    open={blocker.state === "blocked"}
    onOpenChange={(open) => !open && blocker.reset?.()}
    title="Unsaved changes"
    description="Leave this editor and discard your changes?"
    width={400}
    footer={<>
      <Button disabled={!connected} onClick={() => blocker.reset?.()}>Stay</Button>
      <Button variant="dangerSolid" disabled={!connected} onClick={() => blocker.proceed?.()}>Discard and leave</Button>
    </>}
  />;
}

export function DefinitionErrors({ errors, showPath = true }: { errors: RouteResult<"validateDefinition">["errors"] | undefined; showPath?: boolean }) {
  return <>{errors?.map((error, index) => <ErrorText key={index} error={showPath && error.path ? error.path + ": " + error.message : error.message} />)}</>;
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
  },
  ".cm-content": { padding: "20px 40px 48px", caretColor: "var(--paper-ink)" },
  ".cm-line": { padding: "0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftWidth: "3px", borderLeftColor: "var(--paper-ink)", marginLeft: "-1px" },
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
  return <div ref={parent} className={[paper && s.paperEditor, className].filter(Boolean).join(" ")} />;
}

type SidecarStatus = { path: string; ready: boolean; dirty: boolean; missing: boolean; canCommit: boolean };
type SidecarHandle = { commit(): Promise<boolean> };

function SidecarFile({ path, name, isMarkdown, disabled, onStatus, ref }: {
  path: string; name: string; isMarkdown: boolean; disabled: boolean;
  onStatus(status: SidecarStatus): void; ref: Ref<SidecarHandle>;
}) {
  const file = useDefinitionDraft(path, true);
  useImperativeHandle(ref, () => ({ commit: file.commit }), [file.commit]);
  useEffect(() => onStatus({ path, ready: file.ready, dirty: file.dirty, missing: file.sha256 === null, canCommit: file.canWrite }),
    [path, file.ready, file.dirty, file.sha256, file.canWrite, onStatus]);
  return <section className={s.sidecar}>
    <h2>{isMarkdown ? "Node Context" : <>Script <code>{name}</code></>}</h2>
    {file.feedback}
    {file.ready && <Sidecar content={file.content} change={file.update} disabled={disabled || !file.editable}
      isMarkdown={isMarkdown} paper={isMarkdown} className={isMarkdown ? s.prompt : undefined} />}
  </section>;
}

function parseCommand(text: string): string[] {
  return [...text.matchAll(/"([^"]*)"|'([^']*)'|([^\s"']+)/g)].map((match) => match[1] ?? match[2] ?? match[3] ?? "");
}

function formatCommand(argv: string[]): string {
  return argv.map((arg) => /^[^\s"']+$/.test(arg) ? arg : arg.includes("\"") ? `'${arg}'` : `"${arg}"`).join(" ");
}

function CommandInput({ label, labelAction, description = "Write it as in a terminal, for example npx eslint . Put an argument with spaces in quotes.", value, onChange }: {
  label: string; labelAction: ReactNode; description?: string; value: string[]; onChange(command: string[] | undefined): void;
}) {
  const [text, setText] = useState<string>(() => formatCommand(value));
  useEffect(() => {
    if (JSON.stringify(parseCommand(text)) !== JSON.stringify(value)) setText(formatCommand(value));
  }, [value]);
  return <TextField label={label} labelAction={labelAction} mono value={text}
    description={description}
    onValueChange={(next) => {
      setText(next);
      const argv: string[] = parseCommand(next);
      onChange(argv.length ? argv : undefined);
    }} />;
}

const nodeKinds: { value: Node["kind"]; label: string }[] = [
  { value: "agent", label: nodeKindLabels.agent },
  { value: "command", label: nodeKindLabels.command },
  { value: "human", label: nodeKindLabels.human },
  { value: "repository", label: nodeKindLabels.repository },
];
const interfaceOptions: { value: HumanInterface; label: string }[] = HumanInterface.options.map((value) => ({ value, label: humanInterfaces[value].label }));
const humanFields: Record<HumanInterface, Record<string, unknown>> = {
  decision: { interface: "decision", outcomes: ["yes", "no"], outputs: undefined },
  "code-review": { interface: "code-review", outcomes: ["approved", "changes_requested", "rejected"], outputs: { changes_requested: "code_review" } },
  "report-review": { interface: "report-review", outcomes: ["approved", "changes_requested", "rejected"], outputs: { changes_requested: "feedback" } },
};
const typeLabels: Record<ArtifactType, string> = {
  diff: "Diff", spec: "Spec", code_review: "Code review", code_analysis: "Code analysis", sha: "Commit SHA",
  pull_request: "Pull request", feedback: "Feedback", log: "Log",
};
const typeExamples: Record<ArtifactType, string> = {
  diff: "Changes to the code, generated from Git.",
  spec: "A feature and the scenarios that describe how it works.",
  code_review: "A general review with comments on specific lines or hunks.",
  code_analysis: "A summary and a risk classification for each hunk.",
  sha: "The SHA of a Git commit.",
  pull_request: "The title and body of a pull request, plus its URL after delivery.",
  feedback: "What needs to change before the work can continue.",
  log: "Output from running a node, such as errors from TypeScript.",
};
const inputTypes: ArtifactType[] = [...NodeOutputType.options, "diff"];
const typesHelp: ReactNode = <>
  {inputTypes.map((type) => <span key={type}><br /><br /><strong>{typeLabels[type]}</strong>: {typeExamples[type]}</span>)}
</>;
const typeOptions: { value: string; label: string }[] = [{ value: "", label: "Nothing" }, ...NodeOutputType.options.map((type) => ({ value: type, label: typeLabels[type] }))];
const ruleKinds: { value: string; label: string }[] = [
  { value: "stdoutLastLine", label: "Last line of the output" },
  { value: "stdoutJson", label: "Field of JSON output" },
  { value: "file", label: "File in the workdir" },
];
const ruleHints: Record<string, string> = {
  stdoutLastLine: "Name of the field that stores the line, for example url",
  stdoutJson: "Path of the field, for example result.url",
  file: "Path relative to the workdir, for example .pecore/spec.json",
};
const initialNodeFields: Record<Node["kind"], Record<string, unknown>> = {
  agent: { outcomes: ["success"], changesFiles: false, timeoutSec: 120, agent: { tier: "standard" } },
  command: {
    outcomes: ["success", "failure"], failOutcomes: ["failure"], changesFiles: false, timeoutSec: 120,
    outcomeRules: [{ exitCode: 0, outcome: "success" }, { exitCode: "other", outcome: "failure" }],
  },
  human: humanFields.decision,
  repository: {
    script: "", outcomes: ["success", "failure"], failOutcomes: ["failure"],
    outcomeRules: [{ exitCode: 0, outcome: "success" }, { exitCode: "other", outcome: "failure" }],
  },
};

function OutcomeOutputs({ kind, humanInterface, outcomes, outputs, rules, disabled, onChange }: {
  kind: string; humanInterface: HumanInterface | undefined; outcomes: string[]; outputs: Record<string, unknown>; rules: Record<string, unknown>; disabled: boolean;
  onChange(outputs: Record<string, ArtifactType>, rules: Record<string, Record<string, string>>): void;
}) {
  const human: boolean = kind === "human";
  const typed: Record<string, ArtifactType> = Object.fromEntries(Object.entries(outputs).flatMap(([outcome, type]) => {
    const parsed = ArtifactType.safeParse(type);
    return parsed.success ? [[outcome, parsed.data]] : [];
  }));
  const typedRules: Record<string, Record<string, string>> = Object.fromEntries(Object.entries(rules).map(([outcome, rule]) => [outcome, object(rule) as Record<string, string>]));
  const setType = (outcome: string, type: ArtifactType | undefined): void => {
    const nextOutputs = { ...typed };
    const nextRules = { ...typedRules };
    if (type) nextOutputs[outcome] = type;
    else delete nextOutputs[outcome];
    if (kind === "command" || kind === "repository") {
      if (!type) delete nextRules[outcome];
      else if (!nextRules[outcome]) nextRules[outcome] = type === "sha" ? { stdoutLastLine: "sha" } : { file: "" };
    }
    onChange(nextOutputs, nextRules);
  };
  const setRule = (outcome: string, rule: Record<string, string>): void => onChange(typed, { ...typedRules, [outcome]: rule });
  if (!outcomes.length) return null;
  return <div className={s.outputs} role="group" aria-label="Output of each outcome">
    {outcomes.map((outcome) => {
      const type: ArtifactType | undefined = typed[outcome];
      const rule: Record<string, string> = typedRules[outcome] ?? {};
      const ruleKind: string = Object.keys(rule)[0] ?? "";
      return <div key={outcome} className={s.outputRow}>
        {human
          ? <Checkbox label={`${outcome}: the person can write a note`} checked={type === "feedback" || type === "code_review"} disabled={disabled} onCheckedChange={(checked) => setType(outcome, checked ? humanInterface === "code-review" && outcome === "changes_requested" ? "code_review" : "feedback" : undefined)} />
          : <Select label={`Output of ${outcome}`} options={typeOptions} value={type ?? ""} disabled={disabled}
            onValueChange={(value) => setType(outcome, NodeOutputType.safeParse(value).data)} />}
        {(kind === "command" || kind === "repository") && type && <>
          <Select label="Read it from" options={ruleKinds} value={ruleKind || null} disabled={disabled}
            onValueChange={(value) => value && setRule(outcome, { [value]: rule[ruleKind] ?? "" })} />
          {ruleKind && <TextField label={ruleHints[ruleKind] ?? "Value"} mono value={rule[ruleKind] ?? ""} disabled={disabled}
            onValueChange={(value) => setRule(outcome, { [ruleKind]: value })} />}
        </>}
      </div>;
    })}
  </div>;
}

function CommandInputs({ inputs, optional, disabled, onChange }: { inputs: unknown; optional: unknown; disabled: boolean; onChange(inputs: ArtifactType[], optional: ArtifactType[]): void }) {
  const list = (value: unknown): ArtifactType[] => (Array.isArray(value) ? value : []).flatMap((type) => ArtifactType.safeParse(type).data ?? []);
  const required: ArtifactType[] = list(inputs);
  const extra: ArtifactType[] = list(optional);
  const group = (label: string, selected: ArtifactType[], other: ArtifactType[], set: (next: ArtifactType[], rest: ArtifactType[]) => void): ReactNode => <div>
    <div className={s.fieldHeading}><span>{label}</span><FieldHelp title={label}>
      The data this command works on, produced by earlier nodes of the job. For example, a command that opens a pull request needs the spec to write its description. Pick the kinds of data it needs: a required one must exist or the recipe cannot be saved; an optional one is used only if it exists. In the recipe you then choose which node it comes from, with Reads from.{typesHelp}
    </FieldHelp></div>
    <Chips label={label}>
      {inputTypes.map((type) => <Chip key={type} pressed={selected.includes(type)} disabled={disabled}
        onClick={() => set(selected.includes(type) ? selected.filter((t) => t !== type) : [...selected, type], other.filter((t) => t !== type))}>{typeLabels[type]}</Chip>)}
    </Chips>
  </div>;
  return <>
    {group("Required inputs", required, extra, (next, rest) => onChange(next, rest))}
    {group("Optional inputs", extra, required, (next, rest) => onChange(rest, next))}
  </>;
}
const newNodeTemplate: NewDefinition = {
  content: JSON.stringify({ name: "", description: "", icon: defaultDefinitionIcon.node }, null, 2) + "\n",
  path(content) {
    const name = Name.safeParse(parseDraft(content)?.name);
    return name.success ? `templates/nodes/${name.data}.json` : "";
  },
};

function NodeFile({ path, newTemplate }: { path: string; newTemplate: boolean }) {
  const navigate = useNavigate();
  const creation: NewDefinition | undefined = newTemplate ? newNodeTemplate : undefined;
  const file = useDefinitionDraft(path, false, creation);
  const icons = useDefinitionIcons();
  const [sidecarStatus, setSidecarStatus] = useState<SidecarStatus>();
  const [sidecarName, setSidecarName] = useState("");
  const [newContextFile] = useState(() => newTemplate ? `node-context-${crypto.randomUUID()}.md` : "");
  const sidecar = useRef<SidecarHandle>(null);
  const sidecarDirty: boolean = sidecarStatus?.dirty ?? false;
  const warn = useUnsaved(file.dirty || sidecarDirty);
  useEffect(() => {
    if (file.savedPath) void navigate(definitionUrl("node", file.savedPath), { replace: true });
  }, [file.savedPath, navigate]);
  const draft = parseDraft(file.content);
  const kind: string = string(draft?.kind);
  const human: boolean = kind === "human";
  const agent: boolean = kind === "agent";
  const repository: boolean = kind === "repository";
  const builtin: boolean = !creation && repository && isForgeOperation(string(draft?.name)) && !draft?.script;
  const remote: boolean = repository && !builtin;
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [approvedHash, setApprovedHash] = useState<string>();
  const approval = file.chatApproval;
  const approve = useAction(async () => {
    if (!approval) return;
    await call("approveChatNode", { params: { path }, body: { hash: approval.hash } });
    setApprovedHash(approval.hash);
    setApprovalOpen(false);
  });
  const tracker = object(draft?.tracker);
  const trackerAccess: string = string(tracker.access) || "none";
  const accounts = useData(() => remote || (agent && trackerAccess !== "none") ? call("getAccounts") : Promise.resolve(null), [remote, agent, trackerAccess],
    (event) => event.type === "configuration.changed" && event.kind === "accounts");
  const jira = useData(() => agent && trackerAccess !== "none" ? call("getActiveJira") : Promise.resolve(null), [agent, trackerAccess]);
  const options: { value: string; label: string }[] = [{ value: "project.account", label: "Project account" }];
  for (const account of accounts.data?.value.accounts ?? []) {
    if (account.kind === "forge" && (repository || account.forge === "github" || account.forge === "gitlab")) {
      options.push({ value: account.id, label: `${account.user || account.id} · ${account.host}` });
    }
    if (agent && account.kind === "service" && (account.tool === "atlassian" || account.tool === "linear")) {
      options.push({ value: account.id, label: `${account.service} · ${account.user}` });
    }
  }
  if (agent && jira.data) options.push({ value: "active-jira", label: `Active Jira login · ${jira.data.site}` }, { value: jira.data.account.id, label: jira.data.account.user });
  const selectedAccount: string = string(agent ? tracker.account : draft?.account);
  if (selectedAccount && !options.some(({ value }) => value === selectedAccount)) options.push({ value: selectedAccount, label: "Account unavailable" });
  const iface: HumanInterface | undefined = HumanInterface.safeParse(draft?.interface).data;
  const outcomes: string[] = Array.isArray(draft?.outcomes) ? draft.outcomes.map(string).filter(Boolean) : [];
  const tags: string[] = Array.isArray(draft?.tags) ? draft.tags.map(string) : [];
  const descriptiveTags: string[] = tags.filter((tag) => !isNodeKindTag(tag));
  const definitionPath: string = creation ? creation.path(file.content) : path;
  const reference: string = string(draft?.[kind === "agent" ? "prompt" : "script"]);
  const validSidecar: string = (kind === "agent" && /^[\w.-]+\.md$/.test(reference)) || (kind === "command" && /^[\w.-]+\.sh$/.test(reference)) ? reference : "";
  useEffect(() => { if (!sidecarDirty) setSidecarName(validSidecar); }, [validSidecar, sidecarDirty]);
  const sidecarPath: string = definitionPath && sidecarName ? definitionPath.slice(0, definitionPath.lastIndexOf("/") + 1) + sidecarName : "";
  const needsContext: boolean = newTemplate && kind === "agent";
  const saveSidecar: boolean = sidecarDirty || (needsContext && sidecarStatus?.missing === true);
  const saveDefinition: boolean = file.dirty && (!sidecarDirty || sidecarName === validSidecar);
  const save = useAction(async () => {
    if (saveSidecar && !await sidecar.current?.commit()) return;
    if (saveDefinition) await file.commit();
  });
  const editable: boolean = file.editable && !save.busy && !builtin;
  const canSave: boolean = editable && (saveDefinition || sidecarDirty) && (!saveDefinition || file.canCommit) &&
    (!needsContext || (sidecarStatus?.path === sidecarPath && sidecarStatus.ready)) && (!saveSidecar || sidecarStatus?.canCommit === true);
  const update = (key: string, value: unknown): void => file.update(JSON.stringify({
    ...draft, ...(descriptiveTags.length !== tags.length ? { tags: descriptiveTags } : {}), [key]: value,
  }, null, 2) + "\n");
  const inlineKeys: string[] = [
    "description", "tags", "timeoutSec",
    "outcomes", "outputs", "changesFiles",
    ...(remote ? ["account", "script", "inputs", "optionalInputs", "outputRules"] : []),
    ...(kind === "agent" ? ["prompt", "agentSession", "knowledge"] : []),
    ...(kind === "command" ? ["command", "script", "inputs", "optionalInputs", "outputRules"] : []),
    ...(human ? ["interface"] : []),
  ];
  const updateFields = (fields: Record<string, unknown>): void => file.update(JSON.stringify({
    ...draft, ...(descriptiveTags.length !== tags.length ? { tags: descriptiveTags } : {}), ...fields,
  }, null, 2) + "\n");
  const fieldErrors = (key: string, label?: string): ReactNode => <DefinitionErrors errors={file.errors
    ?.filter(({ path }) => path.split(".")[0] === key)
    .map((error) => label ? { ...error, path: label } : error)} />;
  const help = (label: string, text: ReactNode): ReactNode => <FieldHelp title={label}>{text}</FieldHelp>;
  const field = (key: string, label: string, input: ReactElement<{ label?: string; labelAction?: ReactNode }>, text: string): ReactNode => <div>
    {cloneElement(input, { label, labelAction: help(label, text) })}
    {fieldErrors(key)}
  </div>;
  const textField = (key: string, label: string, text: string): ReactNode => field(key, label,
    <TextField label={label} value={string(draft?.[key])} disabled={sidecarDirty} onValueChange={(value) => update(key, value || undefined)} />, text);
  const check = (key: string, label: string, text: string, checked: boolean, onChange: (checked: boolean) => void): ReactNode => <div>
    <div className={s.fieldHeading}>
      <Checkbox label={label} checked={checked} disabled={!file.editable} onCheckedChange={onChange} />
      {help(label, text)}
    </div>
    {fieldErrors(key, label)}
  </div>;
  const flag = (key: string, label: string, text: string): ReactNode => check(key, label, text, draft?.[key] === true, (checked) => update(key, checked));
  const commandField = (label: string, value: unknown, onChange: (command: string[] | undefined) => void): ReactNode => (
    <CommandInput label={label} labelAction={help(label, "Run an executable directly. Use a script when the command needs pipes or redirection.")}
      value={Array.isArray(value) ? value.map(string) : []} onChange={onChange} />
  );
  const title: string = templateTitle(string(draft?.name) || path.split("/").at(-1)?.replace(/\.json$/, "") || "");
  return <Page title={creation ? "New Node" : title || "Node editor"} actions={<>
    {!creation && !builtin && path.startsWith("templates/nodes/") && <DeleteTemplateButton path={path} sha256={file.sha256} title={title}
      disabled={!editable || file.dirty || sidecarDirty} />}
    {!builtin && <Button variant="primary" loading={save.busy} disabled={!canSave} onClick={() => void save.run()}>Save</Button>}
  </>}>
    {(newTemplate || path.startsWith("templates/")) && <Link to="/templates" state={restorePageScroll}>Back to templates</Link>}
    {file.feedback}
    {remote && approval && !approval.approved && approvedHash !== approval.hash && <Alert tone="warning">
      <div className={ui.row}>
        <span>To approve · This node needs your approval before the Project Manager can run it from chat.</span>
        <Button disabled={file.dirty || !editable} onClick={() => { approve.clear(); setApprovalOpen(true); }}>Approve</Button>
      </div>
    </Alert>}
    {approval && <Dialog open={approvalOpen} onOpenChange={setApprovalOpen} title="Approve script for chat?"
      footer={<>
        <Button disabled={approve.busy} onClick={() => setApprovalOpen(false)}>Cancel</Button>
        <Button variant="primary" loading={approve.busy} disabled={file.dirty || !editable} onClick={() => void approve.run()}>Approve script</Button>
      </>}>
      <p>The Project Manager can run this script with the node’s account. Review the code before approving it.</p>
      <Sidecar content={string(draft?.script)} disabled change={() => undefined} isMarkdown={false} />
      {Object.entries(approval.checks).map(([name, body]) => <div key={name}><strong>Saved check</strong><pre>{body}</pre></div>)}
      {Array.isArray(draft?.probe) && <div><strong>Repeat check</strong><pre>{JSON.stringify(draft.probe)}</pre></div>}
      {Array.isArray(draft?.mergedCheck) && <div><strong>Merge check</strong><pre>{JSON.stringify(draft.mergedCheck)}</pre></div>}
      <ErrorText error={approve.error} />
    </Dialog>}
    {file.ready && <Card padded>
      {draft ? (
        <fieldset className={s.fields} disabled={!editable}>
          {creation ? <>
            <TextField label="Name" required value={string(draft.name)} disabled={sidecarDirty}
              labelAction={help("Name", "Recipes use this name to refer to the node template.")}
              description="Lowercase letters, digits and hyphens. Start with a letter." onValueChange={(name) => update("name", name)} />
            <Select label="Kind" labelAction={help("Kind", "Agent gives a task to an AI model. Command runs a program or script. Human pauses the job for a person to respond. Repository works with branches, pull requests or CI.")}
              options={nodeKinds} value={kind || null} disabled={sidecarDirty} onValueChange={(value) => {
              const next: Node["kind"] | undefined = nodeKinds.find((option) => option.value === value)?.value;
              if (!next) return;
              const { name, description, icon, params } = draft;
              file.update(JSON.stringify({
                name, description, icon, tags: descriptiveTags, params, kind: next, ...initialNodeFields[next],
                ...(next === "agent" ? { prompt: newContextFile } : {}),
              }, null, 2) + "\n");
            }} />
          </> : <TextField label="Kind" readOnly description="Chosen when the node was created."
            value={nodeKinds.find((option) => option.value === kind)?.label ?? kind} />}
          {human && <>
            <Select label="Interface" options={interfaceOptions} value={iface ?? null}
              description={iface ? humanInterfaces[iface].description : undefined}
              labelAction={help("Interface", "Choose what the person uses to respond. Decision asks a question in Notifications. Code review shows the job's code changes. Report review shows what the nodes it reads produced.")}
              onValueChange={(value) => {
                const next = HumanInterface.safeParse(value);
                if (next.success) updateFields(humanFields[next.data]);
              }} />
            {fieldErrors("interface")}
          </>}
          <div>
            <TextArea label="Description" value={string(draft.description)} onValueChange={(value) => update("description", value)} />
            {fieldErrors("description")}
          </div>
          {field("tags", "Tags (comma separated)", <TextField label="Tags" value={(file.dirty ? tags : descriptiveTags).join(",")}
            onValueChange={(value) => update("tags", value === "" ? undefined : value.split(","))} />,
          "Add terms people can search for, such as lint or deployment. The kind is already searchable.")}
          <DefinitionIconField icons={icons.data} type="node" name={string(draft.name)} value={string(draft.icon)} disabled={!file.editable}
            onChange={(value) => update("icon", value)} />
          {kind && !human && field("timeoutSec", "Timeout (seconds)", <NumberField label="Timeout" fullWidth min={1} value={typeof draft.timeoutSec === "number" ? draft.timeoutSec : null} onValueChange={(value) => update("timeoutSec", value ?? undefined)} />,
            "Set how long one attempt can run before PeCore stops it.")}
          {(kind === "command" || remote) && <>
            <CommandInputs inputs={draft.inputs} optional={draft.optionalInputs} disabled={!file.editable}
              onChange={(inputs, optionalInputs) => updateFields({ inputs: inputs.length ? inputs : undefined, optionalInputs: optionalInputs.length ? optionalInputs : undefined })} />
            <p className={ui.muted}>The recipe chooses where each input comes from. The script receives a JSON object on stdin with one key per input type, for example <code>jq '.spec'</code>.</p>
            {fieldErrors("inputs")}{fieldErrors("optionalInputs")}
          </>}
          {kind && <>
            {field("outcomes", iface === "decision" ? "Choices (comma separated)" : "Outcomes (comma separated)", <TextField label="Outcomes" value={Array.isArray(draft.outcomes) ? draft.outcomes.join(",") : ""} onValueChange={(value) => update("outcomes", value ? value.split(",").map((outcome) => outcome.trim()) : [])} />,
              iface === "decision" ? "Each choice is a button in Notifications and an outcome you can connect in the recipe. For example, yes can continue to the next node and no can go to End."
                : human ? "Reviews use approved, changes_requested and rejected. Connect each result to the next node or End."
                  : "Use success and failure for ordinary results. Add a named outcome for a separate path. The command or agent must return one of these names.")}
            <div>
              <div className={s.fieldHeading}><span>{human ? "Notes" : "Outputs"}</span>{help(human ? "Notes" : "Outputs", human
                ? "Choose which answers include feedback. Code review can send comments on individual lines with the feedback."
                : <>A job is a chain of nodes. Each node does its work and ends with one of its outcomes, for example success or rejected. With each outcome it can hand a result to the nodes that come later, which use it to do their own work.<br /><br />For each outcome, choose what this node hands on, or Nothing. For example, the Spec Writer hands on a Spec when it accepts a request, so the Builder knows what to build, and Feedback with the reason when it rejects it, so you know why.<br /><br />The later nodes receive it only if, in the recipe, they read this node (Reads from).{typesHelp}</>)}</div>
              <OutcomeOutputs kind={kind} humanInterface={iface} outcomes={outcomes} outputs={object(draft.outputs)} rules={object(draft.outputRules)} disabled={!file.editable}
                onChange={(outputs, outputRules) => updateFields({
                  outputs: Object.keys(outputs).length ? outputs : undefined,
                  ...(kind === "command" || remote ? { outputRules: Object.keys(outputRules).length ? outputRules : undefined } : {}),
                })} />
              {fieldErrors("outputs")}{fieldErrors("outputRules")}
            </div>
            {!human && !remote && flag("changesFiles", "Can edit files", "Allow this node to edit the job's files. PeCore records those edits as a diff for the nodes that read it. If this is off, edits fail the step.")}
          </>}
          {kind === "agent" && <>
            <AgentSessionField value={AgentSession.safeParse(draft.agentSession).data ?? "job"} disabled={!editable}
              onChange={(value) => update("agentSession", value)} />
            {fieldErrors("agentSession")}
            <Select label="Tracker" value={trackerAccess} options={[
              { value: "none", label: "None" }, { value: "read", label: "Read" }, { value: "read-write", label: "Read and write" },
            ]} onValueChange={(access) => update("tracker", access === "none" || !access ? undefined : { access, account: tracker.account ?? "project.account" })} />
            {trackerAccess !== "none" && <Select label="Tracker account" value={selectedAccount || null} options={options}
              onValueChange={(account) => update("tracker", { access: trackerAccess, account: account ?? "" })} />}
          </>}
          {kind === "command" && <>
            {!draft.script && <>{commandField("Command", draft.command, (command) => update("command", command))}{fieldErrors("command")}</>}
            {!draft.command && textField("script", "Script name", "Enter the name of the saved .sh script. Choose either a command or a script.")}
          </>}
          {builtin && <p className={ui.muted}>Uses the Git hosting account selected in Project Settings.</p>}
          {remote && <>
            {check("readOnly", "Reads only", "Run this node from chat without asking for confirmation. Protected mode still requires script approval.",
              draft.readOnly === true, (checked) => update("readOnly", checked ? true : undefined))}
            <Select label="Account" value={string(draft.account) || null} options={options} onValueChange={(value) => update("account", value ?? undefined)} />
            {fieldErrors("account", "Account")}
            <div role="group" aria-label="Repository script">
              <div className={s.fieldHeading}><span>Script</span></div>
              <Sidecar content={string(draft.script)} disabled={!editable} change={(value) => update("script", value)} isMarkdown={false} />
              {fieldErrors("script", "Script")}
            </div>
          </>}
        </fieldset>
      ) : <ErrorText error="Unable to read the node definition." />}
      <DefinitionErrors errors={draft ? file.errors?.filter(({ path }) => !inlineKeys.includes(path.split(".")[0] ?? "")) : file.errors} />
      {sidecarDirty && sidecarName !== validSidecar && <Alert tone="warning">Save the open file before switching.</Alert>}
      {sidecarPath && <SidecarFile key={sidecarPath} ref={sidecar} path={sidecarPath} name={sidecarName} isMarkdown={sidecarName.endsWith(".md")}
        disabled={!editable} onStatus={setSidecarStatus} />}
    </Card>}
    {warn}
  </Page>;
}

export function NodeEditor({ newTemplate = false }: { newTemplate?: boolean }) {
  const path: string = useParams()["*"] ?? "";
  return <NodeFile key={newTemplate ? "new-template" : path} path={path} newTemplate={newTemplate} />;
}
