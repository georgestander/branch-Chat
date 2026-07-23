import assert from "node:assert/strict";
import test from "node:test";

import {
  cloneConversationSnapshot,
  createConversationSnapshot,
  type Branch,
  type ConversationGraphSnapshot,
  type ConversationGraphUpdate,
  type Message,
} from "./model.ts";
import { applyConversationGraphUpdates } from "./updates.ts";

const createdAt = "2026-07-23T00:00:00.000Z";

function fixture(): ConversationGraphSnapshot {
  return createConversationSnapshot({
    id: "conversation-1",
    createdAt,
    settings: {
      model: "gpt-5.6-terra",
      temperature: 0,
      composerDefaults: { preset: "fast", tools: [] },
    },
    rootBranch: {
      id: "root",
      title: "Root",
      createdAt,
      createdFrom: { messageId: "origin" },
    },
  });
}

function childBranch(): Branch {
  return {
    id: "child",
    parentId: "root",
    title: "Child",
    createdFrom: { messageId: "message-1" },
    messageIds: [],
    createdAt,
  };
}

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: "message-1",
    branchId: "root",
    role: "user",
    content: "Hello",
    createdAt,
    ...overrides,
  };
}

test("initializes and applies the complete ordered update batch", () => {
  const base = fixture();
  const updates: ConversationGraphUpdate[] = [
    { type: "conversation:update", conversation: base.conversation },
    {
      type: "branch:create",
      conversationId: base.conversation.id,
      branch: base.branches.root!,
    },
    {
      type: "message:append",
      conversationId: base.conversation.id,
      message: message(),
    },
  ];

  const result = applyConversationGraphUpdates(null, updates, {
    allowMissing: true,
  });
  assert.equal(result.messages["message-1"]?.content, "Hello");
  assert.deepEqual(result.branches.root?.messageIds, ["message-1"]);
});

test("applies every graph update variant without mutating its inputs", () => {
  const original = fixture();
  const originalClone = cloneConversationSnapshot(original);
  const branch = childBranch();
  const firstMessage = message();
  const updates: ConversationGraphUpdate[] = [
    {
      type: "message:append",
      conversationId: "conversation-1",
      message: firstMessage,
    },
    {
      type: "branch:create",
      conversationId: "conversation-1",
      branch,
    },
    {
      type: "branch:update",
      conversationId: "conversation-1",
      branch: { ...branch, title: "Renamed" },
    },
    {
      type: "message:update",
      conversationId: "conversation-1",
      message: { ...firstMessage, content: "Updated" },
    },
    {
      type: "canvas:update",
      conversationId: "conversation-1",
      patch: { focusedBranchId: "child" },
    },
  ];

  const result = applyConversationGraphUpdates(original, updates);
  assert.deepEqual(original, originalClone);
  assert.equal(result.messages["message-1"]?.content, "Updated");
  assert.equal(result.branches.child?.title, "Renamed");
  assert.equal(result.canvas.focusedBranchId, "child");

  const deletedMessage = applyConversationGraphUpdates(result, [
    {
      type: "message:delete",
      conversationId: "conversation-1",
      messageIds: ["message-1"],
    },
  ]);
  assert.equal(deletedMessage.messages["message-1"], undefined);
  assert.deepEqual(deletedMessage.branches.root?.messageIds, []);

  const deletedBranch = applyConversationGraphUpdates(deletedMessage, [
    {
      type: "branch:delete",
      conversationId: "conversation-1",
      branchId: "child",
    },
  ]);
  assert.equal(deletedBranch.branches.child, undefined);
});

test("message append is idempotent in branch ordering", () => {
  const initial = fixture();
  const update: ConversationGraphUpdate = {
    type: "message:append",
    conversationId: "conversation-1",
    message: message(),
  };
  const result = applyConversationGraphUpdates(
    applyConversationGraphUpdates(initial, [update]),
    [update],
  );
  assert.deepEqual(result.branches.root?.messageIds, ["message-1"]);
});

test("rejects invalid or cross-conversation updates", () => {
  assert.throws(
    () => applyConversationGraphUpdates(null, [], { allowMissing: true }),
    /Missing conversation data/,
  );
  assert.throws(
    () =>
      applyConversationGraphUpdates(fixture(), [
        {
          type: "message:append",
          conversationId: "other",
          message: message(),
        },
      ]),
    /does not match/,
  );
  assert.throws(
    () =>
      applyConversationGraphUpdates(fixture(), [
        {
          type: "message:update",
          conversationId: "conversation-1",
          message: message(),
        },
      ]),
    /missing message/,
  );
});
