export type DictationState =
  | "idle"
  | "requesting"
  | "recording"
  | "transcribing"
  | "error";

export type DictationPresentation = {
  buttonLabel: string;
  status: string | null;
};

export type DictationTranscriptMerge =
  | { kind: "merged"; value: string }
  | { kind: "stale" };

export function dictationOwnsDraft(state: DictationState): boolean {
  return (
    state === "requesting" ||
    state === "recording" ||
    state === "transcribing"
  );
}

export function dictationPresentation(
  state: DictationState,
): DictationPresentation {
  switch (state) {
    case "requesting":
      return {
        buttonLabel: "Requesting microphone access",
        status: "Requesting microphone access…",
      };
    case "recording":
      return {
        buttonLabel: "Stop recording",
        status: "Recording. Select stop when you are finished.",
      };
    case "transcribing":
      return {
        buttonLabel: "Transcribing dictation",
        status: "Transcribing dictation…",
      };
    case "error":
    case "idle":
      return {
        buttonLabel: "Start dictation",
        status: null,
      };
  }
}

function appendTranscript(draft: string, transcript: string): string {
  const base = draft.trimEnd();
  const next = transcript.trim();
  if (!base) return next;
  if (!next) return draft;
  return `${base}${/[.!?]$/.test(base) ? " " : ". "}${next}`;
}

export function mergeDictationTranscript(
  capturedDraft: string,
  currentDraft: string,
  transcript: string,
): DictationTranscriptMerge {
  if (currentDraft !== capturedDraft) {
    return { kind: "stale" };
  }
  return {
    kind: "merged",
    value: appendTranscript(capturedDraft, transcript),
  };
}
