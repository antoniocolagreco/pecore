import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Button as DsButton } from "../ds/button";
import { EmptyState } from "../ds/feedback";
import { Dialog } from "../ds/overlay";
import s from "./ui.module.css";

export { s as ui };

export function Button({ kind, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: "primary" | "danger" }) {
  return <DsButton variant={kind ?? "secondary"} {...rest}>{children}</DsButton>;
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={[s.panel, className ?? ""].join(" ")}>{children}</section>;
}

export function Page({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className={s.page}>
      <header className={s.pageHeader}>
        <h1 className={s.title}>{title}</h1>
        <div className={s.row}>{actions}</div>
      </header>
      <div className={s.stack}>{children}</div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <EmptyState title={children} />;
}

export function ErrorText({ error }: { error: string | Error | null | undefined }) {
  if (!error) return null;
  return (
    <p className={s.error} role="alert">
      {typeof error === "string" ? error : error.message}
    </p>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className={s.field}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose(): void; title: string; children: ReactNode }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={title} width={640}>
      {children}
    </Dialog>
  );
}

export function duration(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ${sec % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function time(at: number | null | undefined): string {
  if (!at) return "";
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function dateTime(at: number | null | undefined): string {
  if (!at) return "";
  return new Date(at).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
}
