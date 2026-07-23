import assert from "node:assert/strict";
import test from "node:test";

import type { ConversationGraphSnapshot, Message } from "@branchy/conversation-core";

import { renderMessagesByBranch } from "./presentation.ts";

function snapshotWithMessages(...messages: Message[]): ConversationGraphSnapshot {
  return {
    conversation: {
      id: "conversation-1",
      rootBranchId: "root",
      createdAt: "2026-07-23T00:00:00.000Z",
      settings: {
        model: "gpt-5.6-terra",
        temperature: 1,
        reasoningEffort: "medium",
        composerDefaults: { preset: "fast", tools: [] },
      },
    },
    branches: {
      root: {
        id: "root",
        parentId: null,
        title: "Root",
        createdFrom: { messageId: "source" },
        messageIds: messages.map((message) => message.id),
        createdAt: "2026-07-23T00:00:00.000Z",
      },
    },
    messages: Object.fromEntries(messages.map((message) => [message.id, message])),
    canvas: {
      version: 2,
      viewport: { x: 0, y: 0, zoom: 1 },
      focusedBranchId: "root",
      nodes: {
        root: {
          branchId: "root",
          x: 0,
          y: 0,
          folded: false,
          expanded: true,
        },
      },
    },
  };
}

test("bootstrap rendering drops blank active assistant placeholders", () => {
  const userMessage: Message = {
    id: "user-1",
    branchId: "root",
    role: "user",
    content: "Make an image",
    createdAt: "2026-07-23T00:00:00.000Z",
  };
  const pendingAssistant: Message = {
    id: "assistant-1",
    branchId: "root",
    role: "assistant",
    content: "",
    createdAt: "2026-07-23T00:00:01.000Z",
    toolInvocations: [
      {
        id: "image-call-1",
        toolName: "Image generation",
        toolType: "image_generation",
        status: "running",
        startedAt: "2026-07-23T00:00:01.000Z",
      },
    ],
  };

  const rendered = renderMessagesByBranch(
    snapshotWithMessages(userMessage, pendingAssistant),
    {
      activeStreams: [
        {
          streamId: "stream-1",
          branchId: "root",
          assistantMessageId: pendingAssistant.id,
        },
      ],
    },
  );

  assert.deepEqual(rendered.root?.map((message) => message.id), [userMessage.id]);
});

test("bootstrap rendering preserves persisted assistant content", () => {
  const assistant: Message = {
    id: "assistant-1",
    branchId: "root",
    role: "assistant",
    content: "Here is the finished result.",
    createdAt: "2026-07-23T00:00:01.000Z",
  };

  const rendered = renderMessagesByBranch(
    snapshotWithMessages(assistant),
    {
      activeStreams: [
        {
          streamId: "stream-1",
          branchId: "root",
          assistantMessageId: assistant.id,
        },
      ],
    },
  );

  assert.deepEqual(rendered.root?.map((message) => message.id), [assistant.id]);
  assert.equal(rendered.root?.[0]?.content, assistant.content);
});
