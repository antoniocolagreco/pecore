import { useEffect, useState } from "react";
import { call } from "../api/client";
import { useData } from "../api/hooks";
import { applyTheme, systemMode } from "./themes";
import type { Mode } from "./themes";

export function themeChoice(ui: Record<string, unknown> | undefined): string {
  return typeof ui?.theme === "string" ? ui.theme : "builtin:system";
}

function useSystemMode(): Mode {
  const [mode, setMode] = useState<Mode>(systemMode);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const change = () => setMode(media.matches ? "dark" : "light");
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  return mode;
}

export function ThemeLoader() {
  const settings = useData(() => call("getSettings"), [], (m) => m.type === "definition.changed" && (m.path === "settings.json" || m.path.startsWith("themes/")));
  const files = useData(() => call("listThemes"), [], (m) => m.type === "definition.changed" && m.path.startsWith("themes/"));
  const system = useSystemMode();
  const choice = themeChoice(settings.data?.value.ui);
  useEffect(() => {
    if (choice === "builtin:light") return applyTheme("light", null);
    if (choice === "builtin:dark") return applyTheme("dark", null);
    const file = choice.startsWith("builtin:") ? undefined : files.data?.find((f) => f.file === choice);
    return applyTheme(system, file?.theme ?? null);
  }, [choice, files.data, system]);
  return null;
}
