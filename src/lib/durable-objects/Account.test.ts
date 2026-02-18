import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAccountState } from "./Account.ts";

test("normalizeAccountState keeps BYOK and composer preference from legacy records", () => {
  const normalized = normalizeAccountState(
    {
      ownerId: "person.one",
      demo: {
        total: 3,
        used: 2,
        reserved: 1,
      },
      reservations: {
        "legacy-reservation": {
          id: "legacy-reservation",
          count: 1,
          status: "reserved",
        },
      },
      byok: {
        provider: "openai",
        ciphertext: "ciphertext-value",
        iv: "iv-value",
        version: "v1",
        createdAt: "2026-02-10T00:00:00.000Z",
        updatedAt: "2026-02-10T00:00:00.000Z",
      },
      composerPreference: {
        model: "gpt-5-mini",
        reasoningEffort: "medium",
        preset: "reasoning",
        tools: ["web-search", "web-search", "file-upload", "unknown-tool"],
        updatedAt: "2026-02-11T00:00:00.000Z",
      },
      updatedAt: "2026-02-12T00:00:00.000Z",
    },
    "person.one",
  );

  assert.equal(normalized.ownerId, "person.one");
  assert.equal(normalized.byok?.provider, "openai");
  assert.equal(normalized.composerPreference?.model, "gpt-5-mini");
  assert.deepEqual(normalized.composerPreference?.tools, [
    "web-search",
    "file-upload",
  ]);
  assert.equal((normalized as unknown as Record<string, unknown>).demo, undefined);
  assert.equal(
    (normalized as unknown as Record<string, unknown>).reservations,
    undefined,
  );
});

test("normalizeAccountState defaults to empty state when record is missing", () => {
  const normalized = normalizeAccountState(null, "person.two");

  assert.equal(normalized.ownerId, "person.two");
  assert.equal(normalized.byok, null);
  assert.equal(normalized.composerPreference, null);
});

test("normalizeAccountState rejects owner mismatch", () => {
  assert.throws(() => {
    normalizeAccountState(
      {
        ownerId: "person.two",
      },
      "person.one",
    );
  }, /owner mismatch/);
});
