const GENERATED_IMAGE_EXTENSIONS: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function generatedImageDownloadFilename(
  imageId: string,
  contentType: string | null,
): string {
  const safeImageId = imageId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 64) || "image";
  const extension = GENERATED_IMAGE_EXTENSIONS[contentType ?? ""] ?? "bin";
  return `branch-chat-${safeImageId}.${extension}`;
}

export function generatedImageContentDisposition(
  imageId: string,
  contentType: string | null,
): string {
  return `attachment; filename="${generatedImageDownloadFilename(
    imageId,
    contentType,
  )}"`;
}
