import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const scriptUrl = new URL(
  "../../../scripts/fetch-codex-app-server.mjs",
  import.meta.url,
);
const {
  existingBinaryIsVerified,
  installBinary,
}: {
  existingBinaryIsVerified: (
    manifest: Record<string, unknown>,
    paths: CachePaths,
  ) => Promise<boolean>;
  installBinary: (
    manifest: Record<string, unknown>,
    archiveBytes: Uint8Array,
    options: {
      paths: CachePaths;
      runCommand: () => Promise<void>;
    },
  ) => Promise<void>;
} = await import(scriptUrl.href);

interface CachePaths {
  binaryPath: string;
  receiptPath: string;
  downloadRoot: string;
}

const binaryBytes = Buffer.from("pinned codex app-server");
const binarySha256 = createHash("sha256")
  .update(binaryBytes)
  .digest("hex");

const manifest = {
  version: "test-version",
  archiveName: "codex.tar.gz",
  archiveSha256: "a".repeat(64),
  binarySha256,
  executableName: "codex-app-server",
};

async function createPaths(): Promise<CachePaths> {
  const root = await mkdtemp(join(tmpdir(), "branchy-codex-cache-"));
  const binaryRoot = join(root, "bin");
  await mkdir(binaryRoot);
  return {
    binaryPath: join(binaryRoot, "codex-app-server"),
    receiptPath: join(root, "receipt.json"),
    downloadRoot: join(root, ".download"),
  };
}

async function writeValidCache(paths: CachePaths): Promise<void> {
  await writeFile(paths.binaryPath, binaryBytes);
  await writeFile(
    paths.receiptPath,
    JSON.stringify({
      version: manifest.version,
      archiveSha256: manifest.archiveSha256,
      binarySha256: manifest.binarySha256,
    }),
  );
}

test("accepts a directly verified offline Codex binary cache", async () => {
  const paths = await createPaths();
  await writeValidCache(paths);

  assert.equal(await existingBinaryIsVerified(manifest, paths), true);
});

test("rejects tampered and symlinked binary cache targets", async () => {
  const tamperedPaths = await createPaths();
  await writeValidCache(tamperedPaths);
  await writeFile(tamperedPaths.binaryPath, "tampered");
  assert.equal(
    await existingBinaryIsVerified(manifest, tamperedPaths),
    false,
  );

  const symlinkPaths = await createPaths();
  await writeFile(`${symlinkPaths.binaryPath}.target`, binaryBytes);
  await symlink(
    `${symlinkPaths.binaryPath}.target`,
    symlinkPaths.binaryPath,
  );
  await writeFile(
    symlinkPaths.receiptPath,
    JSON.stringify({
      version: manifest.version,
      archiveSha256: manifest.archiveSha256,
      binarySha256: manifest.binarySha256,
    }),
  );
  assert.equal(
    await existingBinaryIsVerified(manifest, symlinkPaths),
    false,
  );
});

test("rejects a symlinked cache receipt", async () => {
  const paths = await createPaths();
  await writeFile(paths.binaryPath, binaryBytes);
  const receiptTarget = `${paths.receiptPath}.target`;
  await writeFile(
    receiptTarget,
    JSON.stringify({
      version: manifest.version,
      archiveSha256: manifest.archiveSha256,
      binarySha256: manifest.binarySha256,
    }),
  );
  await symlink(receiptTarget, paths.receiptPath);

  assert.equal(await existingBinaryIsVerified(manifest, paths), false);
});

test("verifies the extracted and installed binary against the manifest", async () => {
  const paths = await createPaths();
  await installBinary(manifest, Buffer.from("archive"), {
    paths,
    runCommand: async () => {
      await writeFile(
        join(paths.downloadRoot, manifest.executableName),
        binaryBytes,
      );
    },
  });

  assert.deepEqual(await readFile(paths.binaryPath), binaryBytes);
  assert.equal(await existingBinaryIsVerified(manifest, paths), true);
});

test("rejects a symlinked or checksum-mismatched extracted binary", async () => {
  const symlinkPaths = await createPaths();
  await assert.rejects(
    installBinary(manifest, Buffer.from("archive"), {
      paths: symlinkPaths,
      runCommand: async () => {
        const target = join(symlinkPaths.downloadRoot, "target");
        await writeFile(target, binaryBytes);
        await symlink(
          target,
          join(
            symlinkPaths.downloadRoot,
            manifest.executableName,
          ),
        );
      },
    }),
    /must be a regular file/u,
  );

  const mismatchPaths = await createPaths();
  await assert.rejects(
    installBinary(manifest, Buffer.from("archive"), {
      paths: mismatchPaths,
      runCommand: async () => {
        await writeFile(
          join(
            mismatchPaths.downloadRoot,
            manifest.executableName,
          ),
          "wrong binary",
        );
      },
    }),
    /does not match the pinned release/u,
  );
});
