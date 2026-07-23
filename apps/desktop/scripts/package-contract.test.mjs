import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "vite";

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
const rendererHtml = await readFile(
  new URL("../src/renderer/index.html", import.meta.url),
  "utf8",
);
const rendererStyles = await readFile(
  new URL("../src/renderer/styles.css", import.meta.url),
  "utf8",
);
const branchCanvasSource = await readFile(
  new URL("../src/renderer/BranchCanvas.tsx", import.meta.url),
  "utf8",
);
const messageBubbleSource = await readFile(
  new URL("../src/renderer/MessageBubble.tsx", import.meta.url),
  "utf8",
);
const rendererMarkdownSource = await readFile(
  new URL("../src/renderer/markdown.ts", import.meta.url),
  "utf8",
);
const desktopIconUrl = new URL(
  "../resources/icons/BranchyChat.icns",
  import.meta.url,
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

test("desktop packaging and runtime surfaces use the supplied Branchy icon", async () => {
  assert.equal(
    forgeConfig.packagerConfig.icon,
    fileURLToPath(desktopIconUrl),
  );
  assert.match(rendererHtml, /rel="icon" href="\/favicon\.ico"/u);
  assert.match(
    mainSource,
    /resources\/icons\/branchy-chat-app-icon\.png/u,
  );
  assert.deepEqual(
    await readFile(desktopIconUrl),
    await readFile(
      new URL(
        "../../../designs/branchy-chat-icons/BranchyChat.icns",
        import.meta.url,
      ),
    ),
  );
});

test("microphone permissions require audio-only access from the trusted renderer", () => {
  assert.match(
    mainSource,
    /setPermissionCheckHandler\([\s\S]*?isAllowedAudioMediaPermission\(/u,
  );
  assert.match(
    mainSource,
    /setPermissionRequestHandler\([\s\S]*?isAllowedAudioMediaPermission\(/u,
  );
  assert.equal(
    mainSource.match(/setPermissionCheckHandler\(/gu)?.length,
    1,
  );
  assert.equal(
    mainSource.match(/setPermissionRequestHandler\(/gu)?.length,
    1,
  );
});

test("branch creation chrome stays neutral without colored rails or shadows", () => {
  assert.doesNotMatch(
    rendererStyles,
    /--branch-tone|--anchor-tone|--branch-highlight-color/u,
  );
  assert.doesNotMatch(
    branchCanvasSource,
    /branchToneForBranch|#f59e0b/u,
  );
  assert.doesNotMatch(
    rendererMarkdownSource,
    /branchToneByKey|branch-highlight-color/u,
  );
  assert.match(
    rendererStyles,
    /\.selection-action\s*\{[^}]*box-shadow:\s*none;/su,
  );
  assert.match(
    rendererStyles,
    /\.branch-card\.is-active\s*\{[^}]*border-color:\s*var\(--foreground\);[^}]*outline:\s*0;/su,
  );
  assert.doesNotMatch(
    rendererStyles,
    /\.branch-card\.is-active\s*\{[^}]*box-shadow:/su,
  );
  assert.match(rendererStyles, /--selection:\s*rgba\(107,\s*114,\s*128,/u);
  assert.match(rendererStyles, /--selection:\s*rgba\(156,\s*163,\s*175,/u);
  assert.match(
    messageBubbleSource,
    /onKeyUp=\{captureSelection\}[\s\S]*onMouseUp=\{captureSelection\}[\s\S]*onTouchEnd=\{captureSelection\}/u,
  );
  assert.match(
    messageBubbleSource,
    /Highlight text to start a focused child branch\./u,
  );
});

test("the production renderer bundles exactly one React runtime", async () => {
  const result = await build({
    ...rendererConfig,
    build: {
      ...rendererConfig.build,
      emptyOutDir: false,
      write: false,
    },
    configFile: false,
    logLevel: "silent",
  });
  const outputs = Array.isArray(result) ? result : [result];
  const code = outputs
    .flatMap((output) => output.output)
    .filter((output) => output.type === "chunk")
    .map((output) => output.code)
    .join("\n");
  const runtimeCount = code.match(/react\.production\.js/gu)?.length ?? 0;

  assert.equal(
    runtimeCount,
    1,
    `Expected one React runtime in the renderer bundle, found ${runtimeCount}`,
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
