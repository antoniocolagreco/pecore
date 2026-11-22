import { describe, expect, it } from "vitest";
import { Settings, assistantTraits, incompatibleTraits, roleProfile } from "./settings";

describe("Assistant and Project Manager settings", () => {
  it("default to no model and compaction at 128k when idle and 256k at once, for each role", () => {
    const settings: Settings = Settings.parse({});
    expect(settings.assistant).toEqual({ profile: null, compaction: { auto: 128_000, max: 256_000 }, traits: [] });
    expect(settings.user).toEqual({ name: null });
    expect(settings.pm).toEqual({ profile: null, compaction: { auto: 128_000, max: 256_000 } });
  });

  it("give the Project Manager the Assistant's model unless it has its own", () => {
    const settings: Settings = Settings.parse({ assistant: { profile: "a" } });
    expect(roleProfile(settings, "assistant")).toBe("a");
    expect(roleProfile(settings, "pm")).toBe("a");
    expect(roleProfile(Settings.parse({ assistant: { profile: "a" }, pm: { profile: "p" } }), "pm")).toBe("p");
    expect(roleProfile(Settings.parse({}), "pm")).toBeNull();
  });

  it("keep the user's name trimmed and refuse an empty one", () => {
    expect(Settings.parse({ user: { name: " Antonio " } }).user).toEqual({ name: "Antonio" });
    expect(Settings.safeParse({ user: { name: " " } }).success).toBe(false);
  });

  it("accept compatible Assistant traits and refuse unknown, repeated or incompatible ones", () => {
    expect(Settings.parse({ assistant: { traits: ["pragmatic", "minimalist", "critical"] } }).assistant.traits).toEqual(["pragmatic", "minimalist", "critical"]);
    expect(Settings.safeParse({ assistant: { traits: ["grumpy"] } }).success).toBe(false);
    expect(Settings.safeParse({ assistant: { traits: ["bold", "bold"] } }).success).toBe(false);
    expect(Settings.safeParse({ assistant: { traits: ["minimalist", "narrative"] } }).error?.issues[0]?.message).toBe("minimalist does not go with narrative");
    expect(Settings.safeParse({ pm: { traits: [] } }).success).toBe(false);
  });

  it("list 24 traits whose incompatibilities go both ways", () => {
    expect(assistantTraits).toHaveLength(24);
    for (const { id } of assistantTraits) {
      for (const other of incompatibleTraits[id]) expect(incompatibleTraits[other]).toContain(id);
    }
  });
});
