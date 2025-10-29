export const UPLOAD_MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB
export const UPLOAD_MAX_ATTACHMENTS = 10;

const ALLOWED_MIME_PREFIXES = ["image/"];
const ALLOWED_MIME_TYPES = new Set<string>([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

export function isAttachmentMimeTypeAllowed(mimeType: string): boolean {
  if (!mimeType) {
    return false;
  }
  if (ALLOWED_MIME_TYPES.has(mimeType)) {
    return true;
  }
  return ALLOWED_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix));
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"] as const;
  let index = 0;
  let value = bytes;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}
