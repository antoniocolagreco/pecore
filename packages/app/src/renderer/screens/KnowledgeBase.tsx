import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { KnowledgeFileName } from "@pecore/schemas";
import type { DefinitionEntry } from "@pecore/schemas";
import { call } from "../api/client";
import { useAction, useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { Button, ErrorText, ui } from "../components/ui";
import { Card, Spinner } from "../ds/feedback";
import { TextField } from "../ds/field";
import { Dialog } from "../ds/overlay";
import { DefinitionErrors, object, Sidecar, useDefinitionDraft } from "./NodeEditor";
import type { NewDefinition } from "./NodeEditor";
import s from "./KnowledgeBase.module.css";

type Selection = { name: string; creating: boolean };

function fileName(input: string): string {
  const name: string = input.trim();
  return name && !name.endsWith(".md") ? `${name}.md` : name;
}

function links(entry: DefinitionEntry): string[] {
  const value: unknown = object(entry.value).links;
  return Array.isArray(value) ? value.filter((link): link is string => typeof link === "string") : [];
}

function KnowledgeFile({ path, name, creating, names, actions, onCreated, onDirty }: {
  path: string; name: string; creating: boolean; names: string; actions: ReactNode; onCreated(): void; onDirty(dirty: boolean): void;
}) {
  const creation: NewDefinition | undefined = useMemo(
    () => creating ? { content: `# ${name.slice(0, -3)}\n`, path: () => path } : undefined,
    [creating, name, path],
  );
  const file = useDefinitionDraft(path, false, creation, names);
  useEffect(() => { onDirty(file.dirty); return () => onDirty(false); }, [file.dirty, onDirty]);
  useEffect(() => { if (file.savedPath) onCreated(); }, [file.savedPath, onCreated]);
  return <div className={s.editor}>
    <header className={s.editorHeader}><h2>{name}</h2>{actions}</header>
    {file.feedback}
    {file.ready && <Sidecar content={file.content} change={file.update} disabled={!file.editable} isMarkdown errors={file.errors} warnings={file.warnings} />}
    <DefinitionErrors errors={file.errors} />
    {!!file.warnings?.length && <ul className={s.warnings} aria-label="Formatting warnings">
      {file.warnings.map((warning, index) => <li key={index}>{warning.message}</li>)}
    </ul>}
    <div>{file.saveButton()}</div>
  </div>;
}

export function KnowledgeBase({ id }: { id: string }) {
  const connected: boolean = useConnected();
  const dir: string = `projects/${id}/knowledge`;
  const entries = useData(() => call("listDefinitions", { query: { dir } }), [dir],
    (m) => m.type === "definition.changed" && m.path.startsWith(dir + "/"));
  const files = (entries.data ?? []).filter(({ path }) => path.endsWith(".md")).map((entry) => ({ name: entry.path.slice(dir.length + 1), links: links(entry) }));
  const names: string[] = files.map(({ name }) => name);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [dirty, setDirty] = useState<boolean>(false);
  const [dialog, setDialog] = useState<"new" | "rename" | "delete" | null>(null);
  const [draftName, setDraftName] = useState<string>("");
  const input = useRef<HTMLInputElement>(null);
  const candidate: string = fileName(draftName);
  const nameError: string | undefined = !candidate ? undefined
    : !KnowledgeFileName.safeParse(candidate).success ? "Use letters, digits, dots, hyphens and underscores."
      : names.includes(candidate) && candidate !== selected?.name ? "A file with this name already exists." : undefined;
  const linking: string[] = selected ? files.filter(({ name, links }) => name !== selected.name && links.includes(selected.name)).map(({ name }) => name) : [];

  const choose = (next: Selection | null): void => {
    if (dirty && !window.confirm("Discard your unsaved changes?")) return;
    setDirty(false);
    setSelected(next);
  };
  const created = useMemo(() => () => setSelected((current) => current && { ...current, creating: false }), []);
  const rename = useAction(async () => {
    if (!selected) return;
    await call("renameKnowledge", { params: { id }, body: { from: selected.name, to: candidate } });
    setSelected({ name: candidate, creating: false });
    setDialog(null);
    entries.reload();
  });
  const remove = useAction(async () => {
    if (!selected) return;
    await call("deleteKnowledge", { params: { id, name: selected.name } });
    setSelected(null);
    setDialog(null);
    entries.reload();
  });
  const upload = useAction(async (chosen: File[]) => {
    const invalid: string[] = chosen.filter(({ name }) => !KnowledgeFileName.safeParse(name).success).map(({ name }) => name);
    if (invalid.length) throw new Error(`Rename before uploading: ${invalid.join(", ")}. Names use letters, digits, dots, hyphens and underscores and end in .md.`);
    await call("uploadKnowledge", { params: { id }, body: { files: await Promise.all(chosen.map(async (file) => ({ name: file.name, content: await file.text() }))) } });
    entries.reload();
  });
  const open = (kind: "new" | "rename" | "delete"): void => {
    setDraftName(kind === "rename" && selected ? selected.name : "");
    rename.clear();
    remove.clear();
    setDialog(kind);
  };

  return <div className={s.layout}>
    <Card className={s.list} padded={false}>
      <div className={s.listActions}>
        <Button disabled={!connected} onClick={() => open("new")}>New file</Button>
        <Button disabled={!connected || upload.busy} onClick={() => input.current?.click()}>{upload.busy ? "Uploading…" : "Upload"}</Button>
        <input ref={input} type="file" accept=".md,text/markdown" multiple hidden onChange={(event) => {
          const chosen: File[] = [...(event.target.files ?? [])];
          event.target.value = "";
          if (chosen.length) void upload.run(chosen);
        }} />
      </div>
      <ErrorText error={entries.error ?? upload.error} />
      {entries.loading && !entries.data && <Spinner />}
      {entries.data && !files.length && !selected?.creating && <p className={ui.muted}>No knowledge files yet.</p>}
      <ul className={s.files} aria-label="Knowledge files">
        {files.map(({ name }) => <li key={name}>
          <button type="button" className={s.file} aria-pressed={selected?.name === name} disabled={!connected} onClick={() => choose({ name, creating: false })}>{name}</button>
        </li>)}
        {selected?.creating && <li><button type="button" className={s.file} aria-pressed>{selected.name}</button></li>}
      </ul>
    </Card>
    <Card className={s.content} padded>
      {selected
        ? <KnowledgeFile key={`${selected.name}:${selected.creating}`} path={`${dir}/${selected.name}`} name={selected.name} creating={selected.creating}
          names={names.join("\n")} onCreated={created} onDirty={setDirty}
          actions={!selected.creating && <>
            <Button disabled={!connected} onClick={() => open("rename")}>Rename</Button>
            <Button disabled={!connected} onClick={() => open("delete")}>Delete</Button>
          </>} />
        : <p className={ui.muted}>Select a file, create one or upload Markdown files. A node gives its agent the files assigned to it and the files they link to. Link another file by its name, for example [naming](naming.md).</p>}
    </Card>
    <Dialog open={dialog === "new" || dialog === "rename"} onOpenChange={(value) => { if (!value) setDialog(null); }}
      title={dialog === "rename" ? `Rename ${selected?.name ?? ""}` : "New knowledge file"}
      description={dialog === "rename" ? "Links to it in the other files are updated." : undefined}
      footer={<>
        <Button onClick={() => setDialog(null)}>Cancel</Button>
        <Button kind="primary" disabled={!connected || !candidate || !!nameError || rename.busy || (dialog === "rename" && candidate === selected?.name)}
          onClick={() => {
            if (dialog === "rename") void rename.run();
            else { choose({ name: candidate, creating: true }); setDialog(null); }
          }}>{dialog === "rename" ? "Rename" : "Create"}</Button>
      </>}>
      <TextField label="File name" mono placeholder="architecture.md" value={draftName} onValueChange={setDraftName} error={nameError} />
      <ErrorText error={rename.error} />
    </Dialog>
    <Dialog open={dialog === "delete"} onOpenChange={(value) => { if (!value) setDialog(null); }} title={`Delete ${selected?.name ?? ""}?`}
      footer={<>
        <Button onClick={() => setDialog(null)}>Cancel</Button>
        <Button kind="danger" disabled={!connected || remove.busy} onClick={() => void remove.run()}>Delete</Button>
      </>}>
      {linking.length > 0 && <p>These files link to it, and their links will break: {linking.join(", ")}.</p>}
      <ErrorText error={remove.error} />
    </Dialog>
  </div>;
}
