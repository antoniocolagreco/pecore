import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import s from "./Layout.module.css";

export const SidebarSlot = createContext<HTMLElement | null>(null);

export function SidebarSection({ title, action, label, children }: { title: string; action?: ReactNode; label?: string; children: ReactNode }) {
  const slot: HTMLElement | null = useContext(SidebarSlot);
  if (!slot) return null;
  return createPortal(
    <nav className={s.section} aria-label={label ?? title}>
      <div className={s.sectionHead}>
        <span className={s.groupTitle}>{title}</span>
        {action}
      </div>
      <ul className={s.subItems}>{children}</ul>
    </nav>,
    slot,
  );
}

export function SidebarItem({ to, onClick, active, trailing, children }: { to?: string; onClick?(): void; active?: boolean; trailing?: ReactNode; children: ReactNode }) {
  const className: string = [s.subItem, active ? s.active : ""].join(" ");
  const content: ReactNode = <><span className={s.subLabel}>{children}</span>{trailing}</>;
  return <li>
    {to !== undefined
      ? <Link className={className} to={to} aria-current={active ? "page" : undefined}>{content}</Link>
      : <button type="button" className={className} aria-current={active ? "true" : undefined} onClick={onClick}>{content}</button>}
  </li>;
}
