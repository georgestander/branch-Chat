import assert from "node:assert/strict";
import test from "node:test";

import {
  PendingUploadRegistry,
  visitDiscardedAttachments,
} from "./pending-uploads.ts";

test("an upload removed before completion is settled as discarded", () => {
  const uploads = new PendingUploadRegistry();
  uploads.begin("upload-1", "conversation", "root");
  uploads.discard("upload-1");

  assert.deepEqual(uploads.settle("upload-1"), {
    conversationId: "conversation",
    branchId: "root",
    discarded: true,
  });
  assert.equal(uploads.settle("upload-1"), null);
});

test("switching conversations discards unfinished uploads", () => {
  const uploads = new PendingUploadRegistry();
  uploads.begin("upload-1", "first", "root");
  uploads.reconcile("second", new Set(["root"]));

  assert.equal(uploads.settle("upload-1")?.discarded, true);
});

test("deleting an upload's branch discards it before completion", () => {
  const uploads = new PendingUploadRegistry();
  uploads.begin("upload-1", "conversation", "deleted-branch");
  uploads.reconcile("conversation", new Set(["root"]));

  assert.equal(uploads.settle("upload-1")?.discarded, true);
});

test("discarding a branch visits both unfinished and ready unsent files", () => {
  const uploads: string[] = [];
  const ready: string[] = [];
  visitDiscardedAttachments(
    {
      root: [
        {
          id: "attachment-kept",
          name: "kept.txt",
          contentType: "text/plain",
          size: 4,
          status: "ready",
          error: null,
        },
      ],
      removed: [
        {
          id: "upload-local",
          name: "loading.txt",
          contentType: "text/plain",
          size: 4,
          status: "uploading",
          error: null,
        },
        {
          id: "attachment-ready",
          name: "ready.txt",
          contentType: "text/plain",
          size: 4,
          status: "ready",
          error: null,
        },
      ],
    },
    new Set(["root"]),
    {
      upload: (id) => uploads.push(id),
      ready: (id) => ready.push(id),
    },
  );

  assert.deepEqual(uploads, ["upload-local"]);
  assert.deepEqual(ready, ["attachment-ready"]);
});
