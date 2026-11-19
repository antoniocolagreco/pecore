import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { checkCompose, checkPrerequisites } from "./prerequisites";

function has(argv: string[]): boolean {
  try {
    execFileSync(argv[0]!, argv.slice(1), { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("prerequisites (decision 12)", () => {
  it("checks only git when no feature needs more", async () => {
    const found = await checkPrerequisites();
    expect(found.map((p) => p.tool)).toEqual(["git"]);
    expect(found[0]).toMatchObject({ ok: true, problem: null });
    expect(found[0]!.version).toMatch(/^\d+\.\d+/);
  });

  it("adds sudo and setfacl for protected mode and the forge tool of each account", async () => {
    const found = await checkPrerequisites({
      protectedMode: true,
      accounts: [{ id: "work", kind: "forge", forge: "gitlab", tool: "glab", host: "gitlab.example.com", user: "ann", author: { name: "Ann", email: "ann@example.com" } }],
    });
    expect(found.map((p) => p.tool).sort()).toEqual(["git", "glab", "setfacl", "sudo"]);
  });

  it("reports Compose without a runtime as a problem", async () => {
    expect(await checkCompose(null)).toMatchObject({ tool: "compose", ok: false, problem: "Set servicesRuntime before using Compose" });
  });

  it.skipIf(!has(["docker", "compose", "version"]))("accepts Compose v2 or later", async () => {
    expect(await checkCompose("docker")).toMatchObject({ tool: "compose", ok: true, problem: null });
  });
});
