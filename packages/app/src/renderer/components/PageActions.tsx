import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

export const PageActionsSlot = createContext<HTMLElement | null | undefined>(undefined);

export function PageActions({ children }: { children: ReactNode }) {
  const slot: HTMLElement | null | undefined = useContext(PageActionsSlot);
  if (slot === undefined) return <>{children}</>;
  return slot ? createPortal(children, slot) : null;
}
