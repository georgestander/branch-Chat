import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  assertReleaseHostReady,
  createMacSigningOptions,
  finalizeReleaseArtifacts,
  isBundledCodexBinary,
  readReleaseConfiguration,
  validateSignedPackage,
} from "./release-macos.mjs";

const identity = "Developer ID Application: Branchy Test (ABC1234567)";
const profile = "branchy-notary";
const enabledConfiguration = readReleaseConfiguration({
  BRANCHY_RELEASE: "1",
  BRANCHY_APPLE_SIGNING_IDENTITY: identity,
  BRANCHY_APPLE_NOTARY_PROFILE: profile,
});

test("local QA stays unsigned when release mode is unset", () => {
  assert.deepEqual(readReleaseConfiguration({}), { enabled: false });
  assert.equal(createMacSigningOptions({ enabled: false }), undefined);
});

test("release configuration fails closed on invalid or missing inputs", () => {
  assert.throws(
    () => readReleaseConfiguration({ BRANCHY_RELEASE: "yes" }),
    /must be exactly 1/,
  );
  assert.throws(
    () => readReleaseConfiguration({ BRANCHY_RELEASE: "1" }),
    /BRANCHY_APPLE_SIGNING_IDENTITY.*BRANCHY_APPLE_NOTARY_PROFILE/,
  );
  assert.throws(
    () =>
      readReleaseConfiguration({
        BRANCHY_RELEASE: "1",
        BRANCHY_APPLE_SIGNING_IDENTITY: "Apple Development: Wrong Certificate",
        BRANCHY_APPLE_NOTARY_PROFILE: profile,
      }),
    /full Developer ID Application identity/,
  );
});

test("release signing keeps the pinned Codex executable untouched", () => {
  const options = createMacSigningOptions(enabledConfiguration);
  assert.equal(options.hardenedRuntime, true);
  assert.equal(options.identity, identity);
  assert.equal(
    options.ignore(
      "/tmp/Branchy Chat.app/Contents/Resources/codex/bin/codex-app-server",
    ),
    true,
  );
  assert.equal(
    isBundledCodexBinary(
      "/tmp/Branchy Chat.app/Contents/MacOS/Branchy Chat",
    ),
    false,
  );
});

test("host preflight verifies tools, identity, then notary profile", async () => {
  const calls = [];
  await assertReleaseHostReady(enabledConfiguration, {
    platform: "darwin",
    arch: "arm64",
    run: async (command, args) => {
      calls.push([command, args]);
      if (command === "security") {
        return { stdout: `1) ${identity}\n`, stderr: "" };
      }
      return { stdout: "ok", stderr: "" };
    },
  });
  assert.deepEqual(
    calls.map(([command, args]) => `${command} ${args.join(" ")}`),
    [
      "xcrun --find notarytool",
      "xcrun --find stapler",
      "security find-identity -v -p codesigning",
      `xcrun notarytool history --keychain-profile ${profile} --output-format json`,
    ],
  );
});

test("release rejects the wrong host and missing identity actionably", async () => {
  await assert.rejects(
    assertReleaseHostReady(enabledConfiguration, {
      platform: "darwin",
      arch: "x64",
      run: async () => ({ stdout: "", stderr: "" }),
    }),
    /Apple Silicon macOS host/,
  );
  await assert.rejects(
    assertReleaseHostReady(enabledConfiguration, {
      platform: "darwin",
      arch: "arm64",
      run: async (command) =>
        command === "security"
          ? { stdout: "0 valid identities found", stderr: "" }
          : { stdout: "ok", stderr: "" },
    }),
    /configured signing identity was not found/,
  );
});

test("signed-package validation proves hardened signing and preserves OpenAI Codex bytes", async (context) => {
  const desktopRoot = await mkdtemp(join(tmpdir(), "branchy-release-test-"));
  context.after(() => rm(desktopRoot, { force: true, recursive: true }));
  const packageRoot = join(desktopRoot, "out", "Branchy Chat-darwin-arm64");
  const appRoot = join(packageRoot, "Branchy Chat.app");
  const sourceCodex = join(
    desktopRoot,
    "resources",
    "codex",
    "bin",
    "codex-app-server",
  );
  const packagedCodex = join(
    appRoot,
    "Contents",
    "Resources",
    "codex",
    "bin",
    "codex-app-server",
  );
  const codexBytes = Buffer.from("pinned OpenAI Codex binary");
  const binarySha256 = createHash("sha256")
    .update(codexBytes)
    .digest("hex");
  await Promise.all([
    mkdir(join(desktopRoot, "resources", "codex", "bin"), {
      recursive: true,
    }),
    mkdir(join(appRoot, "Contents", "Resources", "codex", "bin"), {
      recursive: true,
    }),
  ]);
  await Promise.all([
    writeFile(
      join(desktopRoot, "resources", "codex", "manifest.json"),
      JSON.stringify({ binarySha256 }),
    ),
    writeFile(sourceCodex, codexBytes),
    writeFile(packagedCodex, codexBytes),
  ]);

  const run = async (_command, args) => {
    if (args.includes("--display")) {
      const target = args.at(-1);
      if (target === appRoot) {
        return {
          stdout: "",
          stderr: `Authority=${identity}\nflags=0x10000(runtime)\n`,
        };
      }
      return {
        stdout: "",
        stderr:
          "Authority=Developer ID Application: OpenAI OpCo, LLC (2DC432GLL2)\n" +
          "TeamIdentifier=2DC432GLL2\nCDHash=openai-cdhash\n",
      };
    }
    return { stdout: "", stderr: "" };
  };
  const packageResult = {
    platform: "darwin",
    arch: "arm64",
    outputPaths: [packageRoot],
  };
  await validateSignedPackage(enabledConfiguration, packageResult, {
    desktopRoot,
    run,
  });

  await writeFile(packagedCodex, "resigned or changed");
  await assert.rejects(
    validateSignedPackage(enabledConfiguration, packageResult, {
      desktopRoot,
      run,
    }),
    /Bundled Codex checksum changed/,
  );
});

test("post-make release signs, verifies, notarizes, and validates one versioned DMG", async () => {
  const calls = [];
  const notarizeCalls = [];
  const makeResults = [
    {
      platform: "darwin",
      arch: "arm64",
      packageJSON: { version: "1.2.3" },
      artifacts: ["/tmp/Branchy Chat-1.2.3-arm64.dmg"],
    },
  ];
  const result = await finalizeReleaseArtifacts(
    enabledConfiguration,
    makeResults,
    {
      run: async (command, args) => {
        calls.push([command, args]);
        return { stdout: "", stderr: "" };
      },
      notarizeArtifact: async (options) => {
        notarizeCalls.push(options);
      },
    },
  );
  assert.equal(result, makeResults);
  assert.deepEqual(notarizeCalls, [
    {
      appPath: "/tmp/Branchy Chat-1.2.3-arm64.dmg",
      keychainProfile: profile,
      tool: "notarytool",
    },
  ]);
  assert.deepEqual(
    calls.map(([command, args]) => `${command} ${args.join(" ")}`),
    [
      `codesign --force --timestamp --options runtime --sign ${identity} /tmp/Branchy Chat-1.2.3-arm64.dmg`,
      "codesign --verify --strict --verbose=4 /tmp/Branchy Chat-1.2.3-arm64.dmg",
      "xcrun stapler validate -v /tmp/Branchy Chat-1.2.3-arm64.dmg",
      "codesign --verify --strict --verbose=4 /tmp/Branchy Chat-1.2.3-arm64.dmg",
      "spctl --assess --type open --context context:primary-signature --verbose=4 /tmp/Branchy Chat-1.2.3-arm64.dmg",
    ],
  );
});

test("post-make release rejects unsigned-QA artifact names", async () => {
  await assert.rejects(
    finalizeReleaseArtifacts(
      enabledConfiguration,
      [
        {
          platform: "darwin",
          arch: "arm64",
          packageJSON: { version: "1.2.3" },
          artifacts: ["/tmp/Branchy Chat.dmg"],
        },
      ],
      {
        run: async () => ({ stdout: "", stderr: "" }),
        notarizeArtifact: async () => {},
      },
    ),
    /must use a versioned/,
  );
});
