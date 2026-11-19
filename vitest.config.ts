import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/schemas", "packages/agents", "packages/engine", "packages/cli", "packages/app"],
  },
});
