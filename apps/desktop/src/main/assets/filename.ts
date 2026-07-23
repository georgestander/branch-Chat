import { extname } from "node:path";

import { AssetStoreError } from "./errors.ts";
import {
  canonicalExtensionForMimeType,
  extensionsForMimeType,
  type SupportedAssetMimeType,
} from "./mime.ts";

const MAX_FILENAME_BYTES = 180;
const FORBIDDEN_FILENAME_CHARACTER = /[\u0000-\u001f\u007f<>:"/\\|?*]/u;
const FORBIDDEN_FILENAME_CHARACTERS = /[\u0000-\u001f\u007f<>:"/\\|?*]/gu;
const WINDOWS_RESERVED_NAME =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;

function truncateUtf8(value: string, maxBytes: number): string {
  let output = "";
  let byteLength = 0;
  for (const character of value) {
    const nextLength = Buffer.byteLength(character);
    if (byteLength + nextLength > maxBytes) {
      break;
    }
    output += character;
    byteLength += nextLength;
  }
  return output;
}

function normalizeFilenameText(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}

function splitBaseName(value: string): { baseName: string; extension: string } {
  const extensionWithDot = extname(value);
  return {
    baseName: extensionWithDot ? value.slice(0, -extensionWithDot.length) : value,
    extension: extensionWithDot.slice(1).toLowerCase(),
  };
}

function finishSafeFilename(
  rawBaseName: string,
  mimeType: SupportedAssetMimeType,
): string {
  const extension = canonicalExtensionForMimeType(mimeType);
  const maximumBaseBytes =
    MAX_FILENAME_BYTES - Buffer.byteLength(extension) - Buffer.byteLength(".");
  let baseName = normalizeFilenameText(rawBaseName)
    .replace(FORBIDDEN_FILENAME_CHARACTERS, "-")
    .replace(/[\s._-]*$/gu, "")
    .replace(/^[\s.]+/gu, "")
    .replace(/-{2,}/gu, "-");
  baseName = truncateUtf8(baseName, maximumBaseBytes);
  if (!baseName) {
    baseName = mimeType.startsWith("image/") ? "branchy-image" : "attachment";
  }
  if (WINDOWS_RESERVED_NAME.test(baseName)) {
    baseName = `branchy-${baseName}`;
  }
  return `${baseName}.${extension}`;
}

export function validateAttachmentFilename(
  value: string,
  mimeType: SupportedAssetMimeType,
): string {
  if (typeof value !== "string") {
    throw new AssetStoreError("FILENAME_INVALID", "File name is required.");
  }
  const normalized = normalizeFilenameText(value);
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.includes("/") ||
    normalized.includes("\\") ||
    FORBIDDEN_FILENAME_CHARACTER.test(normalized)
  ) {
    throw new AssetStoreError(
      "FILENAME_INVALID",
      "File name must not contain a path or reserved characters.",
    );
  }

  const { baseName, extension } = splitBaseName(normalized);
  if (
    extension &&
    !extensionsForMimeType(mimeType).some(
      (allowedExtension) => allowedExtension === extension,
    )
  ) {
    throw new AssetStoreError(
      "MIME_EXTENSION_MISMATCH",
      "The file extension does not match its contents.",
    );
  }
  return finishSafeFilename(baseName || normalized, mimeType);
}

export function safeDownloadFilename(
  value: string | undefined,
  mimeType: SupportedAssetMimeType,
): string {
  const normalized = normalizeFilenameText(
    typeof value === "string" ? value : "",
  );
  const lastPathPart = normalized.split(/[\\/]/u).at(-1) ?? "";
  const { baseName } = splitBaseName(lastPathPart);
  return finishSafeFilename(baseName || lastPathPart, mimeType);
}
