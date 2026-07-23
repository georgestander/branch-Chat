import assert from "node:assert/strict";
import test from "node:test";

import {
  dictationOwnsDraft,
  dictationPresentation,
  mergeDictationTranscript,
} from "./dictation.ts";

test("dictation owns the draft from permission request through transcription", () => {
  assert.equal(dictationOwnsDraft("idle"), false);
  assert.equal(dictationOwnsDraft("requesting"), true);
  assert.equal(dictationOwnsDraft("recording"), true);
  assert.equal(dictationOwnsDraft("transcribing"), true);
  assert.equal(dictationOwnsDraft("error"), false);
});

test("a pending transcript cannot restore a draft that changed after capture", () => {
  assert.deepEqual(
    mergeDictationTranscript(
      "Already sent draft",
      "",
      "A delayed transcript",
    ),
    { kind: "stale" },
  );
});

test("an unchanged draft receives the transcript for review without sending it", () => {
  assert.deepEqual(
    mergeDictationTranscript(
      "Keep this context",
      "Keep this context",
      "and add these spoken words",
    ),
    {
      kind: "merged",
      value: "Keep this context. and add these spoken words",
    },
  );
  assert.deepEqual(mergeDictationTranscript("", "", "  Fresh thought.  "), {
    kind: "merged",
    value: "Fresh thought.",
  });
});

test("requesting and transcribing expose their actual accessible state", () => {
  assert.deepEqual(dictationPresentation("requesting"), {
    buttonLabel: "Requesting microphone access",
    status: "Requesting microphone access…",
  });
  assert.deepEqual(dictationPresentation("transcribing"), {
    buttonLabel: "Transcribing dictation",
    status: "Transcribing dictation…",
  });
  assert.deepEqual(dictationPresentation("recording"), {
    buttonLabel: "Stop recording",
    status: "Recording. Select stop when you are finished.",
  });
});
