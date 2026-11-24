import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import { KnowledgeFileName } from "@pecore/schemas";
import type { DefinitionEntry } from "@pecore/schemas";
import { call } from "../api/client";
import { useAction, useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { PageActions } from "../components/PageActions";
import { ErrorText, ui } from "../components/ui";
import { Button } from "../ds/button";
import { List, ListItem } from "../ds/data";
import { Card, Spinner } from "../ds/feedback";
import { TextField } from "../ds/field";
import { Dialog } from "../ds/overlay";
import { DefinitionErrors, object, Sidecar, useDefinitionDraft } from "./NodeEditor";
import type { NewDefinition } from "./NodeEditor";
import editorStyles from "./Editors.module.css";
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

function KnowledgeFile({ path, name, creating, names, onCreated, onDirty }: {
  path: string; name: string; creating: boolean; names: string; onCreated(): void; onDirty(dirty: boolean): void;
}) {
  const creation: NewDefinition | undefined = useMemo(
    () => creating ? { content: `# ${name.slice(0, -3)}\n`, path: () => path } : undefined,
    [creating, name, path],
  );
  const file = useDefinitionDraft(path, false, creation, names, false);
  useEffect(() => { onDirty(file.dirty); return () => onDirty(false); }, [file.dirty, onDirty]);
  useEffect(() => { if (file.savedPath) onCreated(); }, [file.savedPath, onCreated]);
  return <div className={s.editor}>
    <header className={s.editorHeader}>
      <h2>{name}</h2>
    </header>
    <PageActions>{file.saveButton()}</PageActions>
    {file.feedback}
    <div className={s.desk}>
      {file.ready ? <Sidecar paper className={s.sheet} content={file.content} change={file.update} disabled={!file.editable} isMarkdown
        errors={file.errors} warnings={file.warnings} /> : <div className={`${editorStyles.paperSurface} ${s.sheet}`} aria-hidden />}
    </div>
    {(!!file.errors?.length || !!file.warnings?.length) && <div className={s.issues}>
      <DefinitionErrors errors={file.errors} />
      {!!file.warnings?.length && <ul className={s.warnings} aria-label="Formatting warnings">
        {file.warnings.map((warning, index) => <li key={index}>{warning.message}</li>)}
      </ul>}
    </div>}
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
  const [dropping, setDropping] = useState<boolean>(false);
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
    setDirty(false);
    setSelected(null);
    setDialog(null);
    entries.reload();
  });
  const [removedLinks, setRemovedLinks] = useState<{ file: string; link: string }[]>([]);
  const upload = useAction(async (chosen: File[]) => {
    setRemovedLinks([]);
    const invalid: string[] = chosen.filter(({ name }) => !KnowledgeFileName.safeParse(name).success).map(({ name }) => name);
    if (invalid.length) throw new Error(`Rename before uploading: ${invalid.join(", ")}. Names use letters, digits, dots, hyphens and underscores and end in .md.`);
    const result = await call("uploadKnowledge", { params: { id }, body: { files: await Promise.all(chosen.map(async (file) => ({ name: file.name, content: await file.text() }))) } });
    setRemovedLinks(result.removedLinks);
    entries.reload();
  });
  const open = (kind: "new" | "rename" | "delete"): void => {
    setDraftName(kind === "rename" && selected ? selected.name : "");
    rename.clear();
    remove.clear();
    setDialog(kind);
  };

  const canSubmitName: boolean = connected && !!candidate && !nameError && !rename.busy && !(dialog === "rename" && candidate === selected?.name);
  const submitName = (): void => {
    if (dialog === "rename") void rename.run();
    else { choose({ name: candidate, creating: true }); setDialog(null); }
  };

  const carriesFiles =(event: DragEvent): boolean => [...event.dataTransfer.types].includes("Files");

  return <div className={s.layout}
    onDragOverCapture={(event) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = connected ? "copy" : "none";
      setDropping(true);
    }}
    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false); }}
    onDropCapture={(event) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      setDropping(false);
      if (connected) void upload.run([...event.dataTransfer.files]);
    }}>
    {dropping && <div className={s.drop} aria-hidden="true">Drop Markdown files to add them to the knowledge</div>}
    <Card className={s.list} padded={false}>
      <PageActions>
        <Button disabled={!connected} onClick={() => open("new")}>New file</Button>
        <Button disabled={!connected || upload.busy} onClick={() => input.current?.click()}>{upload.busy ? "Uploading…" : "Upload"}</Button>
        {selected && !selected.creating && <>
          <Button disabled={!connected} onClick={() => open("rename")}>Rename</Button>
          <Button variant="danger" disabled={!connected || remove.busy} onClick={() => open("delete")}>Delete file</Button>
        </>}
      </PageActions>
      <input ref={input} type="file" accept=".md,text/markdown" multiple hidden onChange={(event) => {
        const chosen: File[] = [...(event.target.files ?? [])];
        event.target.value = "";
        if (chosen.length) void upload.run(chosen);
      }} />
      <ErrorText error={entries.error ?? upload.error} />
      {entries.loading && !entries.data && <Spinner />}
      {entries.data && !files.length && !selected?.creating && <p className={ui.muted}>No knowledge files yet.</p>}
      <List label="Knowledge files">
        {files.map(({ name }) => <ListItem key={name} mono active={selected?.name === name} disabled={!connected} onClick={() => choose({ name, creating: false })}>{name}</ListItem>)}
        {selected?.creating && <ListItem mono active>{selected.name}</ListItem>}
      </List>
    </Card>
    <Card className={s.content} padded>
      {selected
        ? <KnowledgeFile key={`${selected.name}:${selected.creating}`} path={`${dir}/${selected.name}`} name={selected.name} creating={selected.creating}
          names={names.join("\n")} onCreated={created} onDirty={setDirty} />
        : <div className={s.editor}>
          <div className={s.editorHeader} aria-hidden />
          <div className={s.desk}>
            <div className={`${editorStyles.paperSurface} ${s.sheet} ${s.blank}`}>
              <p>Select a file, create one, or upload or drop Markdown files here.</p>
              <p>A node gives its agent the files assigned to it and the files they link to. Link another file by its name, for example [naming](naming.md).</p>
            </div>
          </div>
        </div>}
    </Card>
    <Dialog open={dialog === "new" || dialog === "rename"} onOpenChange={(value) => { if (!value) setDialog(null); }}
      title={dialog === "rename" ? `Rename ${selected?.name ?? ""}` : "New knowledge file"}
      description={dialog === "rename" ? "Links to it in the other files are updated." : undefined}
      footer={<>
        <Button onClick={() => setDialog(null)}>Cancel</Button>
        <Button variant="primary" disabled={!canSubmitName} onClick={submitName}>{dialog === "rename" ? "Rename" : "Create"}</Button>
      </>}>
      <form onSubmit={(event) => { event.preventDefault(); if (canSubmitName) submitName(); }}>
        <TextField label="File name" mono autoFocus placeholder="architecture.md" value={draftName} onValueChange={setDraftName} error={nameError} />
      </form>
      <ErrorText error={rename.error} />
    </Dialog>
    <Dialog open={removedLinks.length > 0} onOpenChange={(value) => { if (!value) setRemovedLinks([]); }} title="Links removed"
      description="These files linked to files that are not in this project. The links were removed and their text kept."
      footer={<Button variant="primary" onClick={() => setRemovedLinks([])}>OK</Button>}>
      <ul className={s.removed}>
        {[...new Set(removedLinks.map(({ file }) => file))].map((file) => <li key={file}>
          <strong>{file}</strong>: {removedLinks.filter((link) => link.file === file).map(({ link }) => link).join(", ")}
        </li>)}
      </ul>
    </Dialog>
    <Dialog open={dialog === "delete"} onOpenChange={(value) => { if (!value && !remove.busy) setDialog(null); }} title={`Delete ${selected?.name ?? ""}?`}
      description={dirty ? "This also discards your unsaved changes." : undefined}
      footer={<>
        <Button disabled={remove.busy} onClick={() => setDialog(null)}>Cancel</Button>
        <Button variant="dangerSolid" loading={remove.busy} disabled={!connected} onClick={() => void remove.run()}>Delete file</Button>
      </>}>
      {linking.length > 0 && <p>These files link to it, and their links will break: {linking.join(", ")}.</p>}
      <ErrorText error={remove.error} />
    </Dialog>
  </div>;
}
