import {
  chmod,
  lstat,
  mkdir,
  realpath,
} from "node:fs/promises";
import { isAbsolute, join, posix, relative, resolve, sep } from "node:path";

import { AssetStoreError } from "./errors.ts";

const ASSET_ID_PATTERN = /^asset_([a-f0-9]{64})$/u;

function isInside(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${sep}`) &&
      relativePath !== ".." &&
      !isAbsolute(relativePath))
  );
}

export function assetIdFromSha256(sha256: string): string {
  if (!/^[a-f0-9]{64}$/u.test(sha256)) {
    throw new AssetStoreError("ASSET_ID_INVALID", "Asset hash is invalid.");
  }
  return `asset_${sha256}`;
}

export function sha256FromAssetId(assetId: string): string {
  const match = ASSET_ID_PATTERN.exec(assetId);
  if (!match) {
    throw new AssetStoreError("ASSET_ID_INVALID", "Asset identifier is invalid.");
  }
  return match[1];
}

export function objectRelativePath(sha256: string, extension: string): string {
  if (
    !/^[a-f0-9]{64}$/u.test(sha256) ||
    !/^[a-z0-9]{1,8}$/u.test(extension)
  ) {
    throw new AssetStoreError("STORE_PATH_INVALID", "Asset path is invalid.");
  }
  return posix.join("objects", sha256.slice(0, 2), `${sha256}.${extension}`);
}

export function recordRelativePath(sha256: string): string {
  if (!/^[a-f0-9]{64}$/u.test(sha256)) {
    throw new AssetStoreError("STORE_PATH_INVALID", "Asset path is invalid.");
  }
  return posix.join("records", `${sha256}.json`);
}

export function resolveAppOwnedPath(
  canonicalRoot: string,
  relativePath: string,
): string {
  if (
    relativePath !== relativePath.normalize("NFC") ||
    relativePath.includes("\\") ||
    relativePath.includes("\0") ||
    posix.isAbsolute(relativePath) ||
    relativePath.split("/").some((segment) => !segment || segment === "..")
  ) {
    throw new AssetStoreError("STORE_PATH_INVALID", "Asset path is invalid.");
  }
  const candidate = resolve(canonicalRoot, ...relativePath.split("/"));
  if (!isInside(canonicalRoot, candidate)) {
    throw new AssetStoreError("STORE_PATH_INVALID", "Asset path escapes storage.");
  }
  return candidate;
}

async function ensurePrivateDirectory(path: string): Promise<string> {
  await mkdir(path, { mode: 0o700, recursive: true });
  const stats = await lstat(path);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new AssetStoreError(
      "STORE_PATH_INVALID",
      "Asset storage must be a real directory.",
    );
  }
  await chmod(path, 0o700);
  return realpath(path);
}

export async function initializeAssetRoot(rootPath: string): Promise<{
  canonicalRoot: string;
  objectsRoot: string;
  recordsRoot: string;
}> {
  if (!isAbsolute(rootPath) || rootPath.includes("\0")) {
    throw new AssetStoreError(
      "STORE_PATH_INVALID",
      "Asset storage path must be absolute.",
    );
  }
  const canonicalRoot = await ensurePrivateDirectory(rootPath);
  const objectsRoot = await ensurePrivateDirectory(join(canonicalRoot, "objects"));
  const recordsRoot = await ensurePrivateDirectory(join(canonicalRoot, "records"));
  if (!isInside(canonicalRoot, objectsRoot) || !isInside(canonicalRoot, recordsRoot)) {
    throw new AssetStoreError("STORE_PATH_INVALID", "Asset storage path escapes.");
  }
  return { canonicalRoot, objectsRoot, recordsRoot };
}

export async function canonicalizeSourceRoot(rootPath: string): Promise<string> {
  if (
    !isAbsolute(rootPath) ||
    rootPath.includes("\0") ||
    rootPath.includes("\\")
  ) {
    throw new AssetStoreError(
      "SOURCE_PATH_INVALID",
      "Generated image source root is invalid.",
    );
  }
  const stats = await lstat(rootPath).catch(() => null);
  if (!stats || stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new AssetStoreError(
      "SOURCE_PATH_INVALID",
      "Generated image source root must be a real directory.",
    );
  }
  return realpath(rootPath);
}

export function isPathInside(root: string, candidate: string): boolean {
  return isInside(root, candidate);
}
