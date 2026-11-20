import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import s from "./button.module.css";
import { Spinner } from "./feedback";
import { Tooltip } from "./overlay";

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "dangerSolid";
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  loading?: boolean;
  children?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "secondary", size = "md", icon, loading, className, children, disabled, ...rest }, ref) {
  const classes = [s.button, s[variant], size !== "md" && s[size], !children && s.iconOnly, loading && s.loading, className].filter(Boolean).join(" ");
  return (
    <button ref={ref} type="button" className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {icon && <span className={s.icon}>{icon}</span>}
      {children && <span>{children}</span>}
      {loading && <span className={s.spinner}><Spinner /></span>}
    </button>
  );
});

export function IconButton({ label, shortcut, ...props }: Omit<ButtonProps, "children"> & { label: string; shortcut?: string }) {
  return (
    <Tooltip content={label} shortcut={shortcut}>
      <Button variant="ghost" aria-label={label} {...props} />
    </Tooltip>
  );
}
