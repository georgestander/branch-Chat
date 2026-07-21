import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createConversationSnapshot,
  deleteBranchSubtree,
  type Branch,
  type Message,
} from "./model.ts";

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
