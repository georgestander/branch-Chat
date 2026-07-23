import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const desktopRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  base: "./",
  build: {
    // Forge's default outDir is relative to Vite's root. Because this renderer
    // uses src/renderer as its root, keep the output explicitly inside the
    // project-level .vite directory that Forge packages into app.asar.
    outDir: resolve(desktopRoot, ".vite/renderer/main_window"),
  },
  plugins: [react()],
  resolve: {
    // Transitive renderer dependencies are hoisted to the workspace root,
    // which also hosts the legacy web app's React version. Keep every hook
    // caller on the desktop package's React dispatcher.
    dedupe: ["react", "react-dom"],
  },
  root: resolve(desktopRoot, "src/renderer"),
});
