import { describe, expect, it } from "vitest";
import { Compaction, Settings } from "./settings";

describe("settings", () => {
  it("keep compaction thresholds on 64K, 128K, 256K, 512K or 1024K, with at once at least twice idle", () => {
    const compaction = (value: object) => Compaction.parse(value);
    expect(compaction({ auto: 128_000, max: 256_000 })).toEqual({ auto: 131_072, max: 262_144 });
    expect(compaction({ auto: 1000, max: 2000 })).toEqual({ auto: 65_536, max: 131_072 });
    expect(compaction({ auto: 262_144, max: 262_144 })).toEqual({ auto: 262_144, max: 524_288 });
    expect(compaction({ auto: 2_000_000, max: 5_000_000 })).toEqual({ auto: 524_288, max: 1_048_576 });
  });

  it("keep the user's name trimmed and refuse an empty one", () => {
    expect(Settings.parse({ user: { name: " Antonio " } }).user).toEqual({ name: "Antonio" });
    expect(Settings.safeParse({ user: { name: " " } }).success).toBe(false);
  });
});
