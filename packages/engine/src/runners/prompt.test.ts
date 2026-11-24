import { describe, expect, it } from "vitest";
import { buildPrompt, developmentNote } from "./agent";
import type { AgentNode } from "@pecore/schemas";

const node = { outcomes: ["done"], outputs: [] } as unknown as AgentNode;

describe("agent node prompt", () => {
  it("tells the agent the app is in development only when the app runs from source", () => {
    const dev: string = buildPrompt("Write the code.", node, [], [], [], true);
    expect(dev).toContain(`## Development\n\n${developmentNote}`);
    expect(dev.indexOf("Write the code.")).toBeLessThan(dev.indexOf(developmentNote));
    expect(buildPrompt("Write the code.", node, [], [], [], false)).not.toContain(developmentNote);
    expect(buildPrompt("Write the code.", node, [], [])).not.toContain(developmentNote);
  });
});
