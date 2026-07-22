import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  Branch,
  ConversationGraphSnapshot,
  Message,
  MessageAttachment,
} from "../../lib/conversation/model.ts";
import {
  getBoundedBranchRecoveryMessages,
  getEffectiveBranchAttachmentIds,
  getEffectiveBranchMessages,
} from "./conversationContext.ts";

const createdAt = "2026-07-22T00:00:00.000Z";

function attachment(id: string): MessageAttachment {
  return {
    id,
    kind: "file",
    name: `${id}.txt`,
    contentType: "text/plain",
    size: 10,
    storageKey: `attachments/${id}.txt`,
    uploadedAt: createdAt,
  };
}

function message(options: {
  id: string;
  branchId: string;
  content?: string;
  attachmentIds?: string[];
}): Message {
  return {
    id: options.id,
    branchId: options.branchId,
    role: "user",
    content: options.content ?? options.id,
    createdAt,
    attachments: options.attachmentIds?.map(attachment) ?? null,
  };
}

function branch(options: {
  id: string;
  parentId?: string | null;
  sourceMessageId: string;
  messageIds: string[];
}): Branch {
  return {
    id: options.id,
    parentId: options.parentId ?? null,
    title: options.id,
    createdFrom: { messageId: options.sourceMessageId },
    messageIds: options.messageIds,
    createdAt,
  };
}

function fixture(): ConversationGraphSnapshot {
  const messages = [
    message({ id: "root-1", branchId: "root", attachmentIds: ["root-a"] }),
    message({
      id: "root-2",
      branchId: "root",
      attachmentIds: ["root-cutoff", "shared"],
    }),
    message({ id: "root-3", branchId: "root", attachmentIds: ["root-late"] }),
    message({ id: "root-4", branchId: "root" }),
    message({ id: "child-1", branchId: "child", attachmentIds: ["child-a"] }),
    message({
      id: "child-2",
      branchId: "child",
      attachmentIds: ["shared", "child-cutoff"],
    }),
    message({ id: "child-3", branchId: "child", attachmentIds: ["child-late"] }),
    message({ id: "grand-1", branchId: "grand", attachmentIds: ["grand-a"] }),
    message({ id: "sibling-1", branchId: "sibling", attachmentIds: ["sibling-a"] }),
  ];

  return {
    conversation: {
      id: "conversation",
      rootBranchId: "root",
      createdAt,
      settings: {
        model: "gpt-5.6-terra",
        temperature: 0,
        composerDefaults: { preset: "fast", tools: [] },
      },
    },
    branches: {
      root: branch({
        id: "root",
        sourceMessageId: "root-1",
        messageIds: ["root-1", "root-2", "root-3", "root-4"],
      }),
      child: branch({
        id: "child",
        parentId: "root",
        sourceMessageId: "root-2",
        messageIds: ["child-1", "child-2", "child-3"],
      }),
      grand: branch({
        id: "grand",
        parentId: "child",
        sourceMessageId: "child-2",
        messageIds: ["grand-1"],
      }),
      sibling: branch({
        id: "sibling",
        parentId: "root",
        sourceMessageId: "root-4",
        messageIds: ["sibling-1"],
      }),
    },
    messages: Object.fromEntries(messages.map((entry) => [entry.id, entry])),
    canvas: {
      version: 2,
      viewport: { x: 0, y: 0, zoom: 1 },
      focusedBranchId: "root",
      nodes: {},
    },
  };
}

function ids(messages: Message[]): string[] {
  return messages.map((entry) => entry.id);
}

test("root context includes every root message in branch order", () => {
  assert.deepEqual(ids(getEffectiveBranchMessages(fixture(), "root")), [
    "root-1",
    "root-2",
    "root-3",
    "root-4",
  ]);
});

test("deep child context applies the exact source cutoff at every ancestor", () => {
  assert.deepEqual(ids(getEffectiveBranchMessages(fixture(), "grand")), [
    "root-1",
    "root-2",
    "child-1",
    "child-2",
    "grand-1",
  ]);
});

test("deep child attachment inheritance excludes later ancestor attachments", () => {
  assert.deepEqual(getEffectiveBranchAttachmentIds(fixture(), "grand"), [
    "root-a",
    "root-cutoff",
    "shared",
    "child-a",
    "child-cutoff",
    "grand-a",
  ]);
});

test("branch attachment inheritance excludes sibling attachments", () => {
  assert.equal(
    getEffectiveBranchAttachmentIds(fixture(), "child").includes("sibling-a"),
    false,
  );
});

test("target branch contributes attachments from all of its current messages", () => {
  const attachmentIds = getEffectiveBranchAttachmentIds(fixture(), "child");
  assert.equal(attachmentIds.includes("child-a"), true);
  assert.equal(attachmentIds.includes("child-cutoff"), true);
  assert.equal(attachmentIds.includes("child-late"), true);
});

test("recovery context keeps newest lineage messages within strict limits", () => {
  const snapshot = fixture();
  const recovery = getBoundedBranchRecoveryMessages({
    snapshot,
    branchId: "grand",
    maxMessages: 3,
    maxCharacters: 16,
  });

  assert.deepEqual(ids(recovery), ["child-1", "child-2", "grand-1"]);
  assert.equal(
    recovery.reduce((total, entry) => total + entry.content.length, 0),
    16,
  );
  assert.equal(recovery[0]?.content, "c…");
});
