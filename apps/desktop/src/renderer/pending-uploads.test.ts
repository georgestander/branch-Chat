import assert from "node:assert/strict";
import test from "node:test";

import { PendingUploadRegistry } from "./pending-uploads.ts";

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
