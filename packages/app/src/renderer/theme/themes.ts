import { themeTokens } from "@pecore/schemas";
import type { Theme } from "@pecore/schemas";

export type Tokens = Record<(typeof themeTokens)[number], string>;

export const everforestDark: Tokens = {
  bg: "#232a2e",
  "bg-gradient-1": "#42644d38",
  "bg-gradient-2": "#9a904224",
  surface: "#2b3537",
  "surface-raised": "#303b3d",
  border: "#455154",
  text: "#e6e4d4",
  "text-muted": "#a7b0a4",
  accent: "#83c092",
  "status-running": "#7fbbb3",
  "status-success": "#a7c080",
  "status-failed": "#e67e80",
  "status-warning": "#dbbc7f",
  "status-inactive": "#7f9187",
};

export const everforestLight: Tokens = {
  bg: "#fdf6e3",
  "bg-gradient-1": "#93b25926",
  "bg-gradient-2": "#dfa00020",
  surface: "#f4f0d9",
  "surface-raised": "#efebd4",
  border: "#d8d3ba",
  text: "#4f5b62",
  "text-muted": "#6f7f74",
  accent: "#35a77c",
  "status-running": "#3a94c5",
  "status-success": "#6f8a00",
  "status-failed": "#d84a47",
  "status-warning": "#b98400",
  "status-inactive": "#879386",
};

export const builtinThemes: { id: string; name: string; tokens: Tokens }[] = [
  { id: "builtin:dark", name: "Dark green", tokens: everforestDark },
  { id: "builtin:light", name: "Light", tokens: everforestLight },
];

export function resolveTokens(theme: Theme | null): Tokens {
  return { ...everforestDark, ...(theme?.tokens ?? {}) };
}

export function applyTokens(tokens: Tokens): void {
  const root = document.documentElement;
  for (const key of themeTokens) root.style.setProperty(`--${key}`, tokens[key]);
}
