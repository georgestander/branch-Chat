import assert from "node:assert/strict";
import test from "node:test";

import { encodeMonoPcm16Wav } from "./audio.ts";

test("encodes mono PCM16 audio as a bounded WAV", () => {
  const wav = encodeMonoPcm16Wav(new Float32Array([-1, 0, 1]), 24_000);
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);

  assert.equal(new TextDecoder().decode(wav.slice(0, 4)), "RIFF");
  assert.equal(new TextDecoder().decode(wav.slice(8, 12)), "WAVE");
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 24_000);
  assert.equal(view.getUint32(40, true), 6);
  assert.equal(view.getInt16(44, true), -32_768);
  assert.equal(view.getInt16(46, true), 0);
  assert.equal(view.getInt16(48, true), 32_767);
});
