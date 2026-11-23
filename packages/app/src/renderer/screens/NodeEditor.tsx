import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useBlocker, useNavigate, useParams } from "react-router";
import { ApiError, ArtifactType, Name, normalizeLegacyHumanNode } from "@pecore/schemas";
import type { DefinitionFile, Node, RouteResult } from "@pecore/schemas";
import { basicSetup, EditorView } from "codemirror";
import { Compartment, EditorState } from "@codemirror/state";
import { lineNumbers } from "@codemirror/view";
import { highlight } from "../components/CodeSnapshot";
import { templateTitle } from "../components/templateTitle";
import { markdown } from "@codemirror/lang-markdown";
import { StreamLanguage } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { call } from "../api/client";
import { errorText, useAction, useData } from "../api/hooks";
import { useConnected, useLive } from "../api/live";
import { DefinitionIconField, useDefinitionIcons } from "../components/DefinitionIcon";
import { restorePageScroll } from "../components/usePageScroll";
import { Button, ErrorText, Field, Modal, Page, Panel, ui } from "../components/ui";
import { TextArea, TextField } from "../ds/field";
import { Select } from "../ds/select";
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

export function useDefinitionDraft(existingPath: string, sidecar = false, creation?: NewDefinition) {
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
  }, [path, content, connected, !!baseline, sidecar]);

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
  const canSave: boolean = connected && !!path && !save.busy && !compare.busy && !reload.busy && (sidecar || errors?.length === 0);

  return {
    content, dirty, ready: !!baseline && (!!creation || sidecar || baseline.sha256 !== null || dirty), errors, connected, savedPath,
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

function Sidecar({ content, disabled, change, isMarkdown }: { content: string; disabled: boolean; change(value: string): void; isMarkdown: boolean }) {
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
        basicSetup, editorTheme, highlight, paddedLineNumbers, isMarkdown ? markdown() : StreamLanguage.define(shell),
        config.of([EditorState.readOnly.of(binding.current.disabled), EditorView.editable.of(!binding.current.disabled)]),
        EditorView.updateListener.of((event) => {
          if (event.docChanged && !syncing.current && !binding.current.disabled) binding.current.change(event.state.doc.toString());
        }),
      ],
    });
    view.current = editor;
    return () => { view.current = null; editor.destroy(); };
  }, [isMarkdown]);
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
  return <div ref={parent} />;
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
  { value: "agent", label: "Agent" },
  { value: "command", label: "Command" },
  { value: "human-decision", label: "Human Decision" },
  { value: "human-review", label: "Human Review" },
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
  "human-decision": { outcomes: ["yes", "no"] },
  "human-review": { show: ["diff"], answer: true, outcomes: ["approve", "changes", "reject"] },
  source: { list: {}, read: {}, comment: {}, replies: {} },
};
const sourceCommands: { key: string; label: string }[] = [
  { key: "list", label: "List command" },
  { key: "read", label: "Read command" },
  { key: "comment", label: "Comment command" },
  { key: "replies", label: "Replies command" },
];
const newNodeTemplate: NewDefinition = {
  content: JSON.stringify({ $schema: "../../schemas/node.json", name: "", description: "" }, null, 2) + "\n",
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
  const [json, setJson] = useState(false);
  const [sidecarDirty, setSidecarDirty] = useState(false);
  const [sidecarName, setSidecarName] = useState("");
  const warn = useUnsaved(file.dirty || sidecarDirty);
  useEffect(() => {
    if (file.savedPath) void navigate(definitionUrl("node", file.savedPath), { replace: true });
  }, [file.savedPath, navigate]);
  const parsed = parseDraft(file.content);
  const draft = parsed && normalizeLegacyHumanNode(parsed);
  const kind: string = string(draft?.kind);
  const human: boolean = kind === "human-decision" || kind === "human-review";
  const definitionPath: string = creation ? creation.path(file.content) : path;
  const reference: string = string(draft?.[kind === "agent" ? "prompt" : "script"]);
  const validSidecar: string = (kind === "agent" && /^[\w.-]+\.md$/.test(reference)) || (kind === "command" && /^[\w.-]+\.sh$/.test(reference)) ? reference : "";
  useEffect(() => { if (!sidecarDirty) setSidecarName(validSidecar); }, [validSidecar, sidecarDirty]);
  const update = (key: string, value: unknown): void => file.update(JSON.stringify({ ...draft, [key]: value }, null, 2) + "\n");
  const inlineKeys: string[] = [
    "description", "tags", "timeoutSec",
    ...(kind === "source" ? ["credentials"] : ["outcomes", "changesFiles"]),
    ...(kind === "agent" ? ["prompt", "resume"] : []),
    ...(kind === "command" ? ["script", "runsAs", "cleanCheckout"] : []),
    ...(human ? ["show", "answer"] : []),
  ];
  const fieldErrors = (key: string): ReactNode => <DefinitionErrors errors={file.errors?.filter(({ path }) => path.split(".")[0] === key)} />;
  const field = (key: string, label: string, input: ReactNode): ReactNode => <div><Field label={label}>{input}</Field>{fieldErrors(key)}</div>;
  const textField = (key: string, label: string): ReactNode => field(key, label, <input value={string(draft?.[key])} onChange={(event) => update(key, event.target.value || undefined)} />);
  const flag = (key: string, label: string): ReactNode => <div><label><input type="checkbox" checked={draft?.[key] === true} onChange={(event) => update(key, event.target.checked)} /> {label}</label>{fieldErrors(key)}</div>;
  const commandField = (label: string, value: unknown, onChange: (command: string[] | undefined) => void): ReactNode => (
    <TextArea label={label} description="Enter the executable and each argument on its own line." value={Array.isArray(value) ? value.join("\n") : ""}
      onValueChange={(text) => onChange(text ? text.split("\n") : undefined)} />
  );
  return <Page title={creation ? "New Node" : templateTitle(string(draft?.name)) || "Node editor"} actions={file.saveButton(newTemplate && sidecarDirty)}>
    {(newTemplate || path.startsWith("templates/")) && <Link to="/templates" state={restorePageScroll}>Back to templates</Link>}
    {file.feedback}
    {file.ready && <Panel>
      <div className={ui.row}>
        <Button disabled={!file.connected || !draft} aria-pressed={!json && !!draft} onClick={() => setJson(false)}>Form</Button>
        <Button disabled={!file.connected} aria-pressed={json || !draft} onClick={() => setJson(true)}>JSON</Button>
      </div>
      <fieldset className={s.fields} disabled={!file.editable}>
        {json || !draft ? <Field label="Definition JSON"><textarea className={s.json} value={file.content} onChange={(event) => { setJson(true); file.update(event.target.value); }} /></Field> : <>
          {creation ? <>
            <TextField label="Name" required value={string(draft.name)} disabled={sidecarDirty}
              description="Lowercase letters, digits and hyphens. Start with a letter." onValueChange={(name) => update("name", name)} />
            <Select label="Kind" options={nodeKinds} value={kind || null} disabled={sidecarDirty} onValueChange={(value) => {
              const next: Node["kind"] | undefined = nodeKinds.find((option) => option.value === value)?.value;
              if (!next) return;
              const { $schema, name, description, icon, tags, params } = draft;
              const baseTag: string = next === "human-decision" || next === "human-review" ? "human" : next;
              const oldTag: string = human ? "human" : kind;
              const nextTags: string[] = Array.isArray(tags) ? tags.map(string).filter((tag) => tag && tag !== oldTag && tag !== baseTag) : [];
              file.update(JSON.stringify({ $schema, name, description, icon, tags: [...nextTags, baseTag], params, kind: next, ...initialNodeFields[next] }, null, 2) + "\n");
            }} />
          </> : <p>Kind: {nodeKinds.find((option) => option.value === kind)?.label ?? kind}</p>}
          {field("description", "Description", <textarea value={string(draft.description)} onChange={(event) => update("description", event.target.value)} />)}
          {field("tags", "Tags (comma separated)", <input value={Array.isArray(draft.tags) ? draft.tags.join(",") : ""} onChange={(event) => {
            update("tags", event.target.value === "" ? undefined : event.target.value.split(","));
          }} />)}
          <DefinitionIconField icons={icons.data} type="node" name={string(draft.name)} value={string(draft.icon)} disabled={!file.editable}
            onChange={(value) => update("icon", value)} />
          {kind && !human && field("timeoutSec", "Timeout (seconds)", <input type="number" min={1} value={typeof draft.timeoutSec === "number" ? draft.timeoutSec : ""} onChange={(event) => update("timeoutSec", event.target.value ? Number(event.target.value) : undefined)} />)}
          {kind === "human-review" && <div>
            <p>Artifacts to review</p>
            {ArtifactType.options.map((type) => {
              const show: unknown[] = Array.isArray(draft.show) ? draft.show : [];
              return <label key={type}><input type="checkbox" checked={show.includes(type)} onChange={(event) =>
                update("show", event.target.checked ? [...show, type] : show.filter((entry) => entry !== type))} /> {type}</label>;
            })}
            {fieldErrors("show")}
          </div>}
          {kind && kind !== "source" && <>
            {field("outcomes", kind === "human-decision" ? "Choices (comma separated)" : "Outcomes (comma separated)", <input value={Array.isArray(draft.outcomes) ? draft.outcomes.join(",") : ""} onChange={(event) => update("outcomes", event.target.value ? event.target.value.split(",") : [])} />)}
            {!human && flag("changesFiles", "Changes files")}
          </>}
          {kind === "agent" && <>{textField("prompt", "Prompt file")}{flag("resume", "Resume session")}</>}
          {kind === "command" && <>
            {creation && !draft.script && commandField("Command", draft.command, (command) => update("command", command))}
            {(!creation || !draft.command) && textField("script", "Script file")}
            {field("runsAs", "Runs as", <select value={string(draft.runsAs) || "project-user"} onChange={(event) => update("runsAs", event.target.value)}><option>project-user</option><option>engine</option></select>)}
            {flag("cleanCheckout", "Clean checkout")}
          </>}
          {human && flag("answer", "Allow an optional note")}
          {creation && kind === "source" && sourceCommands.map(({ key, label }) => {
            const action = object(draft[key]);
            return !action.script && <div key={key}>{commandField(label, action.command, (command) => update(key, { ...action, command }))}</div>;
          })}
          {kind === "source" && field("credentials", "Credentials (comma separated)", <input value={Array.isArray(draft.credentials) ? draft.credentials.join(",") : ""} onChange={(event) => update("credentials", event.target.value ? event.target.value.split(",") : [])} />)}
        </>}
      </fieldset>
      <DefinitionErrors errors={json || !draft ? file.errors : file.errors?.filter(({ path }) => !inlineKeys.includes(path.split(".")[0] ?? ""))} />
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
