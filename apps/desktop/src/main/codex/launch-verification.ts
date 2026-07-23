import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  rename,
} from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CODESIGN_PATH = "/usr/bin/codesign";
const CODEX_TEAM_IDENTIFIER = "2DC432GLL2";
const CODEX_IDENTIFIER = "codex-app-server";
const CODEX_AUTHORITY_LINE =
  "Authority=Developer ID Application: OpenAI OpCo, LLC (2DC432GLL2)";
const VERIFIED_DIRECTORY_MODE = 0o700;
const VERIFIED_EXECUTABLE_MODE = 0o700;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const PINNED_CODEX_RELEASE = Object.freeze({
  version: "0.144.5",
  binarySha256:
    "9cc54a53c8afc64b1db8e8123a8672555411150bafab7b20a2c5ab898112b356",
});

interface CodexManifest {
  version: string;
  binarySha256: string;
}

export interface CodexReleasePin {
  version: string;
  binarySha256: string;
}

interface ExecFileResult {
  stdout: string;
  stderr: string;
}

export interface VerifyPackagedCodexExecutableForLaunchOptions {
  executablePath: string;
  resourcesPath?: string;
  runtimeRootPath: string;
  platform?: NodeJS.Platform;
  runCommand?: (
    command: string,
    args: string[],
  ) => Promise<ExecFileResult>;
}

export interface VerifyPackagedCodexExecutableWithPinOptions
  extends VerifyPackagedCodexExecutableForLaunchOptions {
  releasePin: CodexReleasePin;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function runCommand(
  command: string,
  args: string[],
): Promise<ExecFileResult> {
  const result = await execFileAsync(command, args, {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, {
    recursive: true,
    mode: VERIFIED_DIRECTORY_MODE,
  });
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`Refusing unsafe Codex launch directory: ${path}`);
  }
  await chmod(path, VERIFIED_DIRECTORY_MODE);
}

async function readRegularFileNoFollow(path: string): Promise<Buffer> {
  let handle;
  try {
    handle = await open(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ELOOP"
    ) {
      throw new Error(`Refusing unsafe Codex file: ${path}`);
    }
    throw error;
  }
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) {
      throw new Error(`Refusing unsafe Codex file: ${path}`);
    }
    return Buffer.from(await handle.readFile());
  } finally {
    await handle.close();
  }
}

function metadataOutput(result: ExecFileResult): string {
  return `${result.stdout}\n${result.stderr}`;
}

async function assertManifestParity(
  resourcesPath: string,
  releasePin: CodexReleasePin,
): Promise<void> {
  const manifestPath = join(resourcesPath, "codex", "manifest.json");
  const manifest = JSON.parse(
    (await readRegularFileNoFollow(manifestPath)).toString("utf8"),
  ) as Partial<CodexManifest>;
  if (
    typeof manifest.version !== "string" ||
    manifest.version.length === 0 ||
    typeof manifest.binarySha256 !== "string" ||
    !SHA256_PATTERN.test(manifest.binarySha256)
  ) {
    throw new Error(
      "The packaged Codex manifest must include a valid version and binarySha256.",
    );
  }
  if (
    manifest.version !== releasePin.version ||
    manifest.binarySha256 !== releasePin.binarySha256
  ) {
    throw new Error(
      "The packaged Codex manifest no longer matches the utility-pinned release.",
    );
  }
}

async function verifyMacOsSignature(
  executablePath: string,
  run: VerifyPackagedCodexExecutableForLaunchOptions["runCommand"],
): Promise<void> {
  if (!isAbsolute(executablePath)) {
    throw new Error("Packaged Codex executable path must be absolute");
  }
  const execute = run ?? runCommand;
  await execute(CODESIGN_PATH, [
    "--verify",
    "--strict",
    "--verbose=4",
    executablePath,
  ]);
  const metadata = metadataOutput(
    await execute(CODESIGN_PATH, [
      "--display",
      "--verbose=4",
      executablePath,
    ]),
  );
  if (
    !metadata.includes(`Identifier=${CODEX_IDENTIFIER}`) ||
    !metadata.includes(`TeamIdentifier=${CODEX_TEAM_IDENTIFIER}`) ||
    !metadata.includes(CODEX_AUTHORITY_LINE)
  ) {
    throw new Error(
      `Bundled Codex at ${executablePath} no longer has the expected OpenAI Developer ID signature.`,
    );
  }
}

async function executableMatchesSha(
  path: string,
  expectedSha256: string,
): Promise<boolean> {
  try {
    return sha256(await readRegularFileNoFollow(path)) === expectedSha256;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

async function writeVerifiedExecutable(
  directoryPath: string,
  executablePath: string,
  bytes: Buffer,
): Promise<void> {
  const temporaryPath = join(
    directoryPath,
    `.codex-app-server.${process.pid}.${randomUUID()}.tmp`,
  );
  const handle = await open(
    temporaryPath,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      (constants.O_NOFOLLOW ?? 0),
    VERIFIED_EXECUTABLE_MODE,
  );
  try {
    await handle.writeFile(bytes);
    await handle.chmod(VERIFIED_EXECUTABLE_MODE);
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, executablePath);
  await chmod(executablePath, VERIFIED_EXECUTABLE_MODE);
}

function inferResourcesPath(
  executablePath: string,
  resourcesPath?: string,
): string {
  if (resourcesPath) {
    return resourcesPath;
  }
  return dirname(dirname(dirname(executablePath)));
}

export async function verifyPackagedCodexExecutableWithPin({
  executablePath,
  resourcesPath,
  runtimeRootPath,
  platform = process.platform,
  runCommand: run,
  releasePin,
}: VerifyPackagedCodexExecutableWithPinOptions): Promise<string> {
  const resolvedResourcesPath = inferResourcesPath(
    executablePath,
    resourcesPath,
  );
  await assertManifestParity(resolvedResourcesPath, releasePin);
  const sourceBytes = await readRegularFileNoFollow(executablePath);
  const actualSha256 = sha256(sourceBytes);
  if (actualSha256 !== releasePin.binarySha256) {
    throw new Error(
      `Bundled Codex checksum changed at ${executablePath}; expected ${releasePin.binarySha256}, received ${actualSha256}.`,
    );
  }
  if (platform === "darwin") {
    await verifyMacOsSignature(executablePath, run);
  }

  const stagedDirectoryPath = join(runtimeRootPath, "verified-codex-bin");
  const stagedExecutablePath = join(stagedDirectoryPath, CODEX_IDENTIFIER);
  await ensurePrivateDirectory(stagedDirectoryPath);
  if (
    !(await executableMatchesSha(
      stagedExecutablePath,
      releasePin.binarySha256,
    ))
  ) {
    await writeVerifiedExecutable(
      stagedDirectoryPath,
      stagedExecutablePath,
      sourceBytes,
    );
  }
  if (
    !(await executableMatchesSha(
      stagedExecutablePath,
      releasePin.binarySha256,
    ))
  ) {
    throw new Error(
      `Verified Codex launch binary at ${stagedExecutablePath} does not match the pinned release.`,
    );
  }
  return stagedExecutablePath;
}

export async function verifyPackagedCodexExecutableForLaunch(
  options: VerifyPackagedCodexExecutableForLaunchOptions,
): Promise<string> {
  return verifyPackagedCodexExecutableWithPin({
    ...options,
    releasePin: PINNED_CODEX_RELEASE,
  });
}
