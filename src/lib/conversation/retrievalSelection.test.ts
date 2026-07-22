import assert from "node:assert/strict";
import test from "node:test";

import { selectAttachmentMatchesWithRequiredCoverage } from "./retrievalSelection.ts";

const rankedMatches = [
  { chunk: { id: "a-1", attachmentId: "a" }, similarity: 0.9 },
  { chunk: { id: "a-2", attachmentId: "a" }, similarity: 0.8 },
  { chunk: { id: "b-1", attachmentId: "b" }, similarity: 0.2 },
];

test("required attachments receive one source before relevance fills the limit", () => {
  const selected = selectAttachmentMatchesWithRequiredCoverage({
    rankedMatches,
    limit: 2,
    requiredAttachmentIds: ["b"],
  });

  assert.deepEqual(
    selected.matches.map((match) => match.chunk.id),
    ["b-1", "a-1"],
  );
  assert.deepEqual(selected.missingRequiredAttachmentIds, []);
});

test("reports required attachments whose readable chunks are unavailable", () => {
  const selected = selectAttachmentMatchesWithRequiredCoverage({
    rankedMatches,
    limit: 1,
    requiredAttachmentIds: ["missing", "b"],
  });

  assert.deepEqual(
    selected.matches.map((match) => match.chunk.id),
    ["b-1", "a-1"],
  );
  assert.deepEqual(selected.missingRequiredAttachmentIds, ["missing"]);
});

test("a zero limit returns no optional sources", () => {
  const selected = selectAttachmentMatchesWithRequiredCoverage({
    rankedMatches,
    limit: 0,
    requiredAttachmentIds: [],
  });
  assert.deepEqual(selected.matches, []);
});
