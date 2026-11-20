import { useEffect, useState } from "react";
import { call } from "../api/client";
import { useData } from "../api/hooks";
import { applyTheme, systemMode, themeMode, themePrefs } from "./themes";
import type { Mode, ThemePrefs } from "./themes";

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
  const prefs: ThemePrefs = themePrefs(settings.data?.value.ui);
  const mode: Mode = prefs.mode === "system" ? system : prefs.mode;
  const choice: string = prefs.theme;
  useEffect(() => {
    const file = choice.startsWith("builtin:") ? undefined : files.data?.find((f) => f.file === choice);
    const theme = file?.theme ?? null;
    const variant: Mode | null = themeMode(theme);
    return applyTheme(mode, choice, variant === null || variant === mode ? theme : null);
  }, [mode, choice, files.data]);
  return null;
}
