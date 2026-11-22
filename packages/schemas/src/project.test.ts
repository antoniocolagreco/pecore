import { describe, expect, it } from "vitest";
import { freeProjectManager, Project, projectManagerClash, projectManagers } from "./project";

describe("Project Manager names and colours", () => {
  it("offers twenty distinct names and colours in the table's order", () => {
    expect(projectManagers.map(({ name }) => name)).toEqual([
      "Eva", "Viola", "Mara", "Nora", "Cleo", "Rosa", "Luna", "Zoe", "Ada", "Enya",
      "Ivy", "Olivia", "Jade", "Iris", "Mila", "Ruby", "Lin", "Faye", "Alba", "Mary",
    ]);
    expect(new Set(projectManagers.map(({ color }) => color)).size).toBe(20);
  });

  it("gives the first name and colour not used by another project, and none when all are used", () => {
    expect(freeProjectManager([])).toEqual({ name: "Eva", color: "#FFDE38" });
    expect(freeProjectManager([{ name: "eva", color: "#000000" }, { name: "Custom", color: "#9D57FF" }])).toEqual({ name: "Mara", color: "#2F8E76" });
    expect(freeProjectManager([...projectManagers])).toBeNull();
  });

  it("refuses a name used by another project in any case, or the same colour", () => {
    const used = [{ name: "Eva", color: "#FFDE38" }];
    expect(projectManagerClash({ name: "EVA", color: "#123456" }, used)).toBe("name");
    expect(projectManagerClash({ name: "Kim", color: "#FFDE38" }, used)).toBe("color");
    expect(projectManagerClash({ name: "Kim", color: "#123456" }, used)).toBeNull();
  });

  it("reads a project without a Project Manager, and accepts only a name with an upper-case hex colour", () => {
    const base = { id: "shop", name: "Shop", repo: null };
    expect(Project.parse(base).pm).toBeNull();
    expect(Project.parse({ ...base, pm: { name: "Kim", color: "#12AB34" } }).pm).toEqual({ name: "Kim", color: "#12AB34" });
    for (const pm of [{ name: " ", color: "#12AB34" }, { name: "Kim", color: "#12ab34" }, { name: "Kim", color: "red" }]) {
      expect(Project.safeParse({ ...base, pm }).success).toBe(false);
    }
  });
});
