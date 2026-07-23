import {
  Unzip,
  UnzipInflate,
  zipSync,
  type Zippable,
} from "fflate";

import {
  BranchyArchiveError,
  DEFAULT_BRANCHY_ARCHIVE_LIMITS,
  type BranchyArchiveLimits,
} from "./types.ts";

const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const UTF8_FILENAME_FLAG = 0x0800;
const DEFLATE_OPTION_FLAGS = 0x0006;
const STREAM_INPUT_CHUNK_BYTES = 16 * 1024;
const MAX_ENTRY_PATH_BYTES = 1_024;
const MAX_ENTRY_PATH_CHARACTERS = 512;
const UNIX_FILE_TYPE_MASK = 0o170000;
const UNIX_REGULAR_FILE = 0o100000;
const UNIX_SYMLINK = 0o120000;

interface ZipEntryMetadata {
  name: string;
  normalizedName: string;
  rawName: Uint8Array;
  flags: number;
  compressedSize: number;
  uncompressedSize: number;
  compression: 0 | 8;
  crc32: number;
  localHeaderOffset: number;
}

interface ZipMetadata {
  entries: ZipEntryMetadata[];
}

function fail(
  code: ConstructorParameters<typeof BranchyArchiveError>[0],
  message: string,
  cause?: unknown,
): never {
  throw new BranchyArchiveError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function readUint16(view: DataView, offset: number): number {
  if (offset < 0 || offset + 2 > view.byteLength) {
    fail("invalid_zip", "ZIP metadata ended unexpectedly");
  }
  return view.getUint16(offset, true);
}

function readUint32(view: DataView, offset: number): number {
  if (offset < 0 || offset + 4 > view.byteLength) {
    fail("invalid_zip", "ZIP metadata ended unexpectedly");
  }
  return view.getUint32(offset, true);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function decodeEntryName(bytes: Uint8Array, utf8: boolean): string {
  if (!utf8 && bytes.some((value) => value > 0x7f)) {
    fail(
      "unsupported_zip_feature",
      "Non-ASCII ZIP names must declare UTF-8 encoding",
    );
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    fail("invalid_zip", "ZIP entry name is not valid UTF-8", error);
  }
}

function validateEntryPath(
  path: string,
  encodedByteLength: number,
  limits: BranchyArchiveLimits,
): string {
  if (
    path.length === 0 ||
    path.length > MAX_ENTRY_PATH_CHARACTERS ||
    encodedByteLength > MAX_ENTRY_PATH_BYTES ||
    path !== path.trim() ||
    path.includes("\\") ||
    path.includes("%") ||
    path.startsWith("/") ||
    /^[a-zA-Z]:/u.test(path) ||
    /[\u0000-\u001f\u007f]/u.test(path)
  ) {
    fail("unsafe_entry_path", "Archive contains an unsafe entry path");
  }

  const segments = path.split("/");
  if (
    segments.length > limits.maxPathDepth ||
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        segment.length > 255,
    )
  ) {
    fail("unsafe_entry_path", "Archive entry path is not safely bounded");
  }

  return path.normalize("NFC");
}

function validateEntryType(
  originOs: number,
  externalAttributes: number,
  path: string,
): void {
  if (path.endsWith("/") || (externalAttributes & 0x10) !== 0) {
    fail("unsupported_entry_type", "Archive directories are not supported");
  }

  if (originOs !== 0 && originOs !== 3 && originOs !== 19) {
    fail(
      "unsupported_zip_feature",
      "Archive entry uses an unsupported origin platform",
    );
  }

  if (originOs === 3 || originOs === 19) {
    const unixMode = externalAttributes >>> 16;
    const fileType = unixMode & UNIX_FILE_TYPE_MASK;
    if (fileType === UNIX_SYMLINK) {
      fail("unsupported_entry_type", "Archive symbolic links are not supported");
    }
    if (fileType !== 0 && fileType !== UNIX_REGULAR_FILE) {
      fail(
        "unsupported_entry_type",
        "Archive contains a non-regular file entry",
      );
    }
  }
}

function validateFlags(flags: number, compression: number): void {
  const allowedFlags =
    UTF8_FILENAME_FLAG | (compression === 8 ? DEFLATE_OPTION_FLAGS : 0);
  if ((flags & ~allowedFlags) !== 0) {
    fail(
      "unsupported_zip_feature",
      "Archive entry uses encryption, data descriptors, or unsupported flags",
    );
  }
}

function parseZipMetadata(
  archive: Uint8Array,
  limits: BranchyArchiveLimits,
): ZipMetadata {
  if (archive.byteLength < 22) {
    fail("invalid_zip", "Archive is too short to be a ZIP file");
  }

  const view = new DataView(
    archive.buffer,
    archive.byteOffset,
    archive.byteLength,
  );
  const eocdOffset = archive.byteLength - 22;
  if (
    readUint32(view, eocdOffset) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE ||
    readUint16(view, eocdOffset + 20) !== 0
  ) {
    fail(
      "unsupported_zip_feature",
      "ZIP comments, trailing data, and missing end records are not supported",
    );
  }

  const diskNumber = readUint16(view, eocdOffset + 4);
  const centralDirectoryDisk = readUint16(view, eocdOffset + 6);
  const entriesOnDisk = readUint16(view, eocdOffset + 8);
  const entryCount = readUint16(view, eocdOffset + 10);
  const centralDirectorySize = readUint32(view, eocdOffset + 12);
  const centralDirectoryOffset = readUint32(view, eocdOffset + 16);

  if (
    diskNumber !== 0 ||
    centralDirectoryDisk !== 0 ||
    entriesOnDisk !== entryCount
  ) {
    fail("unsupported_zip_feature", "Multi-disk ZIP archives are not supported");
  }
  if (
    entryCount === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff
  ) {
    fail("unsupported_zip_feature", "ZIP64 archives are not supported");
  }
  if (entryCount === 0) {
    fail("invalid_zip", "Archive contains no entries");
  }
  if (entryCount > limits.maxEntries) {
    fail("too_many_entries", "Archive contains too many entries");
  }
  if (
    centralDirectoryOffset + centralDirectorySize !== eocdOffset ||
    centralDirectoryOffset > eocdOffset
  ) {
    fail("invalid_zip", "ZIP central directory bounds are inconsistent");
  }

  const entries: ZipEntryMetadata[] = [];
  const normalizedNames = new Set<string>();
  let totalCompressedBytes = 0;
  let totalUncompressedBytes = 0;
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (
      offset + 46 > eocdOffset ||
      readUint32(view, offset) !== CENTRAL_DIRECTORY_SIGNATURE
    ) {
      fail("invalid_zip", "ZIP central directory entry is malformed");
    }

    const madeBy = readUint16(view, offset + 4);
    const originOs = madeBy >>> 8;
    const versionNeeded = readUint16(view, offset + 6);
    const flags = readUint16(view, offset + 8);
    const compression = readUint16(view, offset + 10);
    const crc32 = readUint32(view, offset + 16);
    const compressedSize = readUint32(view, offset + 20);
    const uncompressedSize = readUint32(view, offset + 24);
    const fileNameLength = readUint16(view, offset + 28);
    const extraLength = readUint16(view, offset + 30);
    const commentLength = readUint16(view, offset + 32);
    const diskStart = readUint16(view, offset + 34);
    const externalAttributes = readUint32(view, offset + 38);
    const localHeaderOffset = readUint32(view, offset + 42);
    const entryEnd =
      offset + 46 + fileNameLength + extraLength + commentLength;

    if (
      entryEnd > eocdOffset ||
      fileNameLength === 0 ||
      extraLength !== 0 ||
      commentLength !== 0 ||
      diskStart !== 0 ||
      versionNeeded > 20
    ) {
      fail(
        "unsupported_zip_feature",
        "Archive entry uses unsupported ZIP metadata",
      );
    }
    if (compression !== 0 && compression !== 8) {
      fail(
        "unsupported_zip_feature",
        "Archive entry uses an unsupported compression method",
      );
    }
    validateFlags(flags, compression);

    const rawName = archive.subarray(offset + 46, offset + 46 + fileNameLength);
    const name = decodeEntryName(rawName, (flags & UTF8_FILENAME_FLAG) !== 0);
    const normalizedName = validateEntryPath(name, fileNameLength, limits);
    if (normalizedNames.has(normalizedName)) {
      fail(
        "duplicate_entry_path",
        "Archive contains duplicate Unicode-normalized entry paths",
      );
    }
    normalizedNames.add(normalizedName);
    validateEntryType(originOs, externalAttributes, name);

    if (uncompressedSize > limits.maxEntryBytes) {
      fail("entry_too_large", "Archive entry exceeds the per-entry size limit");
    }
    const compressionRatio =
      uncompressedSize === 0
        ? 1
        : uncompressedSize / Math.max(compressedSize, 1);
    if (compressionRatio > limits.maxCompressionRatio) {
      fail(
        "compression_ratio_exceeded",
        "Archive entry exceeds the allowed compression ratio",
      );
    }

    totalCompressedBytes += compressedSize;
    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > limits.maxTotalUncompressedBytes) {
      fail(
        "total_size_exceeded",
        "Archive exceeds the total uncompressed size limit",
      );
    }

    entries.push({
      name,
      normalizedName,
      rawName: rawName.slice(),
      flags,
      compressedSize,
      uncompressedSize,
      compression,
      crc32,
      localHeaderOffset,
    });
    offset = entryEnd;
  }

  if (offset !== eocdOffset) {
    fail("invalid_zip", "ZIP central directory contains unparsed data");
  }
  if (
    totalUncompressedBytes > 0 &&
    totalUncompressedBytes / Math.max(totalCompressedBytes, 1) >
      limits.maxCompressionRatio
  ) {
    fail(
      "compression_ratio_exceeded",
      "Archive exceeds the allowed aggregate compression ratio",
    );
  }

  const occupiedRanges: Array<{ start: number; end: number }> = [];
  const localOffsets = new Set<number>();
  for (const entry of entries) {
    const localOffset = entry.localHeaderOffset;
    if (
      localOffsets.has(localOffset) ||
      localOffset + 30 > centralDirectoryOffset ||
      readUint32(view, localOffset) !== LOCAL_FILE_SIGNATURE
    ) {
      fail("invalid_zip", "ZIP local file header is malformed or reused");
    }
    localOffsets.add(localOffset);

    const localVersionNeeded = readUint16(view, localOffset + 4);
    const localFlags = readUint16(view, localOffset + 6);
    const localCompression = readUint16(view, localOffset + 8);
    const localCrc32 = readUint32(view, localOffset + 14);
    const localCompressedSize = readUint32(view, localOffset + 18);
    const localUncompressedSize = readUint32(view, localOffset + 22);
    const localNameLength = readUint16(view, localOffset + 26);
    const localExtraLength = readUint16(view, localOffset + 28);
    const nameStart = localOffset + 30;
    const dataStart = nameStart + localNameLength + localExtraLength;
    const dataEnd = dataStart + entry.compressedSize;

    if (
      localVersionNeeded > 20 ||
      localFlags !== entry.flags ||
      localCompression !== entry.compression ||
      localCrc32 !== entry.crc32 ||
      localCompressedSize !== entry.compressedSize ||
      localUncompressedSize !== entry.uncompressedSize ||
      localExtraLength !== 0 ||
      dataEnd > centralDirectoryOffset
    ) {
      fail("invalid_zip", "ZIP local and central metadata do not agree");
    }
    validateFlags(localFlags, localCompression);

    const localNameBytes = archive.subarray(
      nameStart,
      nameStart + localNameLength,
    );
    if (!bytesEqual(localNameBytes, entry.rawName)) {
      fail("invalid_zip", "ZIP local and central entry names do not agree");
    }

    occupiedRanges.push({ start: localOffset, end: dataEnd });
  }

  occupiedRanges.sort((left, right) => left.start - right.start);
  let expectedStart = 0;
  for (const range of occupiedRanges) {
    if (range.start !== expectedStart || range.end < range.start) {
      fail(
        "unsupported_zip_feature",
        "Archive contains overlapping, padded, or hidden local file data",
      );
    }
    expectedStart = range.end;
  }
  if (expectedStart !== centralDirectoryOffset) {
    fail(
      "unsupported_zip_feature",
      "Archive contains data outside its declared regular files",
    );
  }

  return { entries };
}

export function resolveArchiveLimits(
  overrides: Partial<BranchyArchiveLimits> | undefined,
): BranchyArchiveLimits {
  const limits = {
    ...DEFAULT_BRANCHY_ARCHIVE_LIMITS,
    ...overrides,
  };

  for (const [name, value] of Object.entries(limits)) {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value <= 0 ||
      (name !== "maxCompressionRatio" && !Number.isSafeInteger(value))
    ) {
      fail("invalid_archive_limits", `Archive limit ${name} is invalid`);
    }
  }
  if (
    limits.maxManifestBytes > limits.maxEntryBytes ||
    limits.maxEntryBytes > limits.maxTotalUncompressedBytes
  ) {
    fail(
      "invalid_archive_limits",
      "Archive size limits must be internally consistent",
    );
  }
  return limits;
}

export function createDeterministicZip(
  entries: readonly { path: string; bytes: Uint8Array }[],
  limits: BranchyArchiveLimits,
): Uint8Array {
  if (entries.length === 0 || entries.length > limits.maxEntries) {
    fail("too_many_entries", "Archive contains an invalid number of entries");
  }

  const zippable = Object.create(null) as Zippable;
  const seenPaths = new Set<string>();
  let totalBytes = 0;
  for (const entry of entries) {
    const normalizedPath = validateEntryPath(
      entry.path,
      new TextEncoder().encode(entry.path).byteLength,
      limits,
    );
    if (seenPaths.has(normalizedPath)) {
      fail("duplicate_entry_path", "Archive export contains duplicate paths");
    }
    seenPaths.add(normalizedPath);
    if (entry.bytes.byteLength > limits.maxEntryBytes) {
      fail("entry_too_large", "Archive export entry is too large");
    }
    totalBytes += entry.bytes.byteLength;
    if (totalBytes > limits.maxTotalUncompressedBytes) {
      fail("total_size_exceeded", "Archive export is too large");
    }

    zippable[entry.path] = [
      entry.bytes,
      {
        level: 0,
        mtime: new Date(1980, 0, 1, 0, 0, 0, 0),
        os: 3,
        attrs: (0o100600 * 65_536) >>> 0,
      },
    ];
  }

  let archive: Uint8Array;
  try {
    archive = zipSync(zippable, {
      level: 0,
      mtime: new Date(1980, 0, 1, 0, 0, 0, 0),
      os: 3,
      attrs: (0o100600 * 65_536) >>> 0,
    });
  } catch (error) {
    fail("invalid_zip", "Could not construct Branchy archive", error);
  }
  if (archive.byteLength > limits.maxArchiveBytes) {
    fail("archive_too_large", "Archive exceeds the compressed size limit");
  }
  return archive;
}

export function extractValidatedZip(
  archive: Uint8Array,
  limits: BranchyArchiveLimits,
): Map<string, Uint8Array> {
  if (!(archive instanceof Uint8Array)) {
    fail("invalid_zip", "Archive must be provided as bytes");
  }
  if (archive.byteLength > limits.maxArchiveBytes) {
    fail("archive_too_large", "Archive exceeds the compressed size limit");
  }

  const metadata = parseZipMetadata(archive, limits);
  const metadataByName = new Map(
    metadata.entries.map((entry) => [entry.name, entry]),
  );
  const extracted = new Map<string, Uint8Array>();
  const seen = new Set<string>();
  let actualTotalBytes = 0;
  let extractionError: BranchyArchiveError | null = null;

  const unzip = new Unzip((file) => {
    if (extractionError) {
      file.terminate();
      return;
    }
    const expected = metadataByName.get(file.name);
    if (!expected || seen.has(file.name)) {
      extractionError = new BranchyArchiveError(
        "invalid_zip",
        "ZIP stream entries do not match the central directory",
      );
      file.terminate();
      return;
    }
    seen.add(file.name);

    // Allocate exactly the preflight-approved size once. Accumulating chunks
    // and reassembling them would briefly double the full entry in main-process
    // memory.
    const bytes = new Uint8Array(expected.uncompressedSize);
    let entryBytes = 0;
    file.ondata = (error, chunk, final) => {
      if (extractionError) {
        file.terminate();
        return;
      }
      if (error) {
        extractionError = new BranchyArchiveError(
          "invalid_zip",
          "Archive decompression failed",
          { cause: error },
        );
        file.terminate();
        return;
      }
      if (chunk && chunk.byteLength > 0) {
        const nextEntryBytes = entryBytes + chunk.byteLength;
        actualTotalBytes += chunk.byteLength;
        if (nextEntryBytes > limits.maxEntryBytes) {
          extractionError = new BranchyArchiveError(
            "entry_too_large",
            "Decompressed archive entry exceeds its size limit",
          );
          file.terminate();
          return;
        }
        if (actualTotalBytes > limits.maxTotalUncompressedBytes) {
          extractionError = new BranchyArchiveError(
            "total_size_exceeded",
            "Decompressed archive exceeds its total size limit",
          );
          file.terminate();
          return;
        }
        if (nextEntryBytes > expected.uncompressedSize) {
          extractionError = new BranchyArchiveError(
            "invalid_zip",
            "Decompressed entry exceeds its declared size",
          );
          file.terminate();
          return;
        }
        bytes.set(chunk, entryBytes);
        entryBytes = nextEntryBytes;
      }
      if (!final) {
        return;
      }
      if (entryBytes !== expected.uncompressedSize) {
        extractionError = new BranchyArchiveError(
          "invalid_zip",
          "Decompressed entry size does not match ZIP metadata",
        );
        return;
      }
      extracted.set(file.name, bytes);
    };

    try {
      file.start();
    } catch (error) {
      extractionError = new BranchyArchiveError(
        "invalid_zip",
        "Archive entry could not be decompressed",
        { cause: error },
      );
      file.terminate();
    }
  });
  unzip.register(UnzipInflate);

  try {
    for (
      let offset = 0;
      offset < archive.byteLength && !extractionError;
      offset += STREAM_INPUT_CHUNK_BYTES
    ) {
      const end = Math.min(offset + STREAM_INPUT_CHUNK_BYTES, archive.byteLength);
      unzip.push(archive.subarray(offset, end), end === archive.byteLength);
    }
  } catch (error) {
    fail("invalid_zip", "Archive decompression failed", error);
  }

  if (extractionError) {
    throw extractionError;
  }
  if (
    seen.size !== metadata.entries.length ||
    extracted.size !== metadata.entries.length
  ) {
    fail("invalid_zip", "Archive did not produce every declared entry");
  }
  return extracted;
}
