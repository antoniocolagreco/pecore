import { useEffect, useState } from "react";
import { call } from "../api/client";
import { useData } from "../api/hooks";
import { applyTheme, systemMode, themePrefs } from "./themes";
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
  const settings = useData(() => call("getSettings"), [], (m) => m.type === "configuration.changed" && m.kind === "settings");
  const system = useSystemMode();
  const prefs: ThemePrefs = themePrefs(settings.data?.value.ui);
  const mode: Mode = prefs.mode === "system" ? system : prefs.mode;
  const choice: string = prefs.theme;
  useEffect(() => applyTheme(mode, choice), [mode, choice]);
  return null;
}
