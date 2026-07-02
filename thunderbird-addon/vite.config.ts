import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { cpSync } from "node:fs";

const root = resolve(__dirname); // thunderbird-addon/
const outDir = resolve(__dirname, "../dist-addon");

/** Copies manifest.json, icons, and sql.js's wasm binary alongside the build
 *  output -- none of these go through Rollup's module graph. */
function copyStaticAssets() {
  return {
    name: "copy-addon-static-assets",
    closeBundle() {
      cpSync(resolve(__dirname, "manifest.json"), resolve(outDir, "manifest.json"));
      cpSync(resolve(__dirname, "icons"), resolve(outDir, "icons"), { recursive: true });
      cpSync(resolve(__dirname, "../node_modules/sql.js/dist/sql-wasm.wasm"), resolve(outDir, "sql-wasm.wasm"));
    }
  };
}

export default defineConfig({
  root,
  base: "./",
  plugins: [react(), copyStaticAssets()],
  build: {
    outDir,
    emptyOutDir: true,
    target: "firefox128", // Thunderbird 128+ is Firefox-ESR-based; matches manifest.json's strict_min_version
    rollupOptions: {
      input: {
        tab: resolve(root, "tab/index.html"),
        background: resolve(root, "background/index.ts")
      },
      output: {
        // Keep the background bundle at a fixed, predictable path since
        // manifest.json's background.scripts references it by name.
        entryFileNames: (chunk) => (chunk.name === "background" ? "background/index.js" : "assets/[name]-[hash].js")
      }
    }
  },
  server: {
    port: 5174,
    strictPort: true
  }
});
