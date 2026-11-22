import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { forgeHome } from "../../test/forge-project";
import { Engine } from "../main";

describe("services runtime detection at start", () => {
  it("saves the runtime it finds when none is set, and tells the user", async () => {
    const { home, templates } = await forgeHome();
    const notices: string[] = [];
    const engine = await Engine.start({ home, templates, detectRuntime: async () => "podman", notify: ({ body }) => notices.push(body) });
    await engine.shutdown();
    expect(JSON.parse(await readFile(join(home, "settings.json"), "utf8"))).toMatchObject({ servicesRuntime: "podman" });
    expect(notices).toContain("Found podman for project services.");
  });

  it("keeps a runtime already chosen and leaves settings alone when nothing is found", async () => {
    const chosen = await forgeHome();
    await writeFile(join(chosen.home, "settings.json"), JSON.stringify({ servicesRuntime: "docker" }));
    let asked: boolean = false;
    const first = await Engine.start({ home: chosen.home, templates: chosen.templates, detectRuntime: async () => { asked = true; return "podman"; } });
    await first.shutdown();
    expect(asked).toBe(false);
    expect(JSON.parse(await readFile(join(chosen.home, "settings.json"), "utf8"))).toEqual({ servicesRuntime: "docker" });

    const empty = await forgeHome();
    const before: string | null = await readFile(join(empty.home, "settings.json"), "utf8").catch(() => null);
    const second = await Engine.start({ home: empty.home, templates: empty.templates, detectRuntime: async () => null });
    await second.shutdown();
    expect(await readFile(join(empty.home, "settings.json"), "utf8").catch(() => null)).toBe(before);
  });
});
