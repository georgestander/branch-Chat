import assert from "node:assert/strict";
import { test } from "node:test";

import {
  enrichMessagesWithHtml,
  renderMarkdownToHtml,
} from "./markdown.server.ts";
import type { Message } from "../../lib/conversation/model.ts";
import { branchToneForId } from "../../lib/conversation/branchTone.ts";
import { attachmentCitationFragmentId } from "../../lib/conversation/attachmentCitations.ts";

test("renders multiple persistent branch highlights with navigation ids", async () => {
  const html = await renderMarkdownToHtml("Alpha beta gamma delta", {
    highlights: [
      {
        range: { start: 0, end: 5 },
        branchId: "branch-alpha",
        messageId: "message-1",
      },
      {
        range: { start: 11, end: 16 },
        branchId: "branch-gamma",
        messageId: "message-1",
      },
    ],
  });

  assert.match(html, /data-branch-id="branch-alpha"[^>]*>Alpha<\/mark>/);
  assert.match(html, /data-branch-id="branch-gamma"[^>]*>gamma<\/mark>/);
  assert.match(html, /data-message-id="message-1"/);
  assert.match(
    html,
    new RegExp(`data-branch-tone="${branchToneForId("branch-alpha").key}"`),
  );
});

test("keeps span and whole-message branch anchors on rendered messages", async () => {
  const message: Message = {
    id: "message-1",
    branchId: "root",
    role: "assistant",
    content: "Alpha beta gamma",
    createdAt: "2026-07-21T00:00:00.000Z",
    tokenUsage: { prompt: 1, completion: 1, cost: 0 },
    attachments: null,
    toolInvocations: null,
  };
  const [rendered] = await enrichMessagesWithHtml([message], {
    highlights: [
      {
        messageId: message.id,
        branchId: "child-span",
        marker: 1,
        title: "Span child",
        excerpt: "Alpha",
        range: { start: 0, end: 5 },
      },
      {
        messageId: message.id,
        branchId: "child-message",
        marker: 2,
        title: "Message child",
        excerpt: null,
        range: null,
      },
    ],
  });

  assert(rendered);
  assert.equal(rendered.hasBranchHighlight, true);
  assert.deepEqual(
    rendered.branchAnchors.map(({ branchId, range }) => ({ branchId, range })),
    [
      { branchId: "child-span", range: { start: 0, end: 5 } },
      { branchId: "child-message", range: null },
    ],
  );
});

test("renders authenticated generated-image URLs in assistant Markdown", async () => {
  const html = await renderMarkdownToHtml(
    "![Generated image](/_generated-image?conversationId=chat-1&messageId=msg-1&imageId=img-1)",
  );
  assert.match(html, /<img[^>]+alt="Generated image"/);
  assert.match(html, /src="\/_generated-image\?conversationId=chat-1&#x26;messageId=msg-1&#x26;imageId=img-1"/);
});

test("links only allowlisted attachment citations to message-scoped sources", async () => {
  const fragmentId = attachmentCitationFragmentId("message-1", "A1");
  const html = await renderMarkdownToHtml(
    "Grounded claim [A1]. Unknown [A2]. Literal `[A1]`.",
    {
      citationManifest: {
        messageId: "message-1",
        sources: [
          {
            id: "A1",
            attachmentId: "attachment-1",
            name: "architecture.pdf",
            pageNumber: 4,
            excerpt: "A bounded workflow starts with one controlled step.",
            contentType: "application/pdf",
          },
        ],
      },
    },
  );

  assert.match(
    html,
    new RegExp(`href="#${fragmentId}"[^>]*>\\[A1\\]</a>`),
  );
  assert.match(html, /data-attachment-citation-id="A1"/);
  assert.match(html, /Unknown \[A2\]/);
  assert.match(html, /<code>\[A1\]<\/code>/);
  assert.doesNotMatch(html, /data-attachment-citation-id="A2"/);
});

test("enriches persisted attachment citations from retrieval invocations", async () => {
  const message: Message = {
    id: "assistant-attachment-message",
    branchId: "root",
    role: "assistant",
    content: "The runbook requires approval [A1].",
    createdAt: "2026-07-22T00:00:00.000Z",
    tokenUsage: { prompt: 4, completion: 3, cost: 0 },
    attachments: null,
    toolInvocations: [
      {
        id: "retrieval-1",
        toolType: "attachment_retrieval",
        status: "succeeded",
        startedAt: "2026-07-22T00:00:00.000Z",
        completedAt: "2026-07-22T00:00:01.000Z",
        output: {
          sources: [
            {
              id: "A1",
              attachmentId: "attachment-1",
              name: "runbook.pdf",
              pageNumber: 2,
              excerpt: "Approval is required before execution.",
            },
          ],
        },
      },
    ],
  };

  const [rendered] = await enrichMessagesWithHtml([message]);
  const fragmentId = attachmentCitationFragmentId(message.id, "A1");

  assert(rendered);
  assert.match(rendered.renderedHtml, new RegExp(`href="#${fragmentId}"`));
  assert.match(rendered.renderedHtml, />\[A1\]<\/a>/);
});
