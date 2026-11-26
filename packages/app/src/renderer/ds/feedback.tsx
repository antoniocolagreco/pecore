import type { CSSProperties, ReactNode, Ref } from "react";
import { IconButton } from "./button";
import s from "./feedback.module.css";
import { AlertIcon, CheckCircleIcon, InfoIcon, XIcon } from "./icons";
import type { IconSize } from "./icons";

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

export function Spinner({ size = "sm" }: { size?: IconSize }) {
  return (
    <svg className={s.spinner} data-icon={size} viewBox="0 0 16 16" fill="none" aria-label="Loading" role="img">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
      <path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Badge({ tone = "neutral", dot, pulse, iconOnly, children }: { tone?: Tone; dot?: boolean; pulse?: boolean; iconOnly?: boolean; children: ReactNode }) {
  return (
    <span className={`${s.badge} ${s[tone]}`} data-icon-only={iconOnly || undefined}>
      {dot && <span className={`${s.dot} ${pulse ? s.pulse : ""}`} />}
      {children}
    </span>
  );
}

export function Count({ value, label }: { value: number; label?: string }) {
  if (value <= 0) return null;
  return <span key={value} className={s.count} aria-label={label}>{value > 99 ? "99+" : value}</span>;
}

const alertIcons: Record<Tone, ReactNode> = {
  neutral: <InfoIcon />,
  accent: <InfoIcon />,
  success: <CheckCircleIcon />,
  warning: <AlertIcon />,
  danger: <AlertIcon />,
};

export function Alert({ tone = "accent", title, children, actions, onClose }: {
  tone?: Tone; title?: ReactNode; children?: ReactNode; actions?: ReactNode; onClose?(): void;
}) {
  return (
    <div className={`${s.alert} ${s[tone]}`} data-dismissible={onClose ? "" : undefined} role={tone === "danger" ? "alert" : "status"}>
      {alertIcons[tone]}
      <div className={s.alertBody}>
        {title && <span className={s.alertTitle}>{title}</span>}
        {children && <span className={title ? s.alertText : undefined}>{children}</span>}
      </div>
      {actions && <div className={s.alertActions}>{actions}</div>}
      {onClose && <IconButton className={s.alertClose} size="sm" label="Dismiss alert" icon={<XIcon size="xs" />} onClick={onClose} />}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={s.empty}>
      {icon && <div className={s.emptyIcon}>{icon}</div>}
      <div className={s.emptyTitle}>{title}</div>
      {children && <div className={s.emptyText}>{children}</div>}
      {action && <div className={s.emptyAction}>{action}</div>}
    </div>
  );
}

export function Card({ title, actions, padded, className, children, ref, bodyRef }: { title?: ReactNode; actions?: ReactNode; padded?: boolean; className?: string; children: ReactNode; ref?: Ref<HTMLElement>; bodyRef?: Ref<HTMLDivElement> }) {
  return (
    <section ref={ref} className={[s.card, padded && !title ? s.cardPadded : "", className ?? ""].join(" ")}>
      {title !== undefined && (
        <header className={s.cardHeader}>
          <h3 className={s.cardTitle}>{title}</h3>
          {actions}
        </header>
      )}
      {title !== undefined ? <div ref={bodyRef} className={padded === false ? undefined : s.cardBody}>{children}</div> : children}
    </section>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className={s.kbd}>{children}</kbd>;
}

export function Progress({ value }: { value: number | null }) {
  return (
    <div className={s.progress} role="progressbar" aria-valuenow={value ?? undefined} aria-valuemin={0} aria-valuemax={100}>
      <div className={`${s.progressBar} ${value === null ? s.progressIndeterminate : ""}`} style={value === null ? undefined : { width: `${value}%` }} />
    </div>
  );
}

export function Skeleton({ width = "100%", height = 14, style }: { width?: number | string; height?: number; style?: CSSProperties }) {
  return <div className={s.skeleton} style={{ width, height, ...style }} />;
}
