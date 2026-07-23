import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const resourceRoot = join(desktopRoot, "resources", "codex");
const manifestPath = join(resourceRoot, "manifest.json");
const binaryPath = join(resourceRoot, "bin", "codex-app-server");
const receiptPath = join(resourceRoot, "receipt.json");
const downloadRoot = join(resourceRoot, ".download");

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function defaultPaths() {
  return {
    binaryPath,
    receiptPath,
    downloadRoot,
  };
}

async function readRegularFileNoFollow(path, label) {
  const pathStats = await lstat(path);
  if (!pathStats.isFile() || pathStats.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file`);
  }

  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const handleStats = await handle.stat();
    if (!handleStats.isFile()) {
      throw new Error(`${label} must be a regular file`);
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

async function readJsonNoFollow(path, label) {
  const bytes = await readRegularFileNoFollow(path, label);
  return JSON.parse(bytes.toString("utf8"));
}

function validateManifest(manifest) {
  const shaPattern = /^[a-f0-9]{64}$/u;
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    typeof manifest.version !== "string" ||
    typeof manifest.archiveSha256 !== "string" ||
    !shaPattern.test(manifest.archiveSha256) ||
    typeof manifest.binarySha256 !== "string" ||
    !shaPattern.test(manifest.binarySha256)
  ) {
    throw new Error(
      "Codex manifest must pin valid archive and binary SHA-256 values",
    );
  }
  return manifest;
}

export async function existingBinaryIsVerified(
  manifestInput,
  paths = defaultPaths(),
) {
  const manifest = validateManifest(manifestInput);
  try {
    const [receipt, binaryBytes] = await Promise.all([
      readJsonNoFollow(paths.receiptPath, "Codex cache receipt"),
      readRegularFileNoFollow(paths.binaryPath, "Cached Codex binary"),
    ]);
    const binarySha256 = sha256(binaryBytes);
    return (
      receipt.version === manifest.version &&
      receipt.archiveSha256 === manifest.archiveSha256 &&
      receipt.binarySha256 === manifest.binarySha256 &&
      binarySha256 === manifest.binarySha256
    );
  } catch {
    return false;
  }
}

async function run(command, args) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(
        new Error(`${command} failed (${signal ?? `exit ${String(code)}`})`),
      );
    });
  });
}

export async function downloadAndVerify(manifestInput) {
  const manifest = validateManifest(manifestInput);
  const response = await fetch(manifest.downloadUrl, {
    redirect: "follow",
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new Error(`Codex download failed with HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength !== manifest.archiveSize) {
    throw new Error(
      `Codex archive size ${bytes.byteLength} does not match ${manifest.archiveSize}`,
    );
  }
  const archiveSha256 = sha256(bytes);
  if (archiveSha256 !== manifest.archiveSha256) {
    throw new Error(
      `Codex archive checksum ${archiveSha256} does not match the pinned release`,
    );
  }
  return bytes;
}

async function writeRegularFileAtomic(path, bytes, mode) {
  const nextPath = `${path}.next`;
  await rm(nextPath, { force: true });
  const handle = await open(
    nextPath,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      (constants.O_NOFOLLOW ?? 0),
    mode,
  );
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(nextPath, path);
}

export async function installBinary(
  manifestInput,
  archiveBytes,
  {
    paths = defaultPaths(),
    runCommand = run,
  } = {},
) {
  const manifest = validateManifest(manifestInput);
  await rm(paths.downloadRoot, { recursive: true, force: true });
  await mkdir(paths.downloadRoot, { recursive: true, mode: 0o700 });
  const archivePath = join(paths.downloadRoot, manifest.archiveName);
  await writeFile(archivePath, archiveBytes, { mode: 0o600 });
  await runCommand("tar", [
    "-xzf",
    archivePath,
    "-C",
    paths.downloadRoot,
  ]);

  const extractedPath = join(paths.downloadRoot, manifest.executableName);
  const binaryBytes = await readRegularFileNoFollow(
    extractedPath,
    "Extracted Codex binary",
  );
  const extractedSha256 = sha256(binaryBytes);
  if (extractedSha256 !== manifest.binarySha256) {
    throw new Error(
      `Codex binary checksum ${extractedSha256} does not match the pinned release`,
    );
  }

  await mkdir(dirname(paths.binaryPath), { recursive: true, mode: 0o755 });
  await writeRegularFileAtomic(paths.binaryPath, binaryBytes, 0o755);
  const installedBytes = await readRegularFileNoFollow(
    paths.binaryPath,
    "Installed Codex binary",
  );
  if (sha256(installedBytes) !== manifest.binarySha256) {
    throw new Error("Installed Codex binary failed checksum verification");
  }

  await writeRegularFileAtomic(
    paths.receiptPath,
    `${JSON.stringify(
      {
        version: manifest.version,
        archiveSha256: manifest.archiveSha256,
        binarySha256: manifest.binarySha256,
      },
      null,
      2,
    )}\n`,
    0o600,
  );
  await rm(paths.downloadRoot, { recursive: true, force: true });
}

export async function main() {
  const manifest = validateManifest(await readJson(manifestPath));
  if (!(await existingBinaryIsVerified(manifest))) {
    console.log(
      `[branchy] downloading pinned Codex app-server ${manifest.version}`,
    );
    const archiveBytes = await downloadAndVerify(manifest);
    await installBinary(manifest, archiveBytes);
  }

  console.log(`[branchy] Codex app-server ${manifest.version} is ready`);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1]
) {
  await main();
}
