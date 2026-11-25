export type Mode = "light" | "dark";

export function systemMode(): Mode {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export type ThemeMode = "system" | Mode;
export type ThemePrefs = { mode: ThemeMode; theme: string };

export const defaultTheme = "builtin:default";

const palettes: Record<string, string> = {
  autumn: "Autumn",
  spring: "Spring",
  woodlands: "Woodlands",
  summer: "Summer",
  winter: "Winter",
  monochrome: "Monochrome",
};

export const builtInThemes: { value: string; label: string }[] = [
  { value: defaultTheme, label: "Default" },
  ...Object.entries(palettes).map(([value, label]) => ({ value: `builtin:${value}`, label })),
];

export function themePrefs(ui: Record<string, unknown> | undefined): ThemePrefs {
  const pick = (value: unknown): string => builtInThemes.find(({ value: id }) => id === value)?.value ?? defaultTheme;
  const mode: ThemeMode = ui?.mode === "light" || ui?.mode === "dark" ? ui.mode : "system";
  if (typeof ui?.theme === "string") return { mode, theme: pick(ui.theme) };
  const light: string = pick(ui?.lightTheme);
  const dark: string = pick(ui?.darkTheme);
  return { mode, theme: mode === "system" ? (light === defaultTheme ? dark : light) : mode === "dark" ? dark : light };
}

export function applyTheme(mode: Mode, choice: string): void {
  const root = document.documentElement;
  root.dataset.theme = mode;
  const palette: string | undefined = /^builtin:(.+)$/.exec(choice)?.[1];
  if (palette && Object.hasOwn(palettes, palette)) root.dataset.palette = `${palette}-${mode}`;
  else delete root.dataset.palette;
}
