import type { ReactNode } from "react";
import type { ChatConfirmationRow } from "@pecore/schemas";
import { Button } from "../ds/button";
import { ErrorText } from "./ui";
import s from "./ChatConfirmation.module.css";

export function ChatConfirmation({ title, rows, status, pending, disabled, busy, error, onDecision, children }: {
  title: string;
  rows: ChatConfirmationRow[];
  status: string;
  pending: boolean;
  disabled: boolean;
  busy: boolean;
  error: string | null;
  onDecision(decision: "approve" | "cancel"): void;
  children?: ReactNode;
}) {
  return (
    <section className={s.card} aria-label={title}>
      <strong>{title}</strong>
      <table className={s.table} aria-label={`${title} details`}>
        <tbody>
          {rows.map(({ label, value }) => <tr key={label}><th scope="row">{label}</th><td>{value}</td></tr>)}
        </tbody>
      </table>
      {status && <span className={s.status} role="status">{status}</span>}
      <ErrorText error={error} />
      {children}
      {pending && <div className={s.actions}>
        <Button variant="primary" disabled={disabled || busy} onClick={() => onDecision("approve")}>Confirm</Button>
        <Button variant="danger" disabled={disabled || busy} onClick={() => onDecision("cancel")}>Reject</Button>
      </div>}
    </section>
  );
}
