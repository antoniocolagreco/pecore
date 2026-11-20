import { describe, expect, it } from "vitest";
import { jsonSchemas } from "./json-schema";

describe("JSON Schemas", () => {
  it("builds one schema per definition file", () => {
    const schemas = jsonSchemas();
    expect(Object.keys(schemas).sort()).toEqual(["accounts.json", "connector.json", "node.json", "profiles.json", "project.json", "recipe.json", "settings.json", "tiers.json"]);
    for (const s of Object.values(schemas)) expect(JSON.parse(JSON.stringify(s))).toHaveProperty("$schema");
    expect(schemas["project.json"]).toHaveProperty("properties.name");
    expect(schemas["project.json"]).not.toHaveProperty("properties.limits");
  });
});
