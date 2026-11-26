import { z } from "zod";

export const HexColor = z.string().regex(/^#[0-9A-F]{6}$/, "a colour like #FFDE38");

export type HarnessInfo = { readonly id: string; readonly name: string; readonly color: string; readonly supported: boolean };

export const harnesses: readonly HarnessInfo[] = [
  { id: "claude-code", name: "Claude Code", color: "#D97757", supported: true },
  { id: "codex", name: "Codex", color: "#EEF1F2", supported: true },
  { id: "opencode", name: "OpenCode", color: "#5D9BEA", supported: true },
  { id: "pi", name: "Pi", color: "#F59E0B", supported: true },
  { id: "antigravity", name: "Antigravity CLI", color: "#3DA955", supported: false },
  { id: "copilot", name: "GitHub Copilot CLI", color: "#8957E5", supported: false },
  { id: "deepseek", name: "DeepSeek", color: "#5785FA", supported: false },
  { id: "grok", name: "Grok", color: "#0F1419", supported: false },
];

export function modelOnlyHarness(id: string): boolean {
  return id === "opencode" || id === "pi";
}

export function harnessColor(id: string, overrides: Readonly<Record<string, string>>): string {
  return overrides[id] ?? harnesses.find((harness) => harness.id === id)?.color ?? "#64748B";
}
