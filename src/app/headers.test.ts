import assert from "node:assert/strict";
import { test } from "node:test";

import { COMMON_PERMISSIONS_POLICY } from "./headers.ts";

test("common permissions allow same-origin microphone access only", () => {
  assert.equal(
    COMMON_PERMISSIONS_POLICY,
    "geolocation=(), microphone=(self), camera=()",
  );
});
