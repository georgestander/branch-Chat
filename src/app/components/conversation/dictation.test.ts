import assert from "node:assert/strict";
import { test } from "node:test";

import { mergeDictationText, requestMicrophoneAccess } from "./dictation.ts";

test("dictation appends reviewable speech without erasing typed text", () => {
  assert.equal(mergeDictationText("Keep this", " and add this "), "Keep this and add this");
  assert.equal(mergeDictationText("", " hello world "), "hello world");
  assert.equal(mergeDictationText("draft ", ""), "draft");
});

test("microphone access requests audio and releases every temporary track", async () => {
  const stopped: string[] = [];
  let receivedConstraints: MediaStreamConstraints | null = null;

  await requestMicrophoneAccess(async (constraints) => {
    receivedConstraints = constraints;
    return {
      getTracks: () => [
        { stop: () => stopped.push("audio-1") },
        { stop: () => stopped.push("audio-2") },
      ],
    };
  });

  assert.deepEqual(receivedConstraints, { audio: true });
  assert.deepEqual(stopped, ["audio-1", "audio-2"]);
});

test("microphone access preserves the native permission failure", async () => {
  const denied = new Error("Permission denied");

  await assert.rejects(
    requestMicrophoneAccess(async () => {
      throw denied;
    }),
    (error) => error === denied,
  );
});
