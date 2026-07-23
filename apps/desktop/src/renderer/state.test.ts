import assert from "node:assert/strict";
import test from "node:test";

import type {
  Branch,
  ConversationGraphSnapshot,
  Message,
} from "@branchy/conversation-core";

import {
  branchToFocusBeforeFold,
  descendantCount,
  initialStreamState,
  isBranchDescendant,
  isSupersededByActiveStream,
  isStreamActive,
  latestUserPrompt,
  mergeRenderedMessage,
  parentComparisonForBranch,
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

test("latest user prompt ignores assistant output and empty prompts", () => {
  assert.equal(
    latestUserPrompt([
      { role: "user", content: "First prompt" },
      { role: "assistant", content: "First answer" },
      { role: "user", content: "  " },
      { role: "user", content: "  Try this again  " },
      { role: "assistant", content: "Partial answer" },
    ]),
    "Try this again",
  );
  assert.equal(
    latestUserPrompt([{ role: "assistant", content: "Only an answer" }]),
    "",
  );
});

test("branch ancestry is cycle-safe and excludes the branch itself", () => {
  const graph = snapshot();
  assert.equal(isBranchDescendant(graph, "root", "grandchild"), true);
  assert.equal(isBranchDescendant(graph, "child", "grandchild"), true);
  assert.equal(isBranchDescendant(graph, "child", "sibling"), false);
  assert.equal(isBranchDescendant(graph, "child", "child"), false);
  assert.equal(isBranchDescendant(graph, "missing", "grandchild"), false);

  graph.branches.root!.parentId = "grandchild";
  assert.equal(isBranchDescendant(graph, "sibling", "grandchild"), false);
});

test("folding an active branch ancestor first focuses that ancestor", () => {
  const graph = snapshot();
  graph.canvas.nodes.child!.folded = false;

  assert.equal(
    branchToFocusBeforeFold(graph, "child", "grandchild"),
    "child",
  );
  assert.equal(branchToFocusBeforeFold(graph, "root", "sibling"), "root");
  assert.equal(branchToFocusBeforeFold(graph, "child", "sibling"), null);

  graph.canvas.nodes.child!.folded = true;
  assert.equal(
    branchToFocusBeforeFold(graph, "child", "grandchild"),
    null,
  );
});

test("parent comparison resolves both rendered paths and the fork source", () => {
  const graph = snapshot();
  const parentMessage: Message = {
    id: "parent-message",
    branchId: "root",
    role: "assistant",
    content: "A parent answer",
    createdAt: "2026-07-23T00:00:05.000Z",
  };
  const childMessage: Message = {
    id: "child-message",
    branchId: "child",
    role: "user",
    content: "Take this elsewhere",
    createdAt: "2026-07-23T00:00:06.000Z",
  };
  graph.messages[parentMessage.id] = parentMessage;
  graph.messages[childMessage.id] = childMessage;
  graph.branches.root!.messageIds = [parentMessage.id];
  graph.branches.child!.messageIds = [childMessage.id];
  graph.branches.child!.createdFrom = {
    messageId: parentMessage.id,
    excerpt: "parent answer",
    span: { start: 2, end: 15 },
  };

  const comparison = parentComparisonForBranch(graph, {}, "child");
  assert.equal(comparison?.parent.branch.id, "root");
  assert.deepEqual(
    comparison?.parent.messages.map((message) => message.id),
    ["parent-message"],
  );
  assert.deepEqual(
    comparison?.child.messages.map((message) => message.id),
    ["child-message"],
  );
  assert.equal(comparison?.sourceMessage?.content, "A parent answer");
  assert.equal(
    parentComparisonForBranch(graph, { root: [] }, "child")
      ?.sourceMessage?.content,
    "A parent answer",
  );
  assert.equal(parentComparisonForBranch(graph, {}, "root"), null);
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

test("active bootstrap streams suppress only their blank assistant placeholder", () => {
  const stream = initialStreamState("stream", "root", "assistant-1");
  const userMessage: Message = {
    id: "user-1",
    branchId: "root",
    role: "user",
    content: "Prompt",
    createdAt: "2026-07-23T00:00:00.000Z",
  };
  const blankAssistant: Message = {
    id: "assistant-1",
    branchId: "root",
    role: "assistant",
    content: "",
    createdAt: "2026-07-23T00:00:01.000Z",
  };
  const completeAssistant: Message = {
    ...blankAssistant,
    content: "Done",
  };

  assert.equal(isSupersededByActiveStream(userMessage, stream), false);
  assert.equal(isSupersededByActiveStream(blankAssistant, stream), true);
  assert.equal(isSupersededByActiveStream(completeAssistant, stream), false);
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
