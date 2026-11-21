import type { ExportFinding, ExportProjectResult, ImportProjectPreview } from "@pecore/schemas";
import { useState } from "react";
import { call } from "../api/client";
import { useAction } from "../api/hooks";
import { useConnected } from "../api/live";
import { ExportFindings, ImportSelectionFields, ProjectSecurityReview, useImportSelection } from "../components/ProjectShare";
import { ErrorText, ui } from "../components/ui";
import { Button } from "../ds/button";
import { Checkbox } from "../ds/choice";
import { Dialog } from "../ds/overlay";

type ReviewedSource = { path: string; preview: ImportProjectPreview };

export function ProjectImportDialog({ onClose, onImported }: { onClose(): void; onImported(id: string): void }) {
  const connected: boolean = useConnected();
  const [source, setSource] = useState<ReviewedSource | null>(null);
  const fields = useImportSelection(source?.preview ?? null);
  const complete = useAction(async () => {
    if (!source || !fields.valid) return;
    const { id } = await call("completeProjectImport", { body: { path: source.path, digest: source.preview.digest, ...fields.value } });
    onImported(id);
  });
  const review = useAction(async (choice: "archive" | "folder" | "again") => {
    const path: string | null = choice === "again" ? source?.path ?? null : await window.pecore.pickProjectExport(choice);
    if (path === null) return;
    setSource(null);
    fields.setSelection({ accounts: {} });
    complete.clear();
    const preview: ImportProjectPreview = await call("previewProjectImport", { body: { path } });
    setSource({ path, preview });
  });
  const busy: boolean = review.busy || complete.busy;
  const disabled: boolean = !connected || busy;
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }} title="Import project" width={600}
      description="Choose a PeCore export file or the folder where you extracted it."
      footer={<>
        <Button disabled={busy} onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={disabled || !fields.valid} loading={complete.busy} onClick={() => void complete.run()}>Import</Button>
      </>}>
      <div className={ui.row}>
        <Button disabled={disabled} onClick={() => void review.run("archive")}>Choose archive…</Button>
        <Button disabled={disabled} onClick={() => void review.run("folder")}>Choose folder…</Button>
        {source && <Button disabled={disabled} onClick={() => void review.run("again")}>Review again</Button>}
      </div>
      {review.busy && <span role="status">Reviewing shared project…</span>}
      <ErrorText error={review.error ?? complete.error} />
      {source && <>
        <strong>Project {source.preview.review.projectId}</strong>
        <bdi style={{ overflowWrap: "anywhere" }}>{source.path}</bdi>
        <ProjectSecurityReview review={source.preview.review} />
        <ImportSelectionFields preview={source.preview} fields={fields} disabled={disabled} />
      </>}
    </Dialog>
  );
}

export function ProjectExportDialog({ id, onClose }: { id: string; onClose(): void }) {
  const connected: boolean = useConnected();
  const [history, setHistory] = useState<boolean>(false);
  const [path, setPath] = useState<string | null>(null);
  const [result, setResult] = useState<ExportProjectResult | null>(null);
  const findings: ExportFinding[] = result?.state === "findings" ? result.findings : [];
  const run = useAction(async (decision: "choose" | "approve") => {
    const destination: string | null = decision === "choose" ? await window.pecore.saveProjectExport(id) : path;
    if (destination === null) return;
    setPath(destination);
    setResult(await call("exportProject", { params: { id }, body: {
      path: destination,
      history,
      acceptFindings: decision === "approve" ? findings.map(({ fingerprint }) => fingerprint) : [],
    } }));
  });
  const written: boolean = result?.state === "written";
  const disabled: boolean = !connected || run.busy;
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !run.busy) onClose(); }} title="Export project" width={520}
      footer={written ? <Button variant="primary" onClick={onClose}>Done</Button> : <>
        <Button disabled={run.busy} onClick={onClose}>Cancel</Button>
        {findings.length > 0 && run.error && <Button disabled={disabled} onClick={() => void run.run("choose")}>Choose another location</Button>}
        <Button variant="primary" disabled={disabled} loading={run.busy} onClick={() => void run.run(findings.length > 0 ? "approve" : "choose")}>
          {findings.length > 0 ? "Export anyway" : "Export…"}
        </Button>
      </>}>
      {result?.state === "written" ? <span role="status">Saved to <bdi>{result.path}</bdi></span> : <>
        <Checkbox label="Include job history" checked={history} onCheckedChange={setHistory} disabled={disabled || findings.length > 0} />
        {findings.length > 0 && <ExportFindings findings={findings} />}
        <ErrorText error={run.error} />
      </>}
    </Dialog>
  );
}
