import assert from "node:assert/strict";
import test from "node:test";

import type { ToolInvocation } from "./model.ts";
import { hasPendingImageGeneration } from "./imageGeneration.ts";

function invocation(
  status: ToolInvocation["status"],
  toolType = "image_generation",
): ToolInvocation {
  return {
    id: "tool-1",
    toolType,
    status,
    startedAt: "2026-07-22T00:00:00.000Z",
  };
}

test("pending image generation remains visible after its message is reloaded", () => {
  assert.equal(hasPendingImageGeneration([invocation("pending")]), true);
  assert.equal(hasPendingImageGeneration([invocation("running")]), true);
  assert.equal(hasPendingImageGeneration([invocation("succeeded")]), false);
  assert.equal(hasPendingImageGeneration([invocation("failed")]), false);
  assert.equal(hasPendingImageGeneration([invocation("running", "web_search")]), false);
});
