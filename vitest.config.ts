import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/schemas", "packages/engine"],
  },
});
