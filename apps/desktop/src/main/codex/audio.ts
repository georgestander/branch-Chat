export const MAX_DICTATION_BODY_BYTES = 6 * 1024 * 1024;
export const MAX_DICTATION_DURATION_SECONDS = 120;
export const DICTATION_SAMPLE_RATE = 24_000;

export class DictationRequestError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "DictationRequestError";
    this.status = status;
  }
}

export interface ParsedPcm16Wav {
  pcm: Buffer;
  samples: number;
  durationSeconds: number;
}

export function parsePcm16Wav(input: Uint8Array): ParsedPcm16Wav {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (
    bytes.length < 44 ||
    bytes.length > MAX_DICTATION_BODY_BYTES ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new DictationRequestError(
      bytes.length > MAX_DICTATION_BODY_BYTES
        ? "Dictation audio is too large"
        : "Dictation audio must be a valid WAV file",
      bytes.length > MAX_DICTATION_BODY_BYTES ? 413 : 400,
    );
  }

  let format:
    | {
        audioFormat: number;
        channels: number;
        sampleRate: number;
        bitsPerSample: number;
      }
    | undefined;
  let pcm: Buffer | undefined;

  for (let offset = 12; offset + 8 <= bytes.length; ) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > bytes.length) {
      throw new DictationRequestError(
        "Dictation WAV contains a truncated chunk",
      );
    }
    if (id === "fmt " && size >= 16) {
      format = {
        audioFormat: bytes.readUInt16LE(start),
        channels: bytes.readUInt16LE(start + 2),
        sampleRate: bytes.readUInt32LE(start + 4),
        bitsPerSample: bytes.readUInt16LE(start + 14),
      };
    } else if (id === "data") {
      pcm = bytes.subarray(start, end);
    }
    offset = end + (size % 2);
  }

  if (!format || !pcm || pcm.length === 0 || pcm.length % 2 !== 0) {
    throw new DictationRequestError(
      "Dictation WAV is missing valid PCM audio",
    );
  }
  if (
    format.audioFormat !== 1 ||
    format.channels !== 1 ||
    format.sampleRate !== DICTATION_SAMPLE_RATE ||
    format.bitsPerSample !== 16
  ) {
    throw new DictationRequestError(
      "Dictation audio must be mono 24 kHz PCM16 WAV",
    );
  }

  const samples = pcm.length / 2;
  const durationSeconds = samples / DICTATION_SAMPLE_RATE;
  if (durationSeconds > MAX_DICTATION_DURATION_SECONDS) {
    throw new DictationRequestError(
      "Dictation audio exceeds the two-minute limit",
      413,
    );
  }
  return { pcm, samples, durationSeconds };
}
