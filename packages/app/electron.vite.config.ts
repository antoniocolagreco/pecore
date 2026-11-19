import { cp } from "node:fs/promises";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

const workspace = ["@pecore/engine", "@pecore/schemas", "@pecore/agents"];

const copyMigrations = {
  name: "pecore-copy-migrations",
  async writeBundle(options: { dir?: string }) {
    await cp(resolve(import.meta.dirname, "../engine/src/store/migrations"), resolve(options.dir ?? "out/main", "migrations"), { recursive: true });
  },
};

export default defineConfig({
  main: {
    plugins: [copyMigrations],
    build: {
      externalizeDeps: { exclude: workspace },
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, "src/main/index.ts"), engine: resolve(import.meta.dirname, "../engine/src/entry.ts") },
        external: ["better-sqlite3"],
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      isolatedEntries: true,
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, "src/preload/index.ts") },
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, "src/renderer"),
    plugins: [react()],
    build: { rollupOptions: { input: { index: resolve(import.meta.dirname, "src/renderer/index.html") } } },
  },
});
