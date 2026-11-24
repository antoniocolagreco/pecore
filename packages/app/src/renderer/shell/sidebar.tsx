import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { List, ListItem, ListLabel, listItemClass } from "../ds/data";
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
      <List>{children}</List>
    </nav>,
    slot,
  );
}

export function SidebarItem({ to, onClick, active, trailing, children }: { to?: string; onClick?(): void; active?: boolean; trailing?: ReactNode; children: ReactNode }) {
  if (to === undefined) return <ListItem active={active} trailing={trailing} onClick={onClick}>{children}</ListItem>;
  return <li>
    <Link className={listItemClass(active)} to={to} draggable={false} aria-current={active ? "page" : undefined}><ListLabel>{children}</ListLabel>{trailing}</Link>
  </li>;
}
