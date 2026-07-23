import assert from "node:assert/strict";
import test from "node:test";

import {
  generatedImageContentDisposition,
  generatedImageDownloadFilename,
} from "./generatedImages.ts";

test("generated image downloads use a safe content-aware filename", () => {
  assert.equal(
    generatedImageDownloadFilename("image/unsafe id", "image/png"),
    "branch-chat-image-unsafe-id.png",
  );
  assert.equal(
    generatedImageDownloadFilename("art-1", "image/jpeg"),
    "branch-chat-art-1.jpg",
  );
  assert.equal(
    generatedImageDownloadFilename("art-1", "application/octet-stream"),
    "branch-chat-art-1.bin",
  );
  assert.equal(
    generatedImageContentDisposition("art-1", "image/webp"),
    'attachment; filename="branch-chat-art-1.webp"',
  );
});
