import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import type { ReactNode } from "react";
import s from "./data.module.css";

export function Tabs({
  tabs, value, defaultValue, onValueChange, fill,
}: {
  tabs: { value: string; label: ReactNode; content: ReactNode }[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  fill?: boolean;
}) {
  return (
    <BaseTabs.Root value={value} defaultValue={defaultValue ?? tabs[0]?.value} onValueChange={(v) => onValueChange?.(v as string)} className={fill ? s.tabsFill : undefined}>
      <BaseTabs.List className={s.tabList}>
        {tabs.map((t) => (
          <BaseTabs.Tab key={t.value} value={t.value} className={s.tab}>{t.label}</BaseTabs.Tab>
        ))}
        <BaseTabs.Indicator className={s.tabIndicator} />
      </BaseTabs.List>
      {tabs.map((t) => (
        <BaseTabs.Panel key={t.value} value={t.value} className={s.tabPanel}>{t.content}</BaseTabs.Panel>
      ))}
    </BaseTabs.Root>
  );
}

export type Column<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  width?: number | string;
  align?: "start" | "end";
  muted?: boolean;
  truncate?: boolean;
};

export function Table<T>({ columns, rows, rowKey, onRowClick, empty, label }: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  label?: string;
}) {
  if (rows.length === 0 && empty) return <>{empty}</>;
  return (
    <div className={s.tableWrap}>
      <table className={s.table} aria-label={label}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{ width: c.width }} className={c.align === "end" ? s.alignEnd : undefined}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={`${s.row} ${s.rowEnter} ${onRowClick ? s.clickable : ""}`}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={onRowClick ? (e) => e.key === "Enter" && onRowClick(row) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
            >
              {columns.map((c) => (
                <td key={c.key} className={[c.align === "end" ? s.alignEnd : "", c.muted ? s.muted : "", c.truncate ? s.truncate : ""].join(" ")}>{c.cell(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TextTable({ children }: { children?: ReactNode }) {
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>{children}</table>
    </div>
  );
}

export function Stats({ children }: { children: ReactNode }) {
  return <div className={s.stats}>{children}</div>;
}

export function Stat({ value, label, tone, onClick }: { value: ReactNode; label: ReactNode; tone?: "attention" | "danger"; onClick?: () => void }) {
  const className = [s.stat, tone === "attention" ? s.statAttention : "", tone === "danger" ? s.statDanger : ""].join(" ");
  const body = (
    <>
      <span className={s.statValue}>{value}</span>
      <span className={s.statLabel}>{label}</span>
    </>
  );
  return onClick ? <button type="button" className={className} onClick={onClick}>{body}</button> : <div className={className}>{body}</div>;
}

export { s as dataStyles };
