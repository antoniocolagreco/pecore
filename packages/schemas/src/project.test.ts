import { describe, expect, it } from "vitest";
import { freeProjectManager, Project, projectManagerClash, ProjectManagerIdentity, projectManagers } from "./project";

describe("Project Manager names and colours", () => {
  it("offers the twenty-four palette colours with their names, in the palette's order", () => {
    expect(projectManagers).toEqual([
      { name: "Chris", color: "#DC2626" }, { name: "Amber", color: "#F97316" }, { name: "Aura", color: "#FBBF24" }, { name: "Liam", color: "#84CC16" },
      { name: "Greta", color: "#16A34A" }, { name: "Talia", color: "#14B8A6" }, { name: "Azra", color: "#0EA5E9" }, { name: "Cole", color: "#1D4ED8" },
      { name: "Coral", color: "#F87171" }, { name: "Penny", color: "#FDBA74" }, { name: "Lena", color: "#FEF08A" }, { name: "Mina", color: "#6EE7B7" },
      { name: "Aki", color: "#67E8F9" }, { name: "Elsa", color: "#BAE6FD" }, { name: "Lavinia", color: "#C4B5FD" }, { name: "Rosie", color: "#F9A8D4" },
      { name: "Bree", color: "#9F1239" }, { name: "Cora", color: "#92400E" }, { name: "Olive", color: "#3F6212" }, { name: "Forrest", color: "#065F46" },
      { name: "Sloane", color: "#64748B" }, { name: "Indra", color: "#6366F1" }, { name: "Violet", color: "#7E22CE" }, { name: "Magda", color: "#D946EF" },
    ]);
    expect(new Set(projectManagers.map(({ name }) => name.toLowerCase())).size).toBe(24);
    expect(new Set(projectManagers.map(({ color }) => color)).size).toBe(24);
    for (const { color } of projectManagers) expect(ProjectManagerIdentity.shape.color.safeParse(color).success).toBe(true);
  });

  it("gives the first name and colour not used by another project, and none when all are used", () => {
    expect(freeProjectManager([])).toEqual({ name: "Chris", color: "#DC2626" });
    expect(freeProjectManager([{ name: "chris", color: "#000000" }, { name: "Custom", color: "#F97316" }])).toEqual({ name: "Aura", color: "#FBBF24" });
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
