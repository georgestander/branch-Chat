import assert from "node:assert/strict";
import { test } from "node:test";

import type { ToolInvocation } from "./model.ts";
import {
  attachmentCitationFragmentId,
  extractAttachmentCitationSources,
} from "./attachmentCitations.ts";

test("extracts deterministic validated attachment citation sources", () => {
  const invocations: ToolInvocation[] = [
    {
      id: "retrieval-1",
      toolType: "attachment_retrieval",
      status: "succeeded",
      startedAt: "2026-07-22T00:00:00.000Z",
      output: {
        sources: [
          {
            id: "A2",
            attachmentId: "attachment-2",
            name: "second.txt",
            pageNumber: -1,
            excerpt: "Second source",
          },
          {
            id: "A1",
            attachmentId: "attachment-1",
            name: "first.pdf",
            pageNumber: 3,
            excerpt: "First source",
            contentType: "application/pdf",
          },
          {
            id: "not-a-citation",
            attachmentId: "attachment-3",
            name: "ignored.txt",
            excerpt: "Ignored source",
          },
        ],
      },
    },
    {
      id: "retrieval-2",
      toolType: "attachment_retrieval",
      status: "succeeded",
      startedAt: "2026-07-22T00:00:01.000Z",
      output: {
        sources: [
          {
            id: "A1",
            attachmentId: "duplicate",
            name: "duplicate.pdf",
            excerpt: "Duplicate source",
          },
          {
            id: "A3",
            attachmentId: "attachment-3",
            name: "missing-excerpt.txt",
            excerpt: "",
          },
        ],
      },
    },
    {
      id: "web-1",
      toolType: "web_search",
      status: "succeeded",
      startedAt: "2026-07-22T00:00:02.000Z",
      output: { sources: [] },
    },
  ];

  assert.deepEqual(extractAttachmentCitationSources(invocations), [
    {
      id: "A1",
      attachmentId: "attachment-1",
      name: "first.pdf",
      pageNumber: 3,
      excerpt: "First source",
      contentType: "application/pdf",
    },
    {
      id: "A2",
      attachmentId: "attachment-2",
      name: "second.txt",
      pageNumber: null,
      excerpt: "Second source",
      contentType: null,
    },
  ]);
});

test("creates stable message-scoped fragment ids", () => {
  const first = attachmentCitationFragmentId("message/one", "A1");
  const repeated = attachmentCitationFragmentId("message/one", "A1");
  const second = attachmentCitationFragmentId("message/two", "A1");

  assert.equal(first, repeated);
  assert.notEqual(first, second);
  assert.match(first, /^attachment-source-[a-z0-9_-]+-a1$/);
  assert.equal(
    attachmentCitationFragmentId(undefined, "A2"),
    "attachment-source-a2",
  );
});
