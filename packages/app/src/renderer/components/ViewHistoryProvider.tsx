import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";

type Store<T> = { entries: Map<string, T>; recent: Map<string, T> };
type Position = { top: number; left: number };
type ViewHistory = { state: Store<unknown>; scroll: Store<Position> };

const ViewHistoryContext = createContext<ViewHistory | null>(null);

export function ViewHistoryProvider({ children }: { children: ReactNode }) {
  const [history] = useState<ViewHistory>(() => ({
    state: { entries: new Map(), recent: new Map() },
    scroll: { entries: new Map(), recent: new Map() },
  }));
  return <ViewHistoryContext.Provider value={history}>{children}</ViewHistoryContext.Provider>;
}

export function useViewHistory(): ViewHistory {
  const history = useContext(ViewHistoryContext);
  if (!history) throw new Error("ViewHistoryProvider is missing.");
  return history;
}
