import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DICTATION_SAMPLE_RATE,
  encodePcm16Wav,
  mergeDictationText,
  transcribeRecordedAudio,
} from "./dictation.ts";

test("dictation appends reviewable speech without erasing typed text", () => {
  assert.equal(mergeDictationText("Keep this", " and add this "), "Keep this and add this");
  assert.equal(mergeDictationText("", " hello world "), "hello world");
  assert.equal(mergeDictationText("draft ", ""), "draft");
});

test("dictation audio is downmixed and encoded as mono 24 kHz PCM16 WAV", () => {
  const wav = encodePcm16Wav(
    [new Float32Array([1, 0, -1, 0]), new Float32Array([1, 0, -1, 0])],
    48_000,
  );
  const view = new DataView(wav.buffer);

  assert.equal(new TextDecoder().decode(wav.subarray(0, 4)), "RIFF");
  assert.equal(new TextDecoder().decode(wav.subarray(8, 12)), "WAVE");
  assert.equal(view.getUint16(20, true), 1);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), DICTATION_SAMPLE_RATE);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 4);
  assert.equal(view.getInt16(44, true), 0x7fff);
  assert.equal(view.getInt16(46, true), -0x8000);
});

test("dictation WAV encoding rejects missing decoded samples", () => {
  assert.throws(
    () => encodePcm16Wav([], 48_000),
    /Recorded dictation audio is empty/,
  );
});

test("dictation transcription posts WAV bytes and returns trimmed review text", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ input, init });
    return Response.json({ transcript: "  review me  " });
  };
  try {
    assert.equal(
      await transcribeRecordedAudio(new Uint8Array([1, 2, 3])),
      "review me",
    );
    assert.equal(requests[0]?.input, "/_dictation/transcribe");
    assert.deepEqual(requests[0]?.init?.headers, {
      accept: "application/json",
      "content-type": "audio/wav",
    });
    assert.deepEqual(
      Array.from(new Uint8Array(requests[0]!.init!.body as ArrayBuffer)),
      [1, 2, 3],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("dictation transcription surfaces an actionable retry error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json(
    { error: "Codex transcription timed out" },
    { status: 504 },
  );
  try {
    await assert.rejects(
      transcribeRecordedAudio(new Uint8Array([1])),
      /Codex transcription timed out/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
