import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const rendererConfig = (
  await import(new URL("../vite.renderer.config.mts", import.meta.url))
).default;
const mainConfig = (
  await import(new URL("../vite.main.config.mts", import.meta.url))
).default;
const preloadConfig = (
  await import(new URL("../vite.preload.config.mts", import.meta.url))
).default;

test("Electron runtime bundles use explicit CommonJS extensions", () => {
  assert.equal(packageJson.type, "module");
  assert.equal(packageJson.main, ".vite/build/main.cjs");
  assert.equal(
    mainConfig.build?.rollupOptions?.output?.entryFileNames,
    "[name].cjs",
  );
  assert.equal(
    preloadConfig.build?.rollupOptions?.output?.entryFileNames,
    "[name].cjs",
  );
});

test("the renderer bundle is emitted into Forge's packaged .vite tree", () => {
  assert.equal(
    rendererConfig.build?.outDir,
    fileURLToPath(new URL("../.vite/renderer/main_window", import.meta.url)),
  );
});
