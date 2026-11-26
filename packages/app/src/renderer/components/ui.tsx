import type { ReactNode } from "react";
import { usePageScroll } from "./usePageScroll";
import s from "./ui.module.css";

export { s as ui };

export function Page({ title, actions, width, fillHeight, scrollTo, scrollReady, children }: { title: string; actions?: ReactNode; width?: number; fillHeight?: boolean; scrollTo?: string | null; scrollReady?: boolean; children: ReactNode }) {
  const { page, content } = usePageScroll("page", scrollTo, scrollReady);
  return (
    <div ref={page} className={s.page} data-fill-height={fillHeight || undefined}>
      <div ref={content} className={s.pageInner} style={width ? { maxWidth: width } : undefined}>
        <header className={s.pageHeader}>
          <h1 className={s.title}>{title}</h1>
          <div className={s.row}>{actions}</div>
        </header>
        <div className={s.stack}>{children}</div>
      </div>
    </div>
  );
}

export function ErrorText({ error }: { error: string | Error | null | undefined }) {
  if (!error) return null;
  return (
    <p className={s.error} role="alert">
      {typeof error === "string" ? error : error.message}
    </p>
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
