const electronCacheRoot = process.env.BRANCHY_ELECTRON_CACHE;

export default {
  packagerConfig: {
    asar: true,
    appBundleId: "com.georgestander.branchychat",
    ...(electronCacheRoot
      ? { download: { cacheRoot: electronCacheRoot } }
      : {}),
    executableName: "Branchy Chat",
    name: "Branchy Chat",
    extendInfo: {
      LSApplicationCategoryType: "public.app-category.productivity",
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: false,
      },
      NSMicrophoneUsageDescription:
        "Branchy Chat uses the microphone only while you record dictation.",
    },
  },
  makers: [
    {
      name: "@electron-forge/maker-dmg",
      platforms: ["darwin"],
      config: {
        format: "UDZO",
        name: "Branchy Chat",
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
};
