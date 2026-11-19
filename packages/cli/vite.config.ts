import { defineConfig } from "vite";

export default defineConfig({
  build: {
    ssr: "src/index.ts",
    outDir: "out",
    target: "node22",
    rollupOptions: { output: { entryFileNames: "pecore.mjs", banner: "#!/usr/bin/env node" } },
  },
  ssr: { noExternal: true },
});
