import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/schemas", "packages/agents", "packages/engine", "packages/cli", "packages/app"],
    coverage: {
      provider: "v8",
      reportOnFailure: true,
      include: ["packages/*/src/**/*.{ts,tsx}"],
      exclude: [
        "**/*.test.{ts,tsx}",
        "packages/app/src/renderer/ds/**",
        "packages/app/src/renderer/gallery/**",
      ],
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 80 },
    },
  },
});
