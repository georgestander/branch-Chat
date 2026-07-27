import assert from "node:assert/strict";
import test from "node:test";

import { createConversationSnapshot } from "./model.ts";
import type { RenderedMessage } from "./rendered.ts";
import {
  branchSourceMarkers,
  hasSameCanonicalRenderedMessageState,
} from "./rendered.ts";

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

test("branch source markers follow source position and keep shared spans distinct", () => {
  const snapshot = createConversationSnapshot({
    id: "conversation",
    createdAt: "2026-07-27T00:00:00.000Z",
    settings: {
      model: "gpt-5.6-terra",
      temperature: 0,
      composerDefaults: { preset: "fast", tools: [] },
    },
    rootBranch: {
      id: "root",
      title: "Root",
      createdFrom: { messageId: "source" },
      createdAt: "2026-07-27T00:00:00.000Z",
    },
  });
  snapshot.branches.later = {
    id: "later",
    parentId: "root",
    title: "Later",
    createdFrom: {
      messageId: "source",
      span: { start: 20, end: 25 },
    },
    messageIds: [],
    createdAt: "2026-07-27T00:01:00.000Z",
  };
  snapshot.branches.sharedSecond = {
    id: "shared-second",
    parentId: "root",
    title: "Shared second",
    createdFrom: {
      messageId: "source",
      span: { start: 4, end: 9 },
    },
    messageIds: [],
    createdAt: "2026-07-27T00:03:00.000Z",
  };
  snapshot.branches.sharedFirst = {
    id: "shared-first",
    parentId: "root",
    title: "Shared first",
    createdFrom: {
      messageId: "source",
      span: { start: 4, end: 9 },
    },
    messageIds: [],
    createdAt: "2026-07-27T00:02:00.000Z",
  };

  assert.deepEqual(
    Object.fromEntries(branchSourceMarkers(snapshot)),
    {
      "shared-first": 1,
      "shared-second": 2,
      later: 3,
    },
  );
});
