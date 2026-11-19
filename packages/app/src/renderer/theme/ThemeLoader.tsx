import { useEffect } from "react";
import { call } from "../api/client";
import { useData } from "../api/hooks";
import { applyTokens, builtinThemes, resolveTokens } from "./themes";

export function themeChoice(ui: Record<string, unknown> | undefined): string {
  return typeof ui?.theme === "string" ? ui.theme : "builtin:dark";
}

export function ThemeLoader() {
  const settings = useData(() => call("getSettings"), [], (m) => m.type === "definition.changed" && (m.path === "settings.json" || m.path.startsWith("themes/")));
  const files = useData(() => call("listThemes"), [], (m) => m.type === "definition.changed" && m.path.startsWith("themes/"));
  const choice = themeChoice(settings.data?.value.ui);
  useEffect(() => {
    const builtin = builtinThemes.find((t) => t.id === choice);
    if (builtin) return applyTokens(builtin.tokens);
    const file = files.data?.find((f) => f.file === choice);
    applyTokens(resolveTokens(file?.theme ?? null));
  }, [choice, files.data]);
  return null;
}
