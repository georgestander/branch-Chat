import assert from "node:assert/strict";
import test from "node:test";

import { createBranchSelectionDraft } from "./branch-selection.ts";

test("assistant text selection creates one exact temporary branch draft", () => {
  assert.deepEqual(
    createBranchSelectionDraft({
      branchId: "root",
      messageId: "assistant-1",
      role: "assistant",
      selectedText: "  branch this idea \n",
      sourceSpan: { start: 8, end: 28 },
    }),
    {
      parentBranchId: "root",
      messageId: "assistant-1",
      excerpt: "branch this idea",
      span: { start: 10, end: 26 },
    },
  );
});

test("user text and whitespace cannot create temporary branch drafts", () => {
  assert.equal(
    createBranchSelectionDraft({
      branchId: "root",
      messageId: "user-1",
      role: "user",
      selectedText: "Do not branch",
      sourceSpan: { start: 0, end: 13 },
    }),
    null,
  );
  assert.equal(
    createBranchSelectionDraft({
      branchId: "root",
      messageId: "assistant-1",
      role: "assistant",
      selectedText: " \n\t",
      sourceSpan: { start: 4, end: 7 },
    }),
    null,
  );
});
