import assert from "node:assert/strict";
import test from "node:test";

import { prepareAttachmentGrounding } from "./attachmentGrounding.ts";

test("prepares attachment-only grounding with matching in-body citation ids", () => {
  const prepared = prepareAttachmentGrounding({
    blocks: [
      {
        id: "attachment-1:page-3:chunk-1",
        type: "attachment",
        attachmentId: "attachment-1",
        title: "runbook.pdf",
        content: "Approval is required before execution.",
        relevance: 0.8,
        metadata: {
          fileName: "runbook.pdf",
          contentType: "application/pdf",
          pageNumber: 3,
          sourceId: "attachment-1:page-3:chunk-1",
        },
      },
      {
        id: "web-1",
        type: "web",
        title: "External result",
        content: "Web evidence",
        relevance: 0.7,
        metadata: { url: "https://example.com" },
      },
      {
        id: "attachment-2:section-1:chunk-1",
        type: "attachment",
        attachmentId: "attachment-2",
        title: "notes.txt",
        content: "The bounded workflow has one controlled step.",
        relevance: 0.6,
        metadata: {
          fileName: "notes.txt",
          contentType: "text/plain",
          sourceId: "attachment-2:section-1:chunk-1",
        },
      },
    ],
    invocationId: "retrieval-1",
    timestamp: "2026-07-22T00:00:00.000Z",
  });

  assert(prepared);
  assert.match(prepared.prompt, /\[A1\] Attachment: runbook\.pdf, page 3/);
  assert.match(prepared.prompt, /\[A2\] Attachment: notes\.txt/);
  assert.doesNotMatch(prepared.prompt, /External result/);
  assert.deepEqual(
    prepared.sources.map((source) => ({
      id: source.id,
      attachmentId: source.attachmentId,
      sourceId: source.sourceId,
    })),
    [
      {
        id: "A1",
        attachmentId: "attachment-1",
        sourceId: "attachment-1:page-3:chunk-1",
      },
      {
        id: "A2",
        attachmentId: "attachment-2",
        sourceId: "attachment-2:section-1:chunk-1",
      },
    ],
  );
  assert.equal(prepared.invocation.toolType, "attachment_retrieval");
  assert.deepEqual(prepared.invocation.output, {
    sources: prepared.sources,
  });
});

test("does not create a retrieval invocation without attachment evidence", () => {
  assert.equal(
    prepareAttachmentGrounding({
      blocks: [],
      invocationId: "retrieval-empty",
      timestamp: "2026-07-22T00:00:00.000Z",
    }),
    null,
  );
});
