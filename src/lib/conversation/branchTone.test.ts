import assert from "node:assert/strict";
import test from "node:test";

import {
  BRANCH_TONES,
  branchLineageId,
  branchToneForBranch,
  branchToneForId,
} from "./branchTone.ts";
import { createConversationSnapshot } from "./model.ts";

test("branch tones are stable and drawn from the relationship palette", () => {
  const first = branchToneForId("branch-example");
  const second = branchToneForId("branch-example");

  assert.deepEqual(first, second);
  assert.ok(BRANCH_TONES.some((tone) => tone.key === first.key));
});

test("each nested branch keeps a stable tone distinct from its parent", () => {
  const snapshot = createConversationSnapshot({
    id: "conversation",
    createdAt: "2026-07-21T00:00:00.000Z",
    settings: {
      model: "gpt-5.6-terra",
      temperature: 0,
      composerDefaults: { preset: "fast", tools: ["web-search"] },
    },
    rootBranch: {
      id: "root",
      title: "Root",
      createdFrom: { messageId: "root-message" },
      createdAt: "2026-07-21T00:00:00.000Z",
    },
  });
  snapshot.branches.child = {
    id: "child",
    parentId: "root",
    title: "Child",
    createdFrom: { messageId: "root-message" },
    messageIds: [],
    createdAt: "2026-07-21T00:01:00.000Z",
  };
  snapshot.branches.grandchild = {
    id: "grandchild",
    parentId: "child",
    title: "Grandchild",
    createdFrom: { messageId: "child-message" },
    messageIds: [],
    createdAt: "2026-07-21T00:02:00.000Z",
  };

  assert.equal(branchLineageId(snapshot, "root"), null);
  assert.equal(branchLineageId(snapshot, "grandchild"), "child");
  assert.equal(branchToneForBranch(snapshot, "root"), null);
  assert.notDeepEqual(
    branchToneForBranch(snapshot, "grandchild"),
    branchToneForBranch(snapshot, "child"),
  );
  assert.deepEqual(
    branchToneForBranch(snapshot, "grandchild"),
    branchToneForBranch(snapshot, "grandchild"),
  );
});

test("a child shifts tone when its stable hash collides with its parent", () => {
  const snapshot = createConversationSnapshot({
    id: "conversation",
    createdAt: "2026-07-22T00:00:00.000Z",
    settings: {
      model: "gpt-5.6-terra",
      temperature: 0,
      composerDefaults: { preset: "fast", tools: [] },
    },
    rootBranch: {
      id: "root",
      title: "Root",
      createdFrom: { messageId: "root-message" },
      createdAt: "2026-07-22T00:00:00.000Z",
    },
  });
  snapshot.branches["branch-0"] = {
    id: "branch-0",
    parentId: "root",
    title: "Parent",
    createdFrom: { messageId: "root-message" },
    messageIds: [],
    createdAt: "2026-07-22T00:01:00.000Z",
  };
  snapshot.branches["branch-6"] = {
    id: "branch-6",
    parentId: "branch-0",
    title: "Child",
    createdFrom: { messageId: "parent-message" },
    messageIds: [],
    createdAt: "2026-07-22T00:02:00.000Z",
  };

  assert.deepEqual(branchToneForId("branch-0"), branchToneForId("branch-6"));
  assert.notDeepEqual(
    branchToneForBranch(snapshot, "branch-0"),
    branchToneForBranch(snapshot, "branch-6"),
  );
});
