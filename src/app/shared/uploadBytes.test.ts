import assert from "node:assert/strict";
import test from "node:test";

import {
  readBoundedUploadBytes,
  UploadLimitExceededError,
} from "./uploadBytes.ts";

function streamChunks(chunks: number[][]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(Uint8Array.from(chunk));
      }
      controller.close();
    },
  });
}

test("buffers upload bytes into a known-length body", async () => {
  const bytes = await readBoundedUploadBytes(
    streamChunks([
      [1, 2],
      [3, 4, 5],
    ]),
    5,
  );
  assert.deepEqual(Array.from(bytes), [1, 2, 3, 4, 5]);
  assert.equal(bytes.byteLength, 5);
});

test("stops reading when actual upload bytes exceed the limit", async () => {
  await assert.rejects(
    readBoundedUploadBytes(
      streamChunks([
        [1, 2, 3],
        [4, 5, 6],
      ]),
      5,
    ),
    UploadLimitExceededError,
  );
});
