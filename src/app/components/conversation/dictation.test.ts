import assert from "node:assert/strict";
import { test } from "node:test";

import { mergeDictationText } from "./dictation.ts";

test("dictation appends reviewable speech without erasing typed text", () => {
  assert.equal(mergeDictationText("Keep this", " and add this "), "Keep this and add this");
  assert.equal(mergeDictationText("", " hello world "), "hello world");
  assert.equal(mergeDictationText("draft ", ""), "draft");
});
