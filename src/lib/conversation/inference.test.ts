import assert from "node:assert/strict";
import { test } from "node:test";

import {
  listCodexThreadIdsForBranchSubtree,
  resolveCodexInferenceTarget,
  selectCodexServiceTier,
} from "./inference.ts";
import {
  createConversationSnapshot,
  type ConversationGraphSnapshot,
} from "./model.ts";

const createdAt = "2026-07-22T00:00:00.000Z";

function snapshot(): ConversationGraphSnapshot {
  return createConversationSnapshot({
    id: "conversation",
    createdAt,
    settings: {
      model: "gpt-5.6-luna",
      temperature: 0,
      reasoningEffort: "low",
      composerDefaults: { preset: "custom", tools: [] },
    },
    rootBranch: {
      id: "root",
      title: "Root",
      createdFrom: { messageId: "root-source" },
      createdAt,
    },
  });
}

test("an established branch resumes its own persistent thread", () => {
  const graph = snapshot();
  graph.branches.root.inferenceContext = {
    provider: "codex",
    threadId: "thread-root",
    lastTurnId: "turn-head",
  };

  assert.deepEqual(resolveCodexInferenceTarget(graph, "root"), {
    mode: "resume",
    threadId: "thread-root",
  });
});

test("a new child forks the exact source assistant turn", () => {
  const graph = snapshot();
  graph.messages.source = {
    id: "source",
    branchId: "root",
    role: "assistant",
    content: "Source answer",
    createdAt,
    inferenceContext: {
      provider: "codex",
      threadId: "thread-root",
      turnId: "turn-source",
    },
  };
  graph.branches.root.messageIds.push("source");
  graph.branches.child = {
    id: "child",
    parentId: "root",
    title: "Child",
    createdFrom: { messageId: "source" },
    messageIds: [],
    createdAt,
  };

  assert.deepEqual(resolveCodexInferenceTarget(graph, "child"), {
    mode: "fork",
    threadId: "thread-root",
    turnId: "turn-source",
  });
});

test("legacy branches rebuild canonical history instead of guessing a fork", () => {
  const graph = snapshot();
  graph.branches.child = {
    id: "child",
    parentId: "root",
    title: "Child",
    createdFrom: { messageId: "legacy-source" },
    messageIds: ["legacy-child-message"],
    createdAt,
  };
  graph.messages["legacy-child-message"] = {
    id: "legacy-child-message",
    branchId: "child",
    role: "user",
    content: "Existing legacy branch turn",
    createdAt,
  };

  assert.deepEqual(resolveCodexInferenceTarget(graph, "child"), {
    mode: "rebuild",
  });
});

test("Luna low and fast presets use the low-latency service tier", () => {
  assert.equal(
    selectCodexServiceTier({
      reasoningEffort: "low",
      composerDefaults: { preset: "custom", tools: [] },
    }),
    "priority",
  );
  assert.equal(
    selectCodexServiceTier({
      reasoningEffort: "medium",
      composerDefaults: { preset: "fast", tools: [] },
    }),
    "priority",
  );
  assert.equal(
    selectCodexServiceTier({
      reasoningEffort: "medium",
      composerDefaults: { preset: "custom", tools: [] },
    }),
    null,
  );
});

test("thread cleanup includes only the deleted branch subtree", () => {
  const graph = snapshot();
  graph.branches.root.inferenceContext = {
    provider: "codex",
    threadId: "thread-root",
  };
  graph.branches.child = {
    id: "child",
    parentId: "root",
    title: "Child",
    createdFrom: { messageId: "source" },
    messageIds: [],
    createdAt,
    inferenceContext: { provider: "codex", threadId: "thread-child" },
  };
  graph.branches.grandchild = {
    id: "grandchild",
    parentId: "child",
    title: "Grandchild",
    createdFrom: { messageId: "child-source" },
    messageIds: [],
    createdAt,
    inferenceContext: { provider: "codex", threadId: "thread-grandchild" },
  };
  graph.branches.sibling = {
    id: "sibling",
    parentId: "root",
    title: "Sibling",
    createdFrom: { messageId: "source" },
    messageIds: [],
    createdAt,
    inferenceContext: { provider: "codex", threadId: "thread-sibling" },
  };

  assert.deepEqual(
    listCodexThreadIdsForBranchSubtree(graph, "child").sort(),
    ["thread-child", "thread-grandchild"],
  );
});
