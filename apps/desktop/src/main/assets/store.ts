import { createHash, randomUUID } from "node:crypto";
import {
  constants,
  type Stats,
} from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  realpath,
  stat,
  unlink,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";

import { AssetStoreError } from "./errors.ts";
import {
  safeDownloadFilename,
  validateAttachmentFilename,
} from "./filename.ts";
import {
  ATTACHMENT_MAX_BYTES,
  GENERATED_IMAGE_MAX_BYTES,
  canonicalExtensionForMimeType,
  inspectAssetContent,
  normalizeDeclaredMimeType,
  type SupportedAssetMimeType,
} from "./mime.ts";
import {
  assetIdFromSha256,
  canonicalizeSourceRoot,
  initializeAssetRoot,
  isPathInside,
  objectRelativePath,
  recordRelativePath,
  resolveAppOwnedPath,
  sha256FromAssetId,
} from "./paths.ts";

const MAX_RECORD_BYTES = 16 * 1024;
const RECORD_SCHEMA_VERSION = 1;

export type AssetSource = "attachment" | "generated-image";

export interface StoredAsset {
  assetId: string;
  byteLength: number;
  createdAt: string;
  mimeType: SupportedAssetMimeType;
  originalName: string;
  relativePath: string;
  sha256: string;
  source: AssetSource;
}

export interface AssetDownloadMetadata {
  assetId: string;
  byteLength: number;
  mimeType: SupportedAssetMimeType;
  suggestedFilename: string;
}

export interface ResolvedAssetFile {
  absolutePath: string;
  asset: StoredAsset;
}

export interface AssetStoreOptions {
  attachmentMaxBytes?: number;
  generatedImageMaxBytes?: number;
  generatedImageSourceRoots?: readonly string[];
  now?: () => Date;
  rootPath: string;
}

interface StoredAssetRecord extends StoredAsset {
  schemaVersion: typeof RECORD_SCHEMA_VERSION;
}

function validatePositiveByteLimit(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseStoredAssetRecord(
  value: unknown,
  expectedSha256: string,
): StoredAssetRecord {
  const record = asRecord(value);
  if (
    !record ||
    record.schemaVersion !== RECORD_SCHEMA_VERSION ||
    record.assetId !== assetIdFromSha256(expectedSha256) ||
    record.sha256 !== expectedSha256 ||
    typeof record.byteLength !== "number" ||
    !Number.isSafeInteger(record.byteLength) ||
    record.byteLength <= 0 ||
    typeof record.createdAt !== "string" ||
    !Number.isFinite(Date.parse(record.createdAt)) ||
    typeof record.mimeType !== "string" ||
    typeof record.originalName !== "string" ||
    typeof record.relativePath !== "string" ||
    (record.source !== "attachment" && record.source !== "generated-image")
  ) {
    throw new AssetStoreError("ASSET_CORRUPT", "Asset metadata is invalid.");
  }

  let mimeType: SupportedAssetMimeType;
  try {
    mimeType = normalizeDeclaredMimeType(record.mimeType);
  } catch (error) {
    throw new AssetStoreError("ASSET_CORRUPT", "Asset metadata is invalid.", {
      cause: error,
    });
  }
  const expectedRelativePath = objectRelativePath(
    expectedSha256,
    canonicalExtensionForMimeType(mimeType),
  );
  if (record.relativePath !== expectedRelativePath) {
    throw new AssetStoreError("ASSET_CORRUPT", "Asset metadata path is invalid.");
  }
  try {
    if (
      validateAttachmentFilename(record.originalName, mimeType) !==
      record.originalName
    ) {
      throw new Error("non-canonical filename");
    }
  } catch (error) {
    throw new AssetStoreError(
      "ASSET_CORRUPT",
      "Asset metadata file name is invalid.",
      { cause: error },
    );
  }

  return {
    assetId: record.assetId as string,
    byteLength: record.byteLength,
    createdAt: record.createdAt,
    mimeType,
    originalName: record.originalName,
    relativePath: record.relativePath,
    schemaVersion: RECORD_SCHEMA_VERSION,
    sha256: expectedSha256,
    source: record.source,
  };
}

async function readNoFollow(path: string, maxBytes: number): Promise<Buffer> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new AssetStoreError("ASSET_NOT_FOUND", "Asset was not found.");
    }
    throw new AssetStoreError("ASSET_CORRUPT", "Asset file cannot be opened.", {
      cause: error,
    });
  }
  try {
    const stats = await handle.stat();
    if (
      !stats.isFile() ||
      stats.nlink !== 1 ||
      stats.size <= 0 ||
      stats.size > maxBytes
    ) {
      throw new AssetStoreError("ASSET_CORRUPT", "Asset file is invalid.");
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

async function writeExclusiveAtomically(
  targetPath: string,
  bytes: Uint8Array,
): Promise<boolean> {
  const directory = dirname(targetPath);
  await mkdir(directory, { mode: 0o700, recursive: true });
  const directoryStats = await lstat(directory);
  if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
    throw new AssetStoreError("STORE_PATH_INVALID", "Asset directory is invalid.");
  }

  const temporaryPath = join(directory, `.${randomUUID()}.tmp`);
  const handle = await open(
    temporaryPath,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    0o600,
  );
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await link(temporaryPath, targetPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return false;
    }
    throw error;
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

function publicAsset(record: StoredAssetRecord): StoredAsset {
  const { schemaVersion: _schemaVersion, ...asset } = record;
  return asset;
}

export class AssetStore {
  readonly rootPath: string;
  readonly generatedImageSourceRoots: readonly string[];
  readonly attachmentMaxBytes: number;
  readonly generatedImageMaxBytes: number;

  private readonly now: () => Date;

  private constructor(options: {
    attachmentMaxBytes: number;
    generatedImageMaxBytes: number;
    generatedImageSourceRoots: readonly string[];
    now: () => Date;
    rootPath: string;
  }) {
    this.rootPath = options.rootPath;
    this.generatedImageSourceRoots = options.generatedImageSourceRoots;
    this.attachmentMaxBytes = options.attachmentMaxBytes;
    this.generatedImageMaxBytes = options.generatedImageMaxBytes;
    this.now = options.now;
  }

  static async open(options: AssetStoreOptions): Promise<AssetStore> {
    const roots = await initializeAssetRoot(options.rootPath);
    const generatedImageSourceRoots = await Promise.all(
      (options.generatedImageSourceRoots ?? []).map(canonicalizeSourceRoot),
    );
    return new AssetStore({
      attachmentMaxBytes: validatePositiveByteLimit(
        options.attachmentMaxBytes ?? ATTACHMENT_MAX_BYTES,
        "attachmentMaxBytes",
      ),
      generatedImageMaxBytes: validatePositiveByteLimit(
        options.generatedImageMaxBytes ?? GENERATED_IMAGE_MAX_BYTES,
        "generatedImageMaxBytes",
      ),
      generatedImageSourceRoots,
      now: options.now ?? (() => new Date()),
      rootPath: roots.canonicalRoot,
    });
  }

  async writeAttachment(input: {
    bytes: Uint8Array;
    fileName: string;
    mimeType: string;
  }): Promise<StoredAsset> {
    this.validateBytes(input.bytes, this.attachmentMaxBytes);
    const inspected = inspectAssetContent({
      bytes: input.bytes,
      declaredMimeType: input.mimeType,
    });
    const originalName = validateAttachmentFilename(
      input.fileName,
      inspected.mimeType,
    );
    return this.persistAsset({
      bytes: input.bytes,
      mimeType: inspected.mimeType,
      originalName,
      source: "attachment",
    });
  }

  async writeGeneratedImage(input: {
    bytes: Uint8Array;
    fileName: string;
    mimeType: string;
  }): Promise<StoredAsset> {
    this.validateBytes(input.bytes, this.generatedImageMaxBytes);
    const inspected = inspectAssetContent({
      bytes: input.bytes,
      declaredMimeType: input.mimeType,
      generatedImageOnly: true,
    });
    const originalName = validateAttachmentFilename(
      input.fileName,
      inspected.mimeType,
    );
    return this.persistAsset({
      bytes: input.bytes,
      mimeType: inspected.mimeType,
      originalName,
      source: "generated-image",
    });
  }

  async ingestGeneratedImage(input: {
    declaredMimeType?: string;
    savedPath: string;
  }): Promise<StoredAsset> {
    const { bytes, fileName } = await this.readGeneratedImageSource(
      input.savedPath,
    );
    this.validateBytes(bytes, this.generatedImageMaxBytes);
    const inspected = inspectAssetContent({
      bytes,
      declaredMimeType: input.declaredMimeType,
      generatedImageOnly: true,
    });
    const originalName = validateAttachmentFilename(
      fileName,
      inspected.mimeType,
    );
    return this.persistAsset({
      bytes,
      mimeType: inspected.mimeType,
      originalName,
      source: "generated-image",
    });
  }

  async getAsset(assetId: string): Promise<StoredAsset> {
    const resolved = await this.resolveAssetFile(assetId);
    return resolved.asset;
  }

  async deleteAsset(assetId: string): Promise<boolean> {
    let resolved: ResolvedAssetFile;
    try {
      resolved = await this.resolveAssetFile(assetId);
    } catch (error) {
      if (
        error instanceof AssetStoreError &&
        error.code === "ASSET_NOT_FOUND"
      ) {
        return false;
      }
      throw error;
    }
    const recordPath = resolveAppOwnedPath(
      this.rootPath,
      recordRelativePath(resolved.asset.sha256),
    );
    await unlink(recordPath);
    await unlink(resolved.absolutePath);
    return true;
  }

  async resolveAssetFile(assetId: string): Promise<ResolvedAssetFile> {
    const sha = sha256FromAssetId(assetId);
    const recordPath = resolveAppOwnedPath(
      this.rootPath,
      recordRelativePath(sha),
    );
    const recordBytes = await readNoFollow(recordPath, MAX_RECORD_BYTES);
    let rawRecord: unknown;
    try {
      rawRecord = JSON.parse(recordBytes.toString("utf8"));
    } catch (error) {
      throw new AssetStoreError("ASSET_CORRUPT", "Asset metadata is invalid.", {
        cause: error,
      });
    }
    const record = parseStoredAssetRecord(rawRecord, sha);
    const absolutePath = resolveAppOwnedPath(this.rootPath, record.relativePath);
    const fileStats = await lstat(absolutePath).catch(() => null);
    if (
      !fileStats ||
      fileStats.isSymbolicLink() ||
      !fileStats.isFile() ||
      fileStats.nlink !== 1 ||
      fileStats.size !== record.byteLength
    ) {
      throw new AssetStoreError("ASSET_CORRUPT", "Stored asset is invalid.");
    }
    const canonicalPath = await realpath(absolutePath);
    if (!isPathInside(this.rootPath, canonicalPath)) {
      throw new AssetStoreError("ASSET_CORRUPT", "Stored asset escapes storage.");
    }
    return { absolutePath: canonicalPath, asset: publicAsset(record) };
  }

  async downloadMetadata(
    assetId: string,
    preferredFilename?: string,
  ): Promise<AssetDownloadMetadata> {
    const asset = await this.getAsset(assetId);
    return {
      assetId: asset.assetId,
      byteLength: asset.byteLength,
      mimeType: asset.mimeType,
      suggestedFilename: safeDownloadFilename(
        preferredFilename ?? asset.originalName,
        asset.mimeType,
      ),
    };
  }

  private validateBytes(bytes: Uint8Array, maxBytes: number): void {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
      throw new AssetStoreError("ASSET_EMPTY", "File contents are required.");
    }
    if (bytes.byteLength > maxBytes) {
      throw new AssetStoreError(
        "ASSET_TOO_LARGE",
        "File exceeds the allowed size.",
      );
    }
  }

  private async persistAsset(input: {
    bytes: Uint8Array;
    mimeType: SupportedAssetMimeType;
    originalName: string;
    source: AssetSource;
  }): Promise<StoredAsset> {
    const hash = sha256(input.bytes);
    const assetId = assetIdFromSha256(hash);
    const relativePath = objectRelativePath(
      hash,
      canonicalExtensionForMimeType(input.mimeType),
    );
    const absolutePath = resolveAppOwnedPath(this.rootPath, relativePath);
    const createdObject = await writeExclusiveAtomically(
      absolutePath,
      input.bytes,
    );
    if (!createdObject) {
      const existingBytes = await readNoFollow(
        absolutePath,
        Math.max(this.attachmentMaxBytes, this.generatedImageMaxBytes),
      );
      if (sha256(existingBytes) !== hash) {
        throw new AssetStoreError(
          "ASSET_CORRUPT",
          "Existing asset content does not match its identifier.",
        );
      }
    }

    const record: StoredAssetRecord = {
      assetId,
      byteLength: input.bytes.byteLength,
      createdAt: this.now().toISOString(),
      mimeType: input.mimeType,
      originalName: input.originalName,
      relativePath,
      schemaVersion: RECORD_SCHEMA_VERSION,
      sha256: hash,
      source: input.source,
    };
    const metadataPath = resolveAppOwnedPath(
      this.rootPath,
      recordRelativePath(hash),
    );
    const createdRecord = await writeExclusiveAtomically(
      metadataPath,
      Buffer.from(`${JSON.stringify(record)}\n`, "utf8"),
    );
    if (!createdRecord) {
      const existingRecordBytes = await readNoFollow(
        metadataPath,
        MAX_RECORD_BYTES,
      );
      let existingRecord: StoredAssetRecord;
      try {
        existingRecord = parseStoredAssetRecord(
          JSON.parse(existingRecordBytes.toString("utf8")),
          hash,
        );
      } catch (error) {
        throw new AssetStoreError(
          "ASSET_CORRUPT",
          "Existing asset metadata is invalid.",
          { cause: error },
        );
      }
      if (
        existingRecord.byteLength !== record.byteLength ||
        existingRecord.mimeType !== record.mimeType ||
        existingRecord.relativePath !== record.relativePath
      ) {
        throw new AssetStoreError(
          "ASSET_CORRUPT",
          "Existing asset metadata does not match its content.",
        );
      }
      return publicAsset(existingRecord);
    }
    return publicAsset(record);
  }

  private async readGeneratedImageSource(
    savedPath: string,
  ): Promise<{ bytes: Buffer; fileName: string }> {
    if (
      typeof savedPath !== "string" ||
      !isAbsolute(savedPath) ||
      savedPath.includes("\0") ||
      savedPath.includes("\\") ||
      savedPath.split("/").some((segment) => segment === "..")
    ) {
      throw new AssetStoreError(
        "SOURCE_PATH_INVALID",
        "Generated image source path is invalid.",
      );
    }

    const lexicalStats = await lstat(savedPath).catch(() => null);
    if (
      !lexicalStats ||
      lexicalStats.isSymbolicLink() ||
      !lexicalStats.isFile() ||
      lexicalStats.nlink !== 1
    ) {
      throw new AssetStoreError(
        "SOURCE_NOT_REGULAR",
        "Generated image source must be a real file.",
      );
    }
    const canonicalPath = await realpath(savedPath);
    if (
      !this.generatedImageSourceRoots.some((root) =>
        isPathInside(root, canonicalPath),
      )
    ) {
      throw new AssetStoreError(
        "SOURCE_NOT_ALLOWED",
        "Generated image source is outside Branchy-owned output directories.",
      );
    }

    const canonicalStats = await stat(canonicalPath);
    let handle;
    try {
      handle = await open(
        savedPath,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
    } catch (error) {
      throw new AssetStoreError(
        "SOURCE_NOT_REGULAR",
        "Generated image source cannot be opened safely.",
        { cause: error },
      );
    }
    try {
      const openedStats = await handle.stat();
      if (
        !openedStats.isFile() ||
        openedStats.nlink !== 1 ||
        !sameFile(openedStats, canonicalStats) ||
        openedStats.size <= 0
      ) {
        throw new AssetStoreError(
          "SOURCE_NOT_REGULAR",
          "Generated image source changed during validation.",
        );
      }
      if (openedStats.size > this.generatedImageMaxBytes) {
        throw new AssetStoreError(
          "ASSET_TOO_LARGE",
          "Generated image exceeds the allowed size.",
        );
      }
      const bytes = await handle.readFile();
      if (bytes.byteLength > this.generatedImageMaxBytes) {
        throw new AssetStoreError(
          "ASSET_TOO_LARGE",
          "Generated image exceeds the allowed size.",
        );
      }
      return { bytes, fileName: basename(canonicalPath) };
    } finally {
      await handle.close();
    }
  }
}

export function assetUrl(assetId: string): string {
  sha256FromAssetId(assetId);
  return `branchy-asset://asset/${assetId}`;
}
