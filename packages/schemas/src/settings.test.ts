import { describe, expect, it } from "vitest";
import { Settings, roleProfile } from "./settings";

describe("Assistant and Project Manager settings", () => {
  it("default to no model and compaction at 128k when idle and 256k at once, for each role", () => {
    const settings: Settings = Settings.parse({});
    expect(settings.assistant).toEqual({ profile: null, compaction: { auto: 128_000, max: 256_000 } });
    expect(settings.pm).toEqual({ profile: null, compaction: { auto: 128_000, max: 256_000 } });
  });

  it("give the Project Manager the Assistant's model unless it has its own", () => {
    const settings: Settings = Settings.parse({ assistant: { profile: "a" } });
    expect(roleProfile(settings, "assistant")).toBe("a");
    expect(roleProfile(settings, "pm")).toBe("a");
    expect(roleProfile(Settings.parse({ assistant: { profile: "a" }, pm: { profile: "p" } }), "pm")).toBe("p");
    expect(roleProfile(Settings.parse({}), "pm")).toBeNull();
  });
});
