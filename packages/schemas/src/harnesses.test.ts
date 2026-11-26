import { describe, expect, it } from "vitest";
import { agentColors } from "./colors";
import { harnessColor, harnesses } from "./harnesses";

describe("AI tool colours", () => {
  it("lists four working AI tools and four coming soon, each with its own fixed colour outside the agent palette", () => {
    expect(harnesses.map(({ id, supported }) => [id, supported])).toEqual([
      ["claude-code", true], ["codex", true], ["opencode", true], ["pi", true],
      ["antigravity", false], ["copilot", false], ["deepseek", false], ["grok", false],
    ]);
    for (const { color } of harnesses) expect(agentColors.some(({ hex }) => hex === color)).toBe(false);
    expect(harnesses.find(({ id }) => id === "claude-code")?.color).toBe("#D97757");
    expect(harnesses.find(({ id }) => id === "codex")?.color).toBe("#EEF1F2");
    expect(harnesses.find(({ id }) => id === "opencode")?.color).toBe("#5D9BEA");
    expect(harnesses.find(({ id }) => id === "pi")).toMatchObject({ name: "Pi", color: "#F59E0B" });
    expect(harnesses.find(({ id }) => id === "antigravity")?.color).toBe("#3DA955");
    expect(harnesses.find(({ id }) => id === "deepseek")?.color).toBe("#5785FA");
    expect(harnesses.find(({ id }) => id === "grok")?.color).toBe("#0F1419");
    expect(harnesses.find(({ id }) => id === "copilot")?.color).toBe("#8957E5");
  });

  it("returns the AI tool's own colour, else slate", () => {
    expect(harnessColor("codex")).toBe("#EEF1F2");
    expect(harnessColor("something-else")).toBe("#64748B");
  });
});
