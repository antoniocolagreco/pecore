import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";

const key = "pecore.projectFilter";

function stored(): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

const FilterContext = createContext<{ project: string | null; setProject(p: string | null): void }>({ project: null, setProject: () => undefined });

export function FilterProvider({ children }: { children: ReactNode }) {
  const [project, set] = useState<string | null>(stored);
  const setProject = (p: string | null) => {
    set(p);
    try {
      if (p) localStorage.setItem(key, p);
      else localStorage.removeItem(key);
    } catch {
      return;
    }
  };
  return <FilterContext.Provider value={{ project, setProject }}>{children}</FilterContext.Provider>;
}

export function useProjectFilter() {
  return useContext(FilterContext);
}
