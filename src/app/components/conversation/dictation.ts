export function mergeDictationText(existing: string, transcript: string): string {
  const base = existing.trimEnd();
  const spoken = transcript.trim();
  if (!spoken) return base;
  return base ? `${base} ${spoken}` : spoken;
}

export const DICTATION_SAMPLE_RATE = 24_000;
export const DICTATION_MAX_DURATION_MS = 120_000;

export function encodePcm16Wav(
  channels: readonly Float32Array[],
  sourceSampleRate: number,
): Uint8Array {
  if (
    channels.length === 0 ||
    channels[0].length === 0 ||
    !Number.isFinite(sourceSampleRate) ||
    sourceSampleRate <= 0
  ) {
    throw new Error("Recorded dictation audio is empty");
  }
  const sourceLength = Math.min(...channels.map((channel) => channel.length));
  const targetLength = Math.max(
    1,
    Math.round(sourceLength * DICTATION_SAMPLE_RATE / sourceSampleRate),
  );
  const bytes = new Uint8Array(44 + targetLength * 2);
  const view = new DataView(bytes.buffer);
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, bytes.byteLength - 8, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, DICTATION_SAMPLE_RATE, true);
  view.setUint32(28, DICTATION_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, targetLength * 2, true);

  for (let targetIndex = 0; targetIndex < targetLength; targetIndex += 1) {
    const sourcePosition = targetIndex * sourceSampleRate / DICTATION_SAMPLE_RATE;
    const leftIndex = Math.min(Math.floor(sourcePosition), sourceLength - 1);
    const rightIndex = Math.min(leftIndex + 1, sourceLength - 1);
    const fraction = sourcePosition - leftIndex;
    let sample = 0;
    for (const channel of channels) {
      const left = channel[leftIndex] ?? 0;
      const right = channel[rightIndex] ?? left;
      sample += left + (right - left) * fraction;
    }
    sample = Math.max(-1, Math.min(1, sample / channels.length));
    const pcm = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
    view.setInt16(44 + targetIndex * 2, pcm, true);
  }
  return bytes;
}

export async function decodeRecordedAudio(
  blob: Blob,
  createAudioContext: () => AudioContext,
): Promise<Uint8Array> {
  if (blob.size === 0) throw new Error("Recorded dictation audio is empty");
  const context = createAudioContext();
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    const channels = Array.from(
      { length: buffer.numberOfChannels },
      (_, channel) => buffer.getChannelData(channel),
    );
    return encodePcm16Wav(channels, buffer.sampleRate);
  } finally {
    await context.close();
  }
}

export async function transcribeRecordedAudio(
  wav: Uint8Array,
  signal?: AbortSignal,
): Promise<string> {
  const body = wav.buffer.slice(
    wav.byteOffset,
    wav.byteOffset + wav.byteLength,
  ) as ArrayBuffer;
  const response = await fetch("/_dictation/transcribe", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "audio/wav" },
    body,
    signal,
  });
  const result = (await response.json().catch(() => ({}))) as {
    transcript?: unknown;
    error?: unknown;
  };
  if (!response.ok) {
    throw new Error(
      typeof result.error === "string" && result.error.trim()
        ? result.error
        : `Voice transcription failed (${response.status})`,
    );
  }
  if (typeof result.transcript !== "string" || !result.transcript.trim()) {
    throw new Error("Voice transcription returned no text");
  }
  return result.transcript.trim();
}
