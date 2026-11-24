import { describe, expect, it } from "vitest";
import { Settings, assistantTraits, incompatibleTraits, roleProfile } from "./settings";

describe("Assistant and Project Manager settings", () => {
  it("default to no model and compaction at 128K when idle and 256K at once, for each role", () => {
    const settings: Settings = Settings.parse({});
    expect(settings.assistant).toEqual({ profile: null, compaction: { auto: 131_072, max: 262_144 }, traits: [] });
    expect(settings.user).toEqual({ name: null });
    expect(settings.pm).toEqual({ profile: null, compaction: { auto: 131_072, max: 262_144 } });
  });

  it("keep compaction thresholds on 64K, 128K, 256K, 512K or 1024K, with at once at least twice idle", () => {
    const compaction = (value: object) => Settings.parse({ pm: { compaction: value } }).pm.compaction;
    expect(compaction({ auto: 128_000, max: 256_000 })).toEqual({ auto: 131_072, max: 262_144 });
    expect(compaction({ auto: 1000, max: 2000 })).toEqual({ auto: 65_536, max: 131_072 });
    expect(compaction({ auto: 262_144, max: 262_144 })).toEqual({ auto: 262_144, max: 524_288 });
    expect(compaction({ auto: 2_000_000, max: 5_000_000 })).toEqual({ auto: 524_288, max: 1_048_576 });
  });

  it("give the Project Manager the Assistant's model unless it has its own", () => {
    const settings: Settings = Settings.parse({ assistant: { profile: "a" } });
    expect(roleProfile(settings, "assistant", ["s"])).toBe("a");
    expect(roleProfile(settings, "pm", ["s"])).toBe("a");
    expect(roleProfile(Settings.parse({ assistant: { profile: "a" }, pm: { profile: "p" } }), "pm", ["s"])).toBe("p");
    expect(roleProfile(Settings.parse({}), "pm", [])).toBeNull();
  });

  it("uses the first standard profile when no profile is chosen", () => {
    expect(roleProfile(Settings.parse({}), "assistant", ["claude-code-standard", "codex-standard"])).toBe("claude-code-standard");
    expect(roleProfile(Settings.parse({}), "pm", ["codex-standard"])).toBe("codex-standard");
  });

  it("keep the user's name trimmed and refuse an empty one", () => {
    expect(Settings.parse({ user: { name: " Antonio " } }).user).toEqual({ name: "Antonio" });
    expect(Settings.safeParse({ user: { name: " " } }).success).toBe(false);
  });

  it("accept compatible Assistant traits and refuse unknown, repeated or incompatible ones", () => {
    expect(Settings.parse({ assistant: { traits: ["pragmatic", "minimalist", "critical"] } }).assistant.traits).toEqual(["pragmatic", "minimalist", "critical"]);
    expect(Settings.safeParse({ assistant: { traits: ["grumpy"] } }).success).toBe(false);
    expect(Settings.safeParse({ assistant: { traits: ["bold", "bold"] } }).success).toBe(false);
    expect(Settings.safeParse({ assistant: { traits: ["minimalist", "mentor"] } }).error?.issues[0]?.message).toBe("minimalist does not go with mentor");
    expect(Settings.safeParse({ assistant: { traits: ["narrative"] } }).success).toBe(false);
    expect(Settings.safeParse({ pm: { traits: [] } }).success).toBe(false);
  });

  it("list 17 traits whose incompatibilities go both ways", () => {
    expect(assistantTraits).toHaveLength(17);
    for (const { id } of assistantTraits) {
      for (const other of incompatibleTraits[id]) expect(incompatibleTraits[other]).toContain(id);
    }
  });
});
