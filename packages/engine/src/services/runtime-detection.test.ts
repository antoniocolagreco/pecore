import { describe, expect, it } from "vitest";
import type { Settings } from "@pecore/schemas";
import { setTestConfiguration, testConfiguration } from "../../test/configuration";
import { forgeHome } from "../../test/forge-project";
import { Engine } from "../main";

describe("services runtime detection at start", () => {
  it("saves the runtime it finds when none is set, and tells the user", async () => {
    const { home, templates } = await forgeHome();
    const notices: string[] = [];
    const engine = await Engine.start({ home, templates, detectRuntime: async () => "podman", notify: ({ body }) => notices.push(body) });
    await engine.shutdown();
    expect(await testConfiguration(home, (config) => config.settings())).toMatchObject({ servicesRuntime: "podman" });
    expect(notices).toContain("Found podman for project services.");
  });

  it("keeps a runtime already chosen and leaves settings alone when nothing is found", async () => {
    const chosen = await forgeHome();
    await setTestConfiguration(chosen.home, "settings", { servicesRuntime: "docker" });
    let asked: boolean = false;
    const first = await Engine.start({ home: chosen.home, templates: chosen.templates, detectRuntime: async () => { asked = true; return "podman"; } });
    await first.shutdown();
    expect(asked).toBe(false);
    expect(await testConfiguration(chosen.home, (config) => config.settings())).toMatchObject({ servicesRuntime: "docker" });

    const empty = await forgeHome();
    const before: Settings = await testConfiguration(empty.home, (config) => config.settings());
    const second = await Engine.start({ home: empty.home, templates: empty.templates, detectRuntime: async () => null });
    await second.shutdown();
    expect(await testConfiguration(empty.home, (config) => config.settings())).toEqual(before);
  });
});
