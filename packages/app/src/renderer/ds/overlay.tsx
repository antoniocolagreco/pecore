import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { Menu as BaseMenu } from "@base-ui/react/menu";
import { Toast } from "@base-ui/react/toast";
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { BellIcon, XIcon } from "./icons";
import s from "./overlay.module.css";

export function Tooltip({ content, shortcut, side = "bottom", children }: { content: ReactNode; shortcut?: string; side?: "top" | "bottom" | "left" | "right"; children: ReactElement }) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} sideOffset={6} style={{ zIndex: 70 }}>
          <BaseTooltip.Popup className={s.tooltip}>
            {content}
            {shortcut && <span className={s.shortcut}>{shortcut}</span>}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <BaseTooltip.Provider delay={450} closeDelay={80}>{children}</BaseTooltip.Provider>;
}

export function Dialog({
  open, onOpenChange, title, description, children, footer, width,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className={s.backdrop} />
        <BaseDialog.Popup className={s.dialog} style={width ? ({ "--dialog-width": `${width}px` } as CSSProperties) : undefined}>
          <div className={s.dialogHeader}>
            <BaseDialog.Title className={s.dialogTitle}>{title}</BaseDialog.Title>
            {description && <BaseDialog.Description className={s.dialogDescription}>{description}</BaseDialog.Description>}
          </div>
          {children && <div className={s.dialogBody}>{children}</div>}
          {footer && <div className={s.dialogFooter}>{footer}</div>}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

export type MenuEntry =
  | { label: ReactNode; icon?: ReactNode; shortcut?: string; onSelect: () => void; disabled?: boolean; danger?: boolean }
  | "separator";

export function Menu({ trigger, items, align = "start" }: { trigger: ReactElement; items: MenuEntry[]; align?: "start" | "center" | "end" }) {
  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger render={trigger} />
      <BaseMenu.Portal>
        <BaseMenu.Positioner sideOffset={6} align={align} style={{ zIndex: 50 }}>
          <BaseMenu.Popup className={s.menu}>
            {items.map((item, i) =>
              item === "separator" ? (
                <BaseMenu.Separator key={i} className={s.menuSeparator} />
              ) : (
                <BaseMenu.Item key={i} className={`${s.menuItem} ${item.danger ? s.menuItemDanger : ""}`} onClick={item.onSelect} disabled={item.disabled}>
                  {item.icon}
                  <span>{item.label}</span>
                  {item.shortcut && <span className={s.menuShortcut}>{item.shortcut}</span>}
                </BaseMenu.Item>
              ),
            )}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}

function ToastList() {
  const { toasts } = Toast.useToastManager();
  return toasts.map((toast) => (
    <Toast.Root key={toast.id} toast={toast} className={s.toast} swipeDirection={["right", "down"]}>
      <Toast.Content className={s.toastContent}>
        <span className={s.toastIcon}><BellIcon /></span>
        <div className={s.toastText}>
          <Toast.Title className={s.toastTitle} />
          <Toast.Description className={s.toastDescription} />
        </div>
        <Toast.Close className={s.toastClose} aria-label="Dismiss"><XIcon size="xs" /></Toast.Close>
      </Toast.Content>
    </Toast.Root>
  ));
}

export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <Toast.Provider limit={3} timeout={6000}>
      {children}
      <Toast.Portal>
        <Toast.Viewport className={s.toasts}>
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}

export const useToasts = Toast.useToastManager;
