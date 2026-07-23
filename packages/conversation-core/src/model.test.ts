import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyCanvasPatch,
  arrangeFocusedChildOnCanvas,
  cloneConversationSnapshot,
  createConversationSnapshot,
  deleteBranchSubtree,
  normalizeConversationCanvasState,
  placeNewBranchOnCanvas,
  type Branch,
  type Message,
} from "./model.ts";
import { validateConversationGraphSnapshot } from "./validation.ts";

const createdAt = "2026-07-21T00:00:00.000Z";

function branch(id: string, parentId: string): Branch {
  return {
    id,
    parentId,
    title: id,
    createdFrom: { messageId: "root-message" },
    messageIds: [`${id}-message`],
    createdAt,
  };
}

function message(id: string, branchId: string): Message {
  return {
    id,
    branchId,
    role: "user",
    content: id,
    createdAt,
  };
}

test("deleteBranchSubtree removes a branch, descendants, and their messages", () => {
  const snapshot = createConversationSnapshot({
    id: "conversation",
    createdAt,
    settings: {
      model: "gpt-5.6-terra",
      temperature: 0,
      composerDefaults: { preset: "fast", tools: ["web-search"] },
    },
    rootBranch: {
      id: "root",
      title: "Root",
      createdFrom: { messageId: "root-message" },
      createdAt,
    },
  });
  snapshot.branches.child = branch("child", "root");
  snapshot.branches.grandchild = branch("grandchild", "child");
  snapshot.branches.sibling = branch("sibling", "root");
  snapshot.messages["child-message"] = message("child-message", "child");
  snapshot.messages["grandchild-message"] = message(
    "grandchild-message",
    "grandchild",
  );
  snapshot.messages["sibling-message"] = message("sibling-message", "sibling");

  const deletedIds = deleteBranchSubtree(snapshot, "child");

  assert.deepEqual(new Set(deletedIds), new Set(["child", "grandchild"]));
  assert.deepEqual(Object.keys(snapshot.branches).sort(), ["root", "sibling"]);
  assert.deepEqual(Object.keys(snapshot.messages), ["sibling-message"]);
  assert.deepEqual(Object.keys(snapshot.canvas.nodes).sort(), ["root", "sibling"]);
  assert.equal(snapshot.canvas.focusedBranchId, "root");
});

test("deleteBranchSubtree protects the root branch", () => {
  const snapshot = createConversationSnapshot({
    id: "conversation",
    createdAt,
    settings: {
      model: "gpt-5.6-terra",
      temperature: 0,
      composerDefaults: { preset: "fast", tools: ["web-search"] },
    },
    rootBranch: {
      id: "root",
      title: "Root",
      createdFrom: { messageId: "root-message" },
      createdAt,
    },
  });

  assert.throws(() => deleteBranchSubtree(snapshot, "root"), {
    message: "The root branch cannot be deleted",
  });
});

test("normalizeConversationCanvasState lays out missing branch nodes deterministically", () => {
  const snapshot = createConversationSnapshot({
    id: "conversation",
    createdAt,
    settings: {
      model: "gpt-5.6-terra",
      temperature: 0,
      composerDefaults: { preset: "fast", tools: ["web-search"] },
    },
    rootBranch: {
      id: "root",
      title: "Root",
      createdFrom: { messageId: "root-message" },
      createdAt,
    },
  });

  snapshot.branches.child = branch("child", "root");
  snapshot.branches.sibling = {
    ...branch("sibling", "root"),
    createdAt: "2026-07-21T00:00:01.000Z",
  };

  const canvas = normalizeConversationCanvasState({
    conversation: snapshot.conversation,
    branches: snapshot.branches,
    canvas: {
      version: 1,
      viewport: { x: 0, y: 0, zoom: 1 },
      focusedBranchId: "missing",
      nodes: {
        root: {
          branchId: "root",
          x: 12,
          y: 34,
          folded: false,
        },
      },
    },
  });

  assert.equal(canvas.focusedBranchId, "root");
  assert.deepEqual(canvas.nodes.root, {
    branchId: "root",
    x: 12,
    y: 34,
    folded: false,
    expanded: true,
  });
  assert.deepEqual(canvas.nodes.child, {
    branchId: "child",
    x: 420,
    y: 220,
    folded: false,
    expanded: false,
  });
  assert.deepEqual(canvas.nodes.sibling, {
    branchId: "sibling",
    x: 420,
    y: 440,
    folded: false,
    expanded: false,
  });

});

test("applyCanvasPatch updates viewport and node state while preserving normalization", () => {
  const snapshot = createConversationSnapshot({
    id: "conversation",
    createdAt,
    settings: {
      model: "gpt-5.6-terra",
      temperature: 0,
      composerDefaults: { preset: "fast", tools: ["web-search"] },
    },
    rootBranch: {
      id: "root",
      title: "Root",
      createdFrom: { messageId: "root-message" },
      createdAt,
    },
  });

  snapshot.branches.child = branch("child", "root");
  snapshot.canvas = normalizeConversationCanvasState({
    conversation: snapshot.conversation,
    branches: snapshot.branches,
    canvas: snapshot.canvas,
  });

  const canvas = applyCanvasPatch(snapshot, {
    viewport: { x: 120, y: -40, zoom: 1.2 },
    focusedBranchId: "child",
    nodes: {
      child: {
        x: 640,
        y: 180,
        width: 820,
        height: 560,
        folded: true,
        expanded: true,
      },
    },
  });

  assert.deepEqual(canvas.viewport, {
    x: 120,
    y: -40,
    zoom: 1.2,
  });
  assert.equal(canvas.focusedBranchId, "child");
  assert.deepEqual(canvas.nodes.child, {
    branchId: "child",
    x: 640,
    y: 180,
    width: 820,
    height: 560,
    folded: true,
    expanded: true,
  });
  assert.deepEqual(canvas.nodes.root, {
    branchId: "root",
    x: 0,
    y: 0,
    folded: false,
    expanded: true,
  });
});

test("focused child layout aligns the new child and compacts existing siblings", () => {
  const snapshot = createConversationSnapshot({
    id: "conversation",
    createdAt,
    settings: {
      model: "gpt-5.6-terra",
      temperature: 0,
      composerDefaults: { preset: "fast", tools: ["web-search"] },
    },
    rootBranch: {
      id: "root",
      title: "Root",
      createdFrom: { messageId: "root-message" },
      createdAt,
    },
  });
  snapshot.branches.existing = branch("existing", "root");
  snapshot.branches.created = branch("created", "root");
  snapshot.canvas = applyCanvasPatch(snapshot, {
    nodes: {
      root: { x: 200, y: 100, width: 820 },
      existing: { x: 1120, y: 460, expanded: true },
    },
  });

  assert.deepEqual(placeNewBranchOnCanvas(snapshot, "root", "created"), {
    x: 1130,
    y: 100,
  });
  assert.deepEqual(arrangeFocusedChildOnCanvas(snapshot, "root", "created"), {
    existing: { expanded: false, y: 492 },
    root: { expanded: true },
    created: { x: 1130, y: 100, expanded: true },
  });
});

test("Codex inference pointers survive validation and cloning without becoming canonical state", () => {
  const snapshot = createConversationSnapshot({
    id: "conversation",
    createdAt,
    settings: {
      model: "gpt-5.6-terra",
      temperature: 0,
      composerDefaults: { preset: "fast", tools: [] },
    },
    rootBranch: {
      id: "root",
      title: "Root",
      createdFrom: { messageId: "root-message" },
      createdAt,
    },
    initialMessages: [
      {
        id: "assistant-message",
        branchId: "root",
        role: "assistant",
        content: "Answer",
        createdAt,
        inferenceContext: {
          provider: "codex",
          threadId: "thread-source",
          turnId: "turn-source",
        },
      },
    ],
  });
  snapshot.branches.root.inferenceContext = {
    provider: "codex",
    threadId: "thread-source",
    lastTurnId: "turn-source",
  };

  const validated = validateConversationGraphSnapshot(snapshot);
  const cloned = cloneConversationSnapshot(validated);

  assert.deepEqual(cloned.branches.root.inferenceContext, {
    provider: "codex",
    threadId: "thread-source",
    lastTurnId: "turn-source",
  });
  assert.deepEqual(cloned.messages["assistant-message"].inferenceContext, {
    provider: "codex",
    threadId: "thread-source",
    turnId: "turn-source",
  });
  assert.notEqual(
    cloned.branches.root.inferenceContext,
    validated.branches.root.inferenceContext,
  );
  assert.notEqual(
    cloned.messages["assistant-message"].inferenceContext,
    validated.messages["assistant-message"].inferenceContext,
  );
});

test("snapshot validation rejects inference pointers on user messages", () => {
  const snapshot = createConversationSnapshot({
    id: "conversation",
    createdAt,
    settings: {
      model: "gpt-5.6-terra",
      temperature: 0,
      composerDefaults: { preset: "fast", tools: [] },
    },
    rootBranch: {
      id: "root",
      title: "Root",
      createdFrom: { messageId: "root-message" },
      createdAt,
    },
    initialMessages: [message("user-message", "root")],
  });
  (
    snapshot.messages["user-message"] as unknown as Record<string, unknown>
  ).inferenceContext = {
    provider: "codex",
    threadId: "thread-source",
    turnId: "turn-source",
  };

  assert.throws(() => validateConversationGraphSnapshot(snapshot), {
    message: "only assistant messages may have inferenceContext",
  });
});
