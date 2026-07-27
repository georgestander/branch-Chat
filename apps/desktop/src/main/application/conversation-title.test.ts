import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_CONVERSATION_TITLE,
  conversationTitlePrompt,
  fallbackConversationTitle,
  sanitizeGeneratedConversationTitle,
} from "./conversation-title.ts";

test("derives a compact fallback title from the first user message", () => {
  assert.equal(
    fallbackConversationTitle(
      "  Explain why the sky is blue. Include the physics in detail. ",
    ),
    "Explain why the sky is blue",
  );
  assert.equal(fallbackConversationTitle("   "), DEFAULT_CONVERSATION_TITLE);
  assert.ok(
    fallbackConversationTitle(
      "Draft a detailed launch plan for the new customer onboarding workflow and its supporting documentation",
    ).length <= 60,
  );
});

test("sanitizes model output into a single bounded title", () => {
  assert.equal(
    sanitizeGeneratedConversationTitle('Title: "Blue Sky Physics."\nExtra'),
    "Blue Sky Physics",
  );
  assert.equal(
    sanitizeGeneratedConversationTitle("New conversation"),
    null,
  );
  assert.equal(sanitizeGeneratedConversationTitle(" \n "), null);
});

test("bounds the title prompt while retaining both sides of the exchange", () => {
  const prompt = conversationTitlePrompt("U".repeat(2_000), "A".repeat(2_000));
  assert.match(prompt, /User: U{1200}/u);
  assert.match(prompt, /Assistant: A{1200}/u);
  assert.ok(prompt.length < 2_500);
});
