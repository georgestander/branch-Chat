import assert from "node:assert/strict";
import test from "node:test";

import { generatedImageDisplayState } from "./types.ts";

test("successful images stay in a loading state until their private URL resolves", () => {
  assert.equal(generatedImageDisplayState("succeeded", null), "resolving");
  assert.equal(
    generatedImageDisplayState("succeeded", "__loading__"),
    "resolving",
  );
  assert.equal(
    generatedImageDisplayState(
      "succeeded",
      "branchy-asset://generated/image.png",
    ),
    "ready",
  );
  assert.equal(
    generatedImageDisplayState("succeeded", "__unavailable__"),
    "failed",
  );
});
