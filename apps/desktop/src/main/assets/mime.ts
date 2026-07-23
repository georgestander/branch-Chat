import { AssetStoreError } from "./errors.ts";

export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
export const GENERATED_IMAGE_MAX_BYTES = 50 * 1024 * 1024;

const MIME_POLICIES = {
  "application/msword": {
    canonicalExtension: "doc",
    extensions: ["doc"],
  },
  "application/pdf": {
    canonicalExtension: "pdf",
    extensions: ["pdf"],
  },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    canonicalExtension: "docx",
    extensions: ["docx"],
  },
  "image/gif": {
    canonicalExtension: "gif",
    extensions: ["gif"],
  },
  "image/jpeg": {
    canonicalExtension: "jpg",
    extensions: ["jpg", "jpeg"],
  },
  "image/png": {
    canonicalExtension: "png",
    extensions: ["png"],
  },
  "image/webp": {
    canonicalExtension: "webp",
    extensions: ["webp"],
  },
  "text/plain": {
    canonicalExtension: "txt",
    extensions: ["txt", "text"],
  },
} as const;

export type SupportedAssetMimeType = keyof typeof MIME_POLICIES;
export type GeneratedImageMimeType =
  | "image/gif"
  | "image/jpeg"
  | "image/png"
  | "image/webp";

export interface InspectedAssetContent {
  extension: string;
  mimeType: SupportedAssetMimeType;
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function isGif(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 6) {
    return false;
  }
  const signature = Buffer.from(bytes.subarray(0, 6)).toString("ascii");
  return signature === "GIF87a" || signature === "GIF89a";
}

function isWebp(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 12 &&
    Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" &&
    Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP"
  );
}

function findZipEndOfCentralDirectory(bytes: Uint8Array): number {
  const minimumOffset = Math.max(0, bytes.byteLength - 65_557);
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = bytes.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (view.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }
  return -1;
}

function isDocx(bytes: Uint8Array): boolean {
  if (
    !startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) &&
    !startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]) &&
    !startsWith(bytes, [0x50, 0x4b, 0x07, 0x08])
  ) {
    return false;
  }

  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findZipEndOfCentralDirectory(bytes);
  if (eocdOffset < 0 || eocdOffset + 22 > bytes.byteLength) {
    return false;
  }

  const entryCount = view.readUInt16LE(eocdOffset + 10);
  const directorySize = view.readUInt32LE(eocdOffset + 12);
  const directoryOffset = view.readUInt32LE(eocdOffset + 16);
  if (
    entryCount === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff ||
    directoryOffset + directorySize > eocdOffset
  ) {
    return false;
  }

  let offset = directoryOffset;
  let hasContentTypes = false;
  let hasWordDocument = false;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.byteLength || view.readUInt32LE(offset) !== 0x02014b50) {
      return false;
    }
    const nameLength = view.readUInt16LE(offset + 28);
    const extraLength = view.readUInt16LE(offset + 30);
    const commentLength = view.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    const nextOffset = nameStart + nameLength + extraLength + commentLength;
    if (nextOffset > bytes.byteLength) {
      return false;
    }
    const entryName = view.subarray(nameStart, nameStart + nameLength).toString("utf8");
    if (
      entryName.includes("\\") ||
      entryName.startsWith("/") ||
      entryName.split("/").some((segment) => segment === "..")
    ) {
      return false;
    }
    hasContentTypes ||= entryName === "[Content_Types].xml";
    hasWordDocument ||= entryName === "word/document.xml";
    offset = nextOffset;
  }
  return hasContentTypes && hasWordDocument;
}

function isPlainText(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) {
    return false;
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export function sniffAssetMimeType(
  bytes: Uint8Array,
): SupportedAssetMimeType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (isGif(bytes)) {
    return "image/gif";
  }
  if (isWebp(bytes)) {
    return "image/webp";
  }
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return "application/pdf";
  }
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return "application/msword";
  }
  if (isDocx(bytes)) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return isPlainText(bytes) ? "text/plain" : null;
}

export function normalizeDeclaredMimeType(
  value: string,
): SupportedAssetMimeType {
  if (value !== value.trim() || value !== value.toLowerCase()) {
    throw new AssetStoreError("UNSUPPORTED_MIME", "File type is not supported.");
  }
  if (!Object.hasOwn(MIME_POLICIES, value)) {
    throw new AssetStoreError("UNSUPPORTED_MIME", "File type is not supported.");
  }
  return value as SupportedAssetMimeType;
}

export function inspectAssetContent(options: {
  bytes: Uint8Array;
  declaredMimeType?: string;
  generatedImageOnly?: boolean;
}): InspectedAssetContent {
  const actualMimeType = sniffAssetMimeType(options.bytes);
  if (!actualMimeType) {
    throw new AssetStoreError(
      "UNSUPPORTED_MIME",
      "The file contents are not a supported type.",
    );
  }

  if (options.declaredMimeType) {
    const declaredMimeType = normalizeDeclaredMimeType(options.declaredMimeType);
    if (declaredMimeType !== actualMimeType) {
      throw new AssetStoreError(
        "MIME_MISMATCH",
        "The declared file type does not match its contents.",
      );
    }
  }

  if (options.generatedImageOnly && !actualMimeType.startsWith("image/")) {
    throw new AssetStoreError(
      "UNSUPPORTED_MIME",
      "Generated output must be a supported image.",
    );
  }

  return {
    extension: MIME_POLICIES[actualMimeType].canonicalExtension,
    mimeType: actualMimeType,
  };
}

export function extensionsForMimeType(
  mimeType: SupportedAssetMimeType,
): readonly string[] {
  return MIME_POLICIES[mimeType].extensions;
}

export function canonicalExtensionForMimeType(
  mimeType: SupportedAssetMimeType,
): string {
  return MIME_POLICIES[mimeType].canonicalExtension;
}
