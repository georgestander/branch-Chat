import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const desktopRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  base: "./",
  root: resolve(desktopRoot, "src/renderer"),
});
