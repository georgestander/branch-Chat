import assert from "node:assert/strict";
import test from "node:test";

import type {
  Branch,
  ConversationGraphSnapshot,
  Message,
} from "@branchy/conversation-core";

import {
  descendantCount,
  initialStreamState,
  isStreamActive,
  mergeRenderedMessage,
  removeStreamStateIfMatching,
  reduceStreamState,
  retainBranchRecords,
  visibleBranchIds,
} from "./state.ts";

function branch(
  id: string,
  parentId: string | null,
  messageIds: string[] = [],
): Branch {
  return {
    id,
    parentId,
    title: id,
    createdFrom: { messageId: "source" },
    messageIds,
    createdAt: `2026-07-23T00:00:0${id.length}.000Z`,
  };
}

function snapshot(): ConversationGraphSnapshot {
  return {
    conversation: {
      id: "conversation",
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
      root: branch("root", null),
      child: branch("child", "root"),
      grandchild: branch("grandchild", "child"),
      sibling: branch("sibling", "root"),
    },
    messages: {},
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
        child: {
          branchId: "child",
          x: 420,
          y: 0,
          folded: true,
          expanded: false,
        },
        grandchild: {
          branchId: "grandchild",
          x: 840,
          y: 0,
          folded: false,
          expanded: false,
        },
        sibling: {
          branchId: "sibling",
          x: 420,
          y: 220,
          folded: false,
          expanded: false,
        },
      },
    },
  };
}

test("folded branches hide descendants without hiding siblings", () => {
  assert.deepEqual(
    [...visibleBranchIds(snapshot())].sort(),
    ["child", "root", "sibling"],
  );
  assert.equal(descendantCount(snapshot(), "root"), 3);
  assert.equal(descendantCount(snapshot(), "child"), 1);
});

test("stream state retains deltas through image progress and completion", () => {
  const opened = reduceStreamState(initialStreamState("stream", "root"), {
    type: "opened",
  });
  const withText = reduceStreamState(opened, {
    type: "delta",
    delta: "A useful answer",
  });
  const generating = reduceStreamState(withText, {
    type: "tool_progress",
    toolType: "image_generation",
    label: "Creating your image",
  });
  const imageReady = reduceStreamState(generating, {
    type: "image_ready",
    imageId: "image-1",
    url: "branchy://asset/image-1",
  });
  const complete = reduceStreamState(imageReady, { type: "complete" });

  assert.equal(generating.status, "generating_image");
  assert.equal(imageReady.status, "saving_image");
  assert.equal(isStreamActive(imageReady), true);
  assert.equal(complete.status, "complete");
  assert.equal(complete.text, "A useful answer");
  assert.equal(complete.imageUrl, "branchy://asset/image-1");
});

test("terminal streams allow a retry while active streams block it", () => {
  const starting = initialStreamState("stream", "root");
  assert.equal(isStreamActive(starting), true);
  assert.equal(
    isStreamActive({ ...starting, status: "generating_image" }),
    true,
  );
  assert.equal(isStreamActive({ ...starting, status: "error" }), false);
  assert.equal(isStreamActive({ ...starting, status: "cancelled" }), false);
  assert.equal(isStreamActive({ ...starting, status: "complete" }), false);
  assert.equal(isStreamActive(undefined), false);
});

test("late completion cleanup cannot remove a newer branch stream", () => {
  const oldStream = initialStreamState("old-stream", "root");
  const newStream = initialStreamState("new-stream", "root");

  assert.equal(
    removeStreamStateIfMatching({ root: newStream }, "root", "old-stream")
      .root,
    newStream,
  );
  assert.deepEqual(
    removeStreamStateIfMatching({ root: oldStream }, "root", "old-stream"),
    {},
  );
});

test("same-conversation reloads retain only live branch composer state", () => {
  assert.deepEqual(
    retainBranchRecords(
      { root: "root draft", child: "child draft", removed: "stale" },
      snapshot().branches,
    ),
    { root: "root draft", child: "child draft" },
  );
});

test("canonical completion messages replace optimistic entries", () => {
  const optimistic: Message = {
    id: "assistant-1",
    branchId: "root",
    role: "assistant",
    content: "Partial",
    createdAt: "2026-07-23T00:00:00.000Z",
  };
  const complete: Message = { ...optimistic, content: "Complete" };
  const merged = mergeRenderedMessage(
    [
      {
        ...optimistic,
        renderedHtml: "",
        hasBranchHighlight: false,
        branchAnchors: [],
      },
    ],
    complete,
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.content, "Complete");
});
