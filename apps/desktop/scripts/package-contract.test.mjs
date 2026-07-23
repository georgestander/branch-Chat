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
const forgeConfig = (
  await import(new URL("../forge.config.mjs", import.meta.url))
).default;
const mainSource = await readFile(
  new URL("../src/main/main.ts", import.meta.url),
  "utf8",
);

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

test("the Codex utility process has an explicit packaged bundle", () => {
  const vitePlugin = forgeConfig.plugins.find(
    (plugin) => plugin.name === "@electron-forge/plugin-vite",
  );
  const utilityBuild = vitePlugin?.config?.build?.find(
    (build) => build.entry === "src/main/codex/utility-entry.ts",
  );
  assert.deepEqual(utilityBuild, {
    entry: "src/main/codex/utility-entry.ts",
    config: "vite.main.config.mts",
  });
  assert.match(mainSource, /"utility-entry\.cjs"/u);
  assert.equal(
    mainConfig.build?.rollupOptions?.output?.entryFileNames,
    "[name].cjs",
  );
});
