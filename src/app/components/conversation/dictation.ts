export function mergeDictationText(existing: string, transcript: string): string {
  const base = existing.trimEnd();
  const spoken = transcript.trim();
  if (!spoken) return base;
  return base ? `${base} ${spoken}` : spoken;
}

type MicrophoneTrack = {
  stop(): void;
};

type MicrophoneStream = {
  getTracks(): MicrophoneTrack[];
};

export async function requestMicrophoneAccess(
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MicrophoneStream>,
): Promise<void> {
  const stream = await getUserMedia({ audio: true });
  for (const track of stream.getTracks()) {
    track.stop();
  }
}
