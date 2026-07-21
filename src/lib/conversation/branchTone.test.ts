import assert from "node:assert/strict";
import test from "node:test";

import { BRANCH_TONES, branchToneForId } from "./branchTone.ts";

test("branch tones are stable and drawn from the relationship palette", () => {
  const first = branchToneForId("branch-example");
  const second = branchToneForId("branch-example");

  assert.deepEqual(first, second);
  assert.ok(BRANCH_TONES.some((tone) => tone.key === first.key));
});
