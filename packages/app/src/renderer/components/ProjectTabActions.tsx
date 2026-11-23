import type { ReactNode } from "react";
import s from "./ProjectTabActions.module.css";

export function ProjectTabActions({ title, leading, children }: { title: string; leading?: ReactNode; children?: ReactNode }) {
  return <header className={s.bar} role="group" aria-label={`${title} actions`}>
    <div className={s.group}>
      <h2>{title}</h2>
      {leading}
    </div>
    {children && <div className={s.actions}>{children}</div>}
  </header>;
}
