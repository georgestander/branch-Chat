import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { notarize } from "@electron/notarize";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const CODEX_TEAM_IDENTIFIER = "2DC432GLL2";
const CODEX_AUTHORITY_FRAGMENT = "OpenAI OpCo, LLC";
const QA_ENTITLEMENTS = join(
  dirname(fileURLToPath(import.meta.url)),
  "../resources/entitlements/qa.plist",
);
const QA_HELPER_ENTITLEMENTS = join(
  dirname(fileURLToPath(import.meta.url)),
  "../resources/entitlements/qa-helper.plist",
);
const QA_PLUGIN_ENTITLEMENTS = join(
  dirname(fileURLToPath(import.meta.url)),
  "../resources/entitlements/qa-plugin.plist",
);
const QA_RENDERER_ENTITLEMENTS = join(
  dirname(fileURLToPath(import.meta.url)),
  "../resources/entitlements/qa-renderer.plist",
);
const RELEASE_ENTITLEMENTS = join(
  dirname(fileURLToPath(import.meta.url)),
  "../resources/entitlements/release.plist",
);
const RELEASE_HELPER_ENTITLEMENTS = join(
  dirname(fileURLToPath(import.meta.url)),
  "../resources/entitlements/release-helper.plist",
);
const RELEASE_RENDERER_ENTITLEMENTS = join(
  dirname(fileURLToPath(import.meta.url)),
  "../resources/entitlements/release-renderer.plist",
);
const CODEX_PACKAGED_SUFFIX = [
  "Contents",
  "Resources",
  "codex",
  "bin",
  "codex-app-server",
].join(sep);

function getErrorOutput(error) {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const stdout =
    "stdout" in error && typeof error.stdout === "string" ? error.stdout : "";
  const stderr =
    "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
  return [error.message, stdout, stderr].filter(Boolean).join("\n").trim();
}

async function runCommand(command, args) {
  try {
    return await execFileAsync(command, args, {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error(
      `${command} ${args.join(" ")} failed:\n${getErrorOutput(error)}`,
      { cause: error },
    );
  }
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDmgMakerRuntime({
  platform = process.platform,
  resolveModule = require.resolve,
} = {}) {
  if (platform !== "darwin") {
    throw new Error("The Branchy Chat DMG can only be made on macOS.");
  }

  const nativeModules = [
    ["macos-alias", "volume.node"],
    ["fs-xattr", "xattr.node"],
  ];
  const nodeGypPath = resolveModule("@electron/node-gyp/bin/node-gyp.js");
  for (const [packageName, outputName] of nativeModules) {
    const packageRoot = dirname(resolveModule(`${packageName}/package.json`));
    const outputPath = join(packageRoot, "build", "Release", outputName);
    if (await pathExists(outputPath)) {
      continue;
    }

    console.log(`[branchy-build] Preparing DMG dependency ${packageName}`);
    try {
      const buildEnvironment = Object.fromEntries(
        [
          ["PATH", process.env.PATH],
          ["HOME", process.env.HOME],
          ["TMPDIR", process.env.TMPDIR],
          ["DEVELOPER_DIR", process.env.DEVELOPER_DIR],
          ["SDKROOT", process.env.SDKROOT],
          ["npm_config_loglevel", "error"],
        ].filter((entry) => typeof entry[1] === "string"),
      );
      await execFileAsync(process.execPath, [nodeGypPath, "rebuild"], {
        cwd: packageRoot,
        encoding: "utf8",
        env: buildEnvironment,
        maxBuffer: 8 * 1024 * 1024,
      });
    } catch (error) {
      throw new Error(
        `Unable to build the ${packageName} DMG helper. Install current Xcode command-line tools, run pnpm install, and retry.`,
        { cause: error },
      );
    }
    if (!(await pathExists(outputPath))) {
      throw new Error(
        `${packageName} finished building without producing ${outputName}.`,
      );
    }
  }
}

function requireNonEmpty(environment, name, missing) {
  const value = environment[name]?.trim();
  if (!value) {
    missing.push(name);
  }
  return value ?? "";
}

export function readReleaseConfiguration(environment = process.env) {
  const releaseValue = environment.BRANCHY_RELEASE;
  if (
    releaseValue !== undefined &&
    releaseValue !== "0" &&
    releaseValue !== "1"
  ) {
    throw new Error(
      "BRANCHY_RELEASE must be exactly 1 for a release or 0/unset for local QA.",
    );
  }

  if (releaseValue !== "1") {
    return Object.freeze({ enabled: false });
  }

  const missing = [];
  const signingIdentity = requireNonEmpty(
    environment,
    "BRANCHY_APPLE_SIGNING_IDENTITY",
    missing,
  );
  const notaryProfile = requireNonEmpty(
    environment,
    "BRANCHY_APPLE_NOTARY_PROFILE",
    missing,
  );
  if (missing.length > 0) {
    throw new Error(
      `BRANCHY_RELEASE=1 requires ${missing.join(" and ")}. ` +
        "Use a Developer ID Application certificate and a notarytool Keychain profile; do not put Apple credentials in the repository.",
    );
  }
  if (!/^Developer ID Application: .+ \([A-Z0-9]+\)$/.test(signingIdentity)) {
    throw new Error(
      "BRANCHY_APPLE_SIGNING_IDENTITY must be the full Developer ID Application identity, including its Team ID.",
    );
  }

  return Object.freeze({
    enabled: true,
    signingIdentity,
    notaryProfile,
  });
}

export function isBundledCodexBinary(filePath) {
  return normalize(filePath).endsWith(CODEX_PACKAGED_SUFFIX);
}

export function createMacSigningOptions(releaseConfiguration) {
  if (!releaseConfiguration.enabled) {
    return {
      identity: "-",
      identityValidation: false,
      // The ad-hoc app and nested Electron framework have no shared Team ID.
      // Keep the hardened runtime, but grant only executable app bundles the
      // documented exception required to load Electron Framework in local QA.
      optionsForFile: (filePath) => ({
        ...(isAppBundle(filePath)
          ? {
              entitlements: isPluginAppBundle(filePath)
                ? QA_PLUGIN_ENTITLEMENTS
                : isRendererAppBundle(filePath)
                  ? QA_RENDERER_ENTITLEMENTS
                  : isNestedAppBundle(filePath)
                    ? QA_HELPER_ENTITLEMENTS
                    : QA_ENTITLEMENTS,
            }
          : {}),
        hardenedRuntime: true,
        timestamp: "none",
      }),
      preAutoEntitlements: false,
      preEmbedProvisioningProfile: false,
      ignore: isBundledCodexBinary,
    };
  }
  return {
    identity: releaseConfiguration.signingIdentity,
    identityValidation: true,
    optionsForFile: (filePath) => ({
      ...(isAppBundle(filePath) &&
      !isPluginAppBundle(filePath) &&
      !isGpuAppBundle(filePath)
        ? {
            entitlements: isRendererAppBundle(filePath)
              ? RELEASE_RENDERER_ENTITLEMENTS
              : isNestedAppBundle(filePath)
                ? RELEASE_HELPER_ENTITLEMENTS
                : RELEASE_ENTITLEMENTS,
          }
        : {}),
      hardenedRuntime: true,
    }),
    ignore: isBundledCodexBinary,
  };
}

function isAppBundle(filePath) {
  return normalize(filePath).endsWith(".app");
}

function isNestedAppBundle(filePath) {
  return normalize(filePath).includes(`.app${sep}`);
}

function isPluginAppBundle(filePath) {
  return normalize(filePath).endsWith("(Plugin).app");
}

function isGpuAppBundle(filePath) {
  return normalize(filePath).endsWith("(GPU).app");
}

function isRendererAppBundle(filePath) {
  return normalize(filePath).endsWith("(Renderer).app");
}

export async function assertReleaseHostReady(
  releaseConfiguration,
  {
    platform = process.platform,
    arch = process.arch,
    run = runCommand,
  } = {},
) {
  if (!releaseConfiguration.enabled) {
    return;
  }
  if (platform !== "darwin" || arch !== "arm64") {
    throw new Error(
      `Branchy Chat releases require an Apple Silicon macOS host; found ${platform}/${arch}.`,
    );
  }

  try {
    await run("xcrun", ["--find", "notarytool"]);
    await run("xcrun", ["--find", "stapler"]);
  } catch (error) {
    throw new Error(
      "Apple notarization tools are unavailable. Install current Xcode command-line tools and select them with xcode-select before releasing.",
      { cause: error },
    );
  }

  let identities;
  try {
    identities = await run("security", [
      "find-identity",
      "-v",
      "-p",
      "codesigning",
    ]);
  } catch (error) {
    throw new Error(
      "Unable to inspect the macOS signing keychain. Unlock the keychain and confirm the Developer ID certificate is installed.",
      { cause: error },
    );
  }
  const identityOutput = `${identities.stdout ?? ""}\n${identities.stderr ?? ""}`;
  if (!identityOutput.includes(releaseConfiguration.signingIdentity)) {
    throw new Error(
      `The configured signing identity was not found in the active keychain: ${releaseConfiguration.signingIdentity}. ` +
        "Install its Developer ID Application certificate and private key, or correct BRANCHY_APPLE_SIGNING_IDENTITY.",
    );
  }

  try {
    await run("xcrun", [
      "notarytool",
      "history",
      "--keychain-profile",
      releaseConfiguration.notaryProfile,
      "--output-format",
      "json",
    ]);
  } catch (error) {
    throw new Error(
      `The notarytool Keychain profile "${releaseConfiguration.notaryProfile}" could not authenticate. ` +
        "Create or repair it with xcrun notarytool store-credentials, then retry.",
      { cause: error },
    );
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function signatureMetadata(result) {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

async function verifyCodexSignature(path, expectedSha256, run) {
  const bytes = await readFile(path);
  const actualSha256 = sha256(bytes);
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `Bundled Codex checksum changed at ${path}; expected ${expectedSha256}, received ${actualSha256}.`,
    );
  }

  await run("codesign", ["--verify", "--strict", "--verbose=4", path]);
  const metadata = signatureMetadata(
    await run("codesign", ["--display", "--verbose=4", path]),
  );
  if (
    !metadata.includes(`TeamIdentifier=${CODEX_TEAM_IDENTIFIER}`) ||
    !metadata.includes(CODEX_AUTHORITY_FRAGMENT)
  ) {
    throw new Error(
      `Bundled Codex at ${path} no longer has the expected OpenAI Developer ID signature.`,
    );
  }
  return metadata;
}

export async function validateSignedPackage(
  releaseConfiguration,
  packageResult,
  { desktopRoot, run = runCommand } = {},
) {
  if (!releaseConfiguration.enabled) {
    return;
  }
  if (packageResult.platform !== "darwin" || packageResult.arch !== "arm64") {
    throw new Error(
      `Release packaging only supports darwin/arm64; received ${packageResult.platform}/${packageResult.arch}.`,
    );
  }
  if (!desktopRoot) {
    throw new Error("Desktop root is required to validate the release package.");
  }
  if (packageResult.outputPaths.length !== 1) {
    throw new Error(
      `Expected one packaged application, received ${packageResult.outputPaths.length}.`,
    );
  }

  const appPath = join(packageResult.outputPaths[0], "Branchy Chat.app");
  await run("codesign", [
    "--verify",
    "--deep",
    "--strict",
    "--verbose=4",
    appPath,
  ]);
  const appMetadata = signatureMetadata(
    await run("codesign", ["--display", "--verbose=4", appPath]),
  );
  if (!appMetadata.includes(`Authority=${releaseConfiguration.signingIdentity}`)) {
    throw new Error(
      "The packaged app is not signed by BRANCHY_APPLE_SIGNING_IDENTITY.",
    );
  }
  if (!/flags=0x[0-9a-f]+\(runtime\)/i.test(appMetadata)) {
    throw new Error("The packaged app is missing the hardened runtime flag.");
  }

  const manifest = JSON.parse(
    await readFile(
      join(desktopRoot, "resources", "codex", "manifest.json"),
      "utf8",
    ),
  );
  if (
    typeof manifest.binarySha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(manifest.binarySha256)
  ) {
    throw new Error("The pinned Codex manifest has an invalid binarySha256.");
  }

  const sourceCodexPath = join(
    desktopRoot,
    "resources",
    "codex",
    "bin",
    "codex-app-server",
  );
  const packagedCodexPath = join(
    appPath,
    "Contents",
    "Resources",
    "codex",
    "bin",
    "codex-app-server",
  );
  const sourceMetadata = await verifyCodexSignature(
    sourceCodexPath,
    manifest.binarySha256,
    run,
  );
  const packagedMetadata = await verifyCodexSignature(
    packagedCodexPath,
    manifest.binarySha256,
    run,
  );
  const sourceCdHash = sourceMetadata.match(/^CDHash=(.+)$/m)?.[1];
  const packagedCdHash = packagedMetadata.match(/^CDHash=(.+)$/m)?.[1];
  if (!sourceCdHash || sourceCdHash !== packagedCdHash) {
    throw new Error(
      "The packaged Codex signature does not match the pinned OpenAI-signed binary.",
    );
  }
}

export async function finalizeReleaseArtifacts(
  releaseConfiguration,
  makeResults,
  { run = runCommand, notarizeArtifact = notarize } = {},
) {
  if (!releaseConfiguration.enabled) {
    return makeResults;
  }

  const artifacts = makeResults.flatMap((result) => {
    if (result.platform !== "darwin" || result.arch !== "arm64") {
      throw new Error(
        `Release artifacts only support darwin/arm64; received ${result.platform}/${result.arch}.`,
      );
    }
    const version = result.packageJSON?.version;
    if (typeof version !== "string" || version.length === 0) {
      throw new Error("Release artifact is missing its package version.");
    }
    return result.artifacts.map((artifactPath) => {
      const expectedSuffix = `-${version}-arm64.dmg`;
      if (
        !artifactPath.endsWith(".dmg") ||
        !basename(artifactPath).endsWith(expectedSuffix)
      ) {
        throw new Error(
          `Release DMG must use a versioned *${expectedSuffix} filename; received ${basename(artifactPath)}.`,
        );
      }
      return artifactPath;
    });
  });
  if (artifacts.length !== 1) {
    throw new Error(
      `Expected exactly one Apple Silicon release DMG, received ${artifacts.length}.`,
    );
  }

  const dmgPath = artifacts[0];
  console.log(`[branchy-release] Signing ${basename(dmgPath)}`);
  await run("codesign", [
    "--force",
    "--timestamp",
    "--options",
    "runtime",
    "--sign",
    releaseConfiguration.signingIdentity,
    dmgPath,
  ]);
  await run("codesign", ["--verify", "--strict", "--verbose=4", dmgPath]);

  console.log(
    `[branchy-release] Notarizing and stapling ${basename(dmgPath)} with Keychain profile "${releaseConfiguration.notaryProfile}"`,
  );
  await notarizeArtifact({
    appPath: dmgPath,
    keychainProfile: releaseConfiguration.notaryProfile,
    tool: "notarytool",
  });

  await run("xcrun", ["stapler", "validate", "-v", dmgPath]);
  await run("codesign", ["--verify", "--strict", "--verbose=4", dmgPath]);
  await run("spctl", [
    "--assess",
    "--type",
    "open",
    "--context",
    "context:primary-signature",
    "--verbose=4",
    dmgPath,
  ]);
  console.log(`[branchy-release] Validated ${basename(dmgPath)}`);
  return makeResults;
}
