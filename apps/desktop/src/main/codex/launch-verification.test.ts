import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  verifyPackagedCodexExecutableWithPin,
  verifyPackagedCodexExecutableForLaunch,
} from "./launch-verification.ts";

const codexBytes = Buffer.from("signed codex app-server");
const releasePin = {
  version: "test-version",
  binarySha256: createHash("sha256")
    .update(codexBytes)
    .digest("hex"),
};

async function createFixture(
  manifest: {
    version: string;
    binarySha256: string;
  } = releasePin,
) {
  const root = await mkdtemp(join(tmpdir(), "branchy-codex-verify-"));
  const resourcesPath = join(root, "Resources");
  const executablePath = join(
    resourcesPath,
    "codex",
    "bin",
    "codex-app-server",
  );
  const runtimeRootPath = join(root, "runtime");
  await mkdir(join(resourcesPath, "codex", "bin"), {
    recursive: true,
  });
  await mkdir(runtimeRootPath, { recursive: true });
  await writeFile(
    join(resourcesPath, "codex", "manifest.json"),
    JSON.stringify(manifest),
  );
  await writeFile(executablePath, codexBytes, { mode: 0o700 });
  return {
    root,
    resourcesPath,
    executablePath,
    runtimeRootPath,
  };
}

test("verifies the packaged Codex binary and stages a private launch copy", async (context) => {
  const fixture = await createFixture();
  context.after(async () => {
    await rm(fixture.root, { recursive: true, force: true });
  });

  const calls: Array<[string, string[]]> = [];
  const verifiedPath = await verifyPackagedCodexExecutableWithPin({
    executablePath: fixture.executablePath,
    resourcesPath: fixture.resourcesPath,
    runtimeRootPath: fixture.runtimeRootPath,
    platform: "darwin",
    releasePin,
    runCommand: async (command, args) => {
      calls.push([command, args]);
      if (args.includes("--display")) {
        return {
          stdout: "",
          stderr:
            "Identifier=codex-app-server\n" +
            "Authority=Developer ID Application: OpenAI OpCo, LLC (2DC432GLL2)\n" +
            "TeamIdentifier=2DC432GLL2\n",
        };
      }
      return { stdout: "", stderr: "" };
    },
  });

  assert.equal(
    verifiedPath,
    join(
      fixture.runtimeRootPath,
      "verified-codex-bin",
      "codex-app-server",
    ),
  );
  assert.deepEqual(await readFile(verifiedPath), codexBytes);
  assert.deepEqual(calls, [
    [
      "/usr/bin/codesign",
      ["--verify", "--strict", "--verbose=4", fixture.executablePath],
    ],
    [
      "/usr/bin/codesign",
      ["--display", "--verbose=4", fixture.executablePath],
    ],
  ]);
});

test("rejects a tampered packaged Codex binary before launch", async (context) => {
  const fixture = await createFixture();
  context.after(async () => {
    await rm(fixture.root, { recursive: true, force: true });
  });
  await writeFile(fixture.executablePath, "tampered", { mode: 0o700 });

  await assert.rejects(
    verifyPackagedCodexExecutableWithPin({
      executablePath: fixture.executablePath,
      resourcesPath: fixture.resourcesPath,
      runtimeRootPath: fixture.runtimeRootPath,
      platform: "linux",
      releasePin,
    }),
    /Bundled Codex checksum changed/,
  );
});

test("rejects a symlinked packaged Codex executable", async (context) => {
  const fixture = await createFixture();
  context.after(async () => {
    await rm(fixture.root, { recursive: true, force: true });
  });
  const symlinkTarget = join(fixture.root, "codex-target");
  await writeFile(symlinkTarget, codexBytes, { mode: 0o700 });
  await rm(fixture.executablePath);
  await symlink(symlinkTarget, fixture.executablePath);

  await assert.rejects(
    verifyPackagedCodexExecutableWithPin({
      executablePath: fixture.executablePath,
      resourcesPath: fixture.resourcesPath,
      runtimeRootPath: fixture.runtimeRootPath,
      platform: "linux",
      releasePin,
    }),
    /unsafe Codex file/,
  );
});

test("rejects a packaged manifest that drifts from the utility pin", async (context) => {
  const fixture = await createFixture({
    version: "0.144.5",
    binarySha256: "a".repeat(64),
  });
  context.after(async () => {
    await rm(fixture.root, { recursive: true, force: true });
  });

  await assert.rejects(
    verifyPackagedCodexExecutableForLaunch({
      executablePath: fixture.executablePath,
      resourcesPath: fixture.resourcesPath,
      runtimeRootPath: fixture.runtimeRootPath,
      platform: "linux",
    }),
    /manifest no longer matches the utility-pinned release/,
  );
});

test("rejects a packaged Codex signature with the wrong metadata", async (context) => {
  const fixture = await createFixture();
  context.after(async () => {
    await rm(fixture.root, { recursive: true, force: true });
  });

  await assert.rejects(
    verifyPackagedCodexExecutableWithPin({
      executablePath: fixture.executablePath,
      resourcesPath: fixture.resourcesPath,
      runtimeRootPath: fixture.runtimeRootPath,
      platform: "darwin",
      releasePin,
      runCommand: async (_command, args) => {
        if (args.includes("--display")) {
          return {
            stdout: "",
            stderr:
              "Identifier=codex-app-server\n" +
              "Authority=Developer ID Application: Someone Else (WRONGTEAM)\n" +
              "TeamIdentifier=WRONGTEAM\n",
          };
        }
        return { stdout: "", stderr: "" };
      },
    }),
    /expected OpenAI Developer ID signature/,
  );
});
