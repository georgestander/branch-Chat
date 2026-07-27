import assert from "node:assert/strict";
import test from "node:test";

import type { Message } from "@branchy/conversation-core";

import {
  copyTextToClipboard,
  formatConversationThread,
} from "./conversation-copy.ts";

const createdAt = "2026-07-27T00:00:00.000Z";

function message(
  id: string,
  role: Message["role"],
  content: string,
): Message {
  return {
    id,
    branchId: "branch",
    role,
    content,
    createdAt,
  };
}

test("copies the exact output text and reports unavailable clipboards", async () => {
  const writes: string[] = [];
  const copied = await copyTextToClipboard("  exact markdown\n", {
    writeText: async (text) => {
      writes.push(text);
    },
  });

  assert.equal(copied, true);
  assert.deepEqual(writes, ["  exact markdown\n"]);
  assert.equal(await copyTextToClipboard("answer", null), false);
  assert.equal(
    await copyTextToClipboard("answer", {
      writeText: async () => {
        throw new Error("clipboard unavailable");
      },
    }),
    false,
  );
});

test("formats one readable active thread in canonical message order", () => {
  const user = message("user", "user", "Ask **this**.");
  user.attachments = [
    {
      id: "attachment",
      kind: "file",
      name: "brief.pdf",
      contentType: "application/pdf",
      size: 12,
      storageKey: "attachments/brief.pdf",
      uploadedAt: createdAt,
    },
  ];

  assert.equal(
    formatConversationThread({
      title: "  Branch decision  ",
      messages: [
        user,
        message("assistant", "assistant", "Use the active lineage."),
        message("empty", "assistant", "   "),
      ],
      pendingAssistantText: "A response still streaming",
    }),
    [
      "# Branch decision",
      "## User\nAsk **this**.\n\n[Attachment: brief.pdf]",
      "## Assistant\nUse the active lineage.",
      "## Assistant\nA response still streaming",
    ].join("\n\n"),
  );
});
