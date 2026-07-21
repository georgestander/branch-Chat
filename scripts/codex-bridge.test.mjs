import assert from "node:assert/strict";
import { test } from "node:test";

import { isLoopback, toHistoryItems } from "./codex-bridge.mjs";

test("bridge accepts only loopback addresses", () => {
  assert.equal(isLoopback("127.0.0.1"), true);
  assert.equal(isLoopback("::1"), true);
  assert.equal(isLoopback("::ffff:127.0.0.1"), true);
  assert.equal(isLoopback("192.168.1.20"), false);
});

test("history injection keeps only non-empty chat messages", () => {
  assert.deepEqual(
    toHistoryItems([
      { role: "user", content: " hello " },
      { role: "assistant", content: "world" },
      { role: "system", content: "ignore" },
      { role: "user", content: "   " },
    ]),
    [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hello" }],
      },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "world" }],
      },
    ],
  );
});
