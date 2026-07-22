export function mergeDictationText(existing: string, transcript: string): string {
  const base = existing.trimEnd();
  const spoken = transcript.trim();
  if (!spoken) return base;
  return base ? `${base} ${spoken}` : spoken;
}
