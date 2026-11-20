import { describe, expect, it } from "vitest";
import { Settings, roleProfile } from "./settings";

describe("Assistant and Orchestrator settings", () => {
  it("default to no model and compaction at 128k when idle and 256k at once, for each role", () => {
    const settings: Settings = Settings.parse({});
    expect(settings.assistant).toEqual({ profile: null, compaction: { auto: 128_000, max: 256_000 } });
    expect(settings.orchestrator).toEqual({ profile: null, compaction: { auto: 128_000, max: 256_000 } });
  });

  it("give the Orchestrator the Assistant's model unless it has its own", () => {
    const settings: Settings = Settings.parse({ assistant: { profile: "a" } });
    expect(roleProfile(settings, "assistant")).toBe("a");
    expect(roleProfile(settings, "orchestrator")).toBe("a");
    expect(roleProfile(Settings.parse({ assistant: { profile: "a" }, orchestrator: { profile: "o" } }), "orchestrator")).toBe("o");
    expect(roleProfile(Settings.parse({}), "orchestrator")).toBeNull();
  });
});
