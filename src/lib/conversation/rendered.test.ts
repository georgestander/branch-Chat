import assert from "node:assert/strict";
import test from "node:test";

import type { RenderedMessage } from "./rendered.ts";
import { hasSameCanonicalRenderedMessageState } from "./rendered.ts";

function renderedMessage(status: "running" | "succeeded"): RenderedMessage {
  return {
    id: "message-1",
    branchId: "branch-1",
    role: "assistant",
    content: status === "succeeded" ? "![Generated image](/image)" : "",
    createdAt: "2026-07-22T00:00:00.000Z",
    tokenUsage:
      status === "succeeded" ? { prompt: 10, completion: 1, cost: 0 } : null,
    toolInvocations: [
      {
        id: "image-1",
        toolType: "image_generation",
        status,
        startedAt: "2026-07-22T00:00:00.000Z",
      },
    ],
    renderedHtml: "",
    hasBranchHighlight: false,
    branchAnchors: [],
  };
}

test("completed streamed messages replace stale running placeholders", () => {
  const running = renderedMessage("running");
  const completed = renderedMessage("succeeded");
  assert.equal(hasSameCanonicalRenderedMessageState(running, completed), false);
  assert.equal(hasSameCanonicalRenderedMessageState(completed, completed), true);
});
