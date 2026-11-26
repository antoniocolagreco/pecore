import { describe, expect, it } from "vitest";
import { agentColors } from "./colors";
import { harnessColor, harnesses } from "./harnesses";
import { Settings } from "./settings";

describe("AI tool colours", () => {
  it("lists four working AI tools and four coming soon, each with its own colour, from the palette except Claude Code's terracotta", () => {
    expect(harnesses.map(({ id, supported }) => [id, supported])).toEqual([
      ["claude-code", true], ["codex", true], ["opencode", true], ["pi", true],
      ["antigravity", false], ["copilot", false], ["deepseek", false], ["grok", false],
    ]);
    expect(new Set(harnesses.map(({ color }) => color)).size).toBe(harnesses.length);
    for (const { id, color } of harnesses) expect(agentColors.some(({ hex }) => hex === color)).toBe(id !== "claude-code");
    expect(harnesses.find(({ id }) => id === "claude-code")?.color).toBe("#D97757");
  });

  it("uses the user's colour when set, else the AI tool's own, else slate", () => {
    expect(harnessColor("codex", {})).toBe("#64748B");
    expect(harnessColor("codex", { codex: "#123456" })).toBe("#123456");
    expect(harnessColor("something-else", {})).toBe("#64748B");
  });

  it("keeps the user's colours in settings, upper-case hex only", () => {
    expect(Settings.parse({}).harnessColors).toEqual({});
    expect(Settings.parse({ harnessColors: { grok: "#ABCDEF" } }).harnessColors).toEqual({ grok: "#ABCDEF" });
    expect(Settings.safeParse({ harnessColors: { grok: "#abcdef" } }).success).toBe(false);
    expect(Settings.safeParse({ harnessColors: { grok: "red" } }).success).toBe(false);
  });
});
