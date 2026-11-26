import { z } from "zod";

export const HexColor = z.string().regex(/^#[0-9A-F]{6}$/, "a colour like #FFDE38");

export type HarnessInfo = { readonly id: string; readonly name: string; readonly color: string; readonly supported: boolean };

export const harnesses: readonly HarnessInfo[] = [
  { id: "claude-code", name: "Claude Code", color: "#D97757", supported: true },
  { id: "codex", name: "Codex", color: "#64748B", supported: true },
  { id: "opencode", name: "OpenCode", color: "#BAE6FD", supported: true },
  { id: "pi", name: "pi", color: "#C4B5FD", supported: true },
  { id: "antigravity", name: "Antigravity CLI", color: "#16A34A", supported: false },
  { id: "copilot", name: "GitHub Copilot CLI", color: "#6366F1", supported: false },
  { id: "cursor", name: "Cursor CLI", color: "#14B8A6", supported: false },
  { id: "deepseek", name: "DeepSeek", color: "#1D4ED8", supported: false },
  { id: "qwen", name: "Qwen", color: "#FBBF24", supported: false },
  { id: "kimi", name: "Kimi", color: "#67E8F9", supported: false },
  { id: "grok", name: "Grok", color: "#7E22CE", supported: false },
  { id: "muse", name: "Muse", color: "#0EA5E9", supported: false },
];

export function modelOnlyHarness(id: string): boolean {
  return id === "opencode" || id === "pi";
}

export function harnessColor(id: string, overrides: Readonly<Record<string, string>>): string {
  return overrides[id] ?? harnesses.find((harness) => harness.id === id)?.color ?? "#64748B";
}
