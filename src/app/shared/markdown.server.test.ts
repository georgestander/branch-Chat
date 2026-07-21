import assert from "node:assert/strict";
import { test } from "node:test";

import {
  enrichMessagesWithHtml,
  renderMarkdownToHtml,
} from "./markdown.server.ts";
import type { Message } from "../../lib/conversation/model.ts";

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
        title: "Span child",
        excerpt: "Alpha",
        range: { start: 0, end: 5 },
      },
      {
        messageId: message.id,
        branchId: "child-message",
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
