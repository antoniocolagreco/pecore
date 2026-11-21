import { ProjectId } from "@pecore/schemas";
import type { ArchiveReview, ExportFinding, ImportProjectPreview, ImportProjectSelection } from "@pecore/schemas";
import { useState } from "react";
import { Alert } from "../ds/feedback";
import { TextField } from "../ds/field";
import { Select } from "../ds/select";
import { ui } from "./ui";

const reviewStates: Record<ArchiveReview["model"], string> = {
  complete: "Model review complete",
  partial: "Model reviewed part of the text",
  unavailable: "Model review unavailable",
  failed: "Model review failed",
};

export function ProjectSecurityReview({ review }: { review: ArchiveReview }) {
  const [showDetails, setShowDetails] = useState<boolean>(false);
  const findings: number = review.files.reduce((count, file) => count + file.findings.length, 0);
  const unreadFiles: number = review.files.filter(({ content }) => content === "binary" || content === "too_large").length;
  const modelReviewed: number = review.files.filter(({ modelReviewed }) => modelReviewed).length;
  return (
    <div className={ui.stack} style={{ overflowWrap: "anywhere" }}>
      <Alert tone="warning" title="Review every script and prompt before importing">
        Scripts can contain malicious code and prompts can contain hidden instructions. This report cannot guarantee the project is safe.
      </Alert>
      <div>{findings} {findings === 1 ? "finding" : "findings"} · {reviewStates[review.model]}</div>
      <div>Static review checked {review.files.length - unreadFiles} files. The model reviewed {modelReviewed}. {unreadFiles > 0 && `${unreadFiles} binary or very large files could not be analyzed.`}</div>
      <details onToggle={(event) => setShowDetails(event.currentTarget.open)}>
        <summary>Files and findings</summary>
        {showDetails && <ul>{review.files.map((file) => (
          <li key={file.path}>
            <bdi>{file.path}</bdi> · {file.content === "binary" ? "Binary, not reviewed" : file.content === "too_large" ? "Too large, not reviewed" : file.modelReviewed ? "Static and model review" : "Static review"}
            {file.findings.length > 0 && <ul>{file.findings.map(({ line, risk, source }) => (
              <li key={`${line}:${risk}:${source}`}>Line {line} · {risk.replaceAll("_", " ")} ({source})</li>
            ))}</ul>}
          </li>
        ))}</ul>}
      </details>
    </div>
  );
}

export function useImportSelection(preview: ImportProjectPreview | null) {
  const [selection, setSelection] = useState<ImportProjectSelection>({ accounts: {} });
  const idRequired: boolean = preview?.suggestedId != null;
  const id: string | undefined = idRequired ? (selection.id ?? preview?.suggestedId ?? "").trim() : undefined;
  const accounts: ImportProjectSelection["accounts"] = Object.fromEntries((preview?.accounts ?? []).flatMap((account) => {
    const chosen: string | undefined = Object.hasOwn(selection.accounts, account.id) ? selection.accounts[account.id] : undefined;
    const value: string | undefined = account.choices.length === 1 ? account.choices[0]?.id : chosen;
    return value ? [[account.id, value]] : [];
  }));
  const valid: boolean = preview !== null
    && (!idRequired || (ProjectId.safeParse(id).success && id !== preview.review.projectId))
    && preview.accounts.every((account) => account.choices.some((choice) => Object.hasOwn(accounts, account.id) && choice.id === accounts[account.id]));
  const value: ImportProjectSelection = { ...(id === undefined ? {} : { id }), accounts };
  return { value, selection, setSelection, valid };
}

export function ImportSelectionFields({ preview, fields, disabled }: { preview: ImportProjectPreview; fields: ReturnType<typeof useImportSelection>; disabled: boolean }) {
  return (
    <div className={ui.stack}>
      {preview.suggestedId !== null && <TextField label="New project ID" mono disabled={disabled} value={fields.selection.id ?? preview.suggestedId}
        description={`Project ${preview.review.projectId} already exists.`}
        error={!ProjectId.safeParse(fields.value.id).success ? "Use up to 24 lower-case letters, digits and dashes. Start with a letter." : fields.value.id === preview.review.projectId ? "Choose a different ID." : undefined}
        onValueChange={(id) => fields.setSelection((previous) => ({ ...previous, id }))} />}
      {preview.accounts.map((account) => (
        <Select key={account.id} label={<>Local forge account for <bdi>{account.id}</bdi></>} disabled={disabled || account.choices.length <= 1}
          value={Object.hasOwn(fields.value.accounts, account.id) ? fields.value.accounts[account.id] : null}
          options={account.choices.map(({ id, label }) => ({ value: id, label }))}
          error={account.choices.length === 0 ? "Add a compatible forge account in Settings, then review the source again." : undefined}
          onValueChange={(value) => fields.setSelection((previous) => ({ ...previous, accounts: { ...previous.accounts, [account.id]: value ?? "" } }))} />
      ))}
    </div>
  );
}

export function ExportFindings({ findings }: { findings: ExportFinding[] }) {
  return (
    <div className={ui.stack} style={{ overflowWrap: "anywhere" }}>
      <Alert tone="warning" title="Possible secrets in job artifacts">Review these findings before sharing the export.</Alert>
      <ul>{findings.map(({ file, line, rule, fingerprint }) => <li key={fingerprint}><bdi>{file}</bdi> · Line {line} · {rule}</li>)}</ul>
    </div>
  );
}
