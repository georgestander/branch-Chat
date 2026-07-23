import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertReleaseHostReady,
  createMacSigningOptions,
  ensureDmgMakerRuntime,
  finalizeReleaseArtifacts,
  readReleaseConfiguration,
  validateSignedPackage,
} from "./scripts/release-macos.mjs";

const desktopRoot = dirname(fileURLToPath(import.meta.url));
const electronCacheRoot = process.env.BRANCHY_ELECTRON_CACHE;
const releaseConfiguration = readReleaseConfiguration();

function prepareCodexRuntime() {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      process.execPath,
      [resolve(desktopRoot, "scripts/fetch-codex-app-server.mjs")],
      { cwd: desktopRoot, stdio: "inherit" },
    );
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(
        new Error(
          `Codex runtime preparation failed (${signal ?? `exit ${String(code)}`})`,
        ),
      );
    });
  });
}

async function prepareBuildAssets() {
  await assertReleaseHostReady(releaseConfiguration);
  await prepareCodexRuntime();
}

export default {
  packagerConfig: {
    asar: true,
    appBundleId: "com.georgestander.branchychat",
    ...(electronCacheRoot
      ? { download: { cacheRoot: electronCacheRoot } }
      : {}),
    executableName: "Branchy Chat",
    name: "Branchy Chat",
    osxSign: createMacSigningOptions(releaseConfiguration),
    extendInfo: {
      LSApplicationCategoryType: "public.app-category.productivity",
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: false,
      },
      NSMicrophoneUsageDescription:
        "Branchy Chat uses the microphone only while you record dictation.",
    },
    extraResource: [resolve(desktopRoot, "resources/codex")],
  },
  makers: [
    {
      name: "@electron-forge/maker-dmg",
      platforms: ["darwin"],
      config: {
        format: "UDZO",
      },
    },
  ],
  plugins: [
    {
      name: "@electron-forge/plugin-vite",
      config: {
        build: [
          {
            entry: "src/main/main.ts",
            config: "vite.main.config.mts",
          },
          {
            entry: "src/preload.ts",
            config: "vite.preload.config.mts",
          },
        ],
        renderer: [
          {
            name: "main_window",
            config: "vite.renderer.config.mts",
          },
        ],
        concurrent: 2,
      },
    },
  ],
  hooks: {
    generateAssets: prepareBuildAssets,
    preMake: async () => {
      await ensureDmgMakerRuntime();
    },
    ...(releaseConfiguration.enabled
      ? {
          postPackage: async (_forgeConfig, packageResult) => {
            await validateSignedPackage(releaseConfiguration, packageResult, {
              desktopRoot,
            });
          },
          postMake: async (_forgeConfig, makeResults) =>
            finalizeReleaseArtifacts(releaseConfiguration, makeResults),
        }
      : {}),
  },
};
