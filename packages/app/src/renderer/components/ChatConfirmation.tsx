import { Fragment } from "react";
import type { ReactNode } from "react";
import type { ChatConfirmationRow } from "@pecore/schemas";
import { Button } from "../ds/button";
import { Details } from "../ds/data";
import { ErrorText } from "./ui";
import s from "./ChatConfirmation.module.css";

export function ChatConfirmation({ title, rows, status, pending, disabled, busy, error, destructive, confirmLabel = "Confirm", confirmDisabled, onDecision, children }: {
  title: string;
  rows: ChatConfirmationRow[];
  status: string;
  pending: boolean;
  disabled: boolean;
  busy: boolean;
  error: string | null;
  destructive?: boolean;
  confirmLabel?: string;
  confirmDisabled?: boolean;
  onDecision(decision: "approve" | "cancel"): void;
  children?: ReactNode;
}) {
  return (
    <section className={s.card} aria-label={title}>
      <strong>{title}</strong>
      <Details label={`${title} details`}>
        {rows.map(({ label, value }) => <Fragment key={label}><dt>{label}</dt><dd>{value}</dd></Fragment>)}
      </Details>
      {status && <span className={s.status} role="status">{status}</span>}
      <ErrorText error={error} />
      {children}
      {pending && <div className={s.actions}>
        <Button variant={destructive ? "dangerSolid" : "primary"} disabled={disabled || busy || confirmDisabled} onClick={() => onDecision("approve")}>{confirmLabel}</Button>
        <Button variant={destructive ? "secondary" : "danger"} disabled={disabled || busy} onClick={() => onDecision("cancel")}>Reject</Button>
      </div>}
    </section>
  );
}
