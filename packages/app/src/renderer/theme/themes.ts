import type { Theme, themeTokens } from "@pecore/schemas";

type ThemeToken = (typeof themeTokens)[number];

export type Mode = "light" | "dark";

const tokenVars: Record<ThemeToken, string[]> = {
  bg: ["--bg"],
  "bg-gradient-1": [],
  "bg-gradient-2": [],
  surface: ["--surface"],
  "surface-raised": ["--control-bg", "--control-bg-hover"],
  border: ["--control-border", "--separator"],
  text: ["--text"],
  "text-muted": ["--text-2"],
  accent: ["--accent", "--accent-hover"],
  "status-running": [],
  "status-success": ["--success"],
  "status-failed": ["--danger"],
  "status-warning": ["--warning"],
  "status-inactive": ["--text-3"],
};

export function systemMode(): Mode {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function luminance(color: string): number | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})/i.exec(color)?.[1];
  if (!hex) return null;
  const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function applyTheme(mode: Mode, theme: Theme | null): () => void {
  const root = document.documentElement;
  const bg = theme?.tokens.bg ? luminance(theme.tokens.bg) : null;
  root.dataset.theme = bg === null ? mode : bg < 0.5 ? "dark" : "light";
  const set: string[] = [];
  for (const [token, value] of Object.entries(theme?.tokens ?? {})) {
    for (const name of tokenVars[token as ThemeToken] ?? []) {
      root.style.setProperty(name, value);
      set.push(name);
    }
  }
  return () => {
    for (const name of set) root.style.removeProperty(name);
  };
}
