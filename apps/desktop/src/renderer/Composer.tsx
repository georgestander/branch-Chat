import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";

import { Icon } from "./icons.tsx";
import { recordingToWav } from "./audio.ts";
import type { AttachmentDraft } from "./types.ts";

type ComposerProps = {
  branchTitle: string;
  value: string;
  attachments: AttachmentDraft[];
  disabled?: boolean;
  streaming?: boolean;
  focusToken?: number;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onChooseFiles: (files: File[]) => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onTranscribe: (audio: Uint8Array, contentType: string) => Promise<string>;
};

type DictationState =
  | "idle"
  | "requesting"
  | "recording"
  | "transcribing"
  | "error";

const MAX_RECORDING_MS = 120_000;

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${Math.round(bytes / 1_024)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function mergeTranscript(current: string, transcript: string): string {
  const base = current.trimEnd();
  const next = transcript.trim();
  if (!base) return next;
  if (!next) return current;
  return `${base}${/[.!?]$/.test(base) ? " " : ". "}${next}`;
}

export function Composer({
  branchTitle,
  value,
  attachments,
  disabled = false,
  streaming = false,
  focusToken = 0,
  onChange,
  onSend,
  onStop,
  onChooseFiles,
  onRemoveAttachment,
  onTranscribe,
}: ComposerProps): React.JSX.Element {
  const inputId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingTimeoutRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const draftAtRecordingStartRef = useRef("");
  const [dictationState, setDictationState] =
    useState<DictationState>("idle");
  const [dictationError, setDictationError] = useState<string | null>(null);

  useEffect(() => {
    if (focusToken > 0) {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(value.length, value.length);
    }
  }, [focusToken, value.length]);

  useEffect(
    () => () => {
      if (recordingTimeoutRef.current !== null) {
        window.clearTimeout(recordingTimeoutRef.current);
      }
      if (recorderRef.current?.state === "recording") {
        recorderRef.current.stop();
      }
      for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    },
    [],
  );

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0";
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 42), 160)}px`;
  }, [value]);

  const stopRecording = useCallback(() => {
    if (recordingTimeoutRef.current !== null) {
      window.clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (dictationState === "recording") {
      stopRecording();
      return;
    }
    if (dictationState === "requesting" || dictationState === "transcribing") {
      return;
    }
    setDictationError(null);
    setDictationState("requesting");
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Microphone recording is unavailable on this Mac.");
      }
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = mediaStream;
      const preferredType = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/webm",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(
        mediaStream,
        preferredType ? { mimeType: preferredType } : undefined,
      );
      recorderRef.current = recorder;
      chunksRef.current = [];
      draftAtRecordingStartRef.current = value;
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      });
      recorder.addEventListener(
        "stop",
        () => {
          for (const track of mediaStream.getTracks()) track.stop();
          streamRef.current = null;
          const blob = new Blob(chunksRef.current, {
            type: recorder.mimeType || "audio/webm",
          });
          if (blob.size === 0) {
            setDictationState("error");
            setDictationError("No speech was recorded. Try again.");
            return;
          }
          setDictationState("transcribing");
          void recordingToWav(blob)
            .then((wav) => onTranscribe(wav, "audio/wav"))
            .then((transcript) => {
              onChange(
                mergeTranscript(draftAtRecordingStartRef.current, transcript),
              );
              setDictationState("idle");
              window.requestAnimationFrame(() => textareaRef.current?.focus());
            })
            .catch((error: unknown) => {
              setDictationState("error");
              setDictationError(
                error instanceof Error
                  ? error.message
                  : "Dictation could not be transcribed.",
              );
            });
        },
        { once: true },
      );
      recorder.start(250);
      setDictationState("recording");
      recordingTimeoutRef.current = window.setTimeout(
        stopRecording,
        MAX_RECORDING_MS,
      );
    } catch (error) {
      for (const track of streamRef.current?.getTracks() ?? []) track.stop();
      streamRef.current = null;
      setDictationState("error");
      setDictationError(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Microphone access is off. Enable it in System Settings, then try again."
          : error instanceof Error
            ? error.message
            : "Branchy could not open the microphone.",
      );
    }
  }, [dictationState, onChange, onTranscribe, stopRecording, value]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.nativeEvent.isComposing
      ) {
        event.preventDefault();
        if (!disabled && !streaming && value.trim()) onSend();
      }
    },
    [disabled, onSend, streaming, value],
  );

  const chooseFiles = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      if (files.length > 0) onChooseFiles(files);
      event.target.value = "";
    },
    [onChooseFiles],
  );

  const pendingAttachment = attachments.some(
    (attachment) => attachment.status === "uploading",
  );
  const canSend =
    !disabled && !streaming && !pendingAttachment && value.trim().length > 0;

  return (
    <section className="composer" aria-label={`Message ${branchTitle}`}>
      {attachments.length > 0 ? (
        <div className="composer__attachments">
          {attachments.map((attachment) => (
            <div
              className={`attachment-chip attachment-chip--${attachment.status}`}
              key={attachment.id}
            >
              {attachment.status === "uploading" ? (
                <span className="spinner" aria-hidden="true" />
              ) : (
                <Icon name="file" size={15} />
              )}
              <span className="attachment-chip__name">{attachment.name}</span>
              <span className="attachment-chip__size">
                {formatBytes(attachment.size)}
              </span>
              <button
                type="button"
                aria-label={`Remove ${attachment.name}`}
                onClick={() => onRemoveAttachment(attachment.id)}
              >
                <Icon name="close" size={13} />
              </button>
              {attachment.error ? (
                <span className="attachment-chip__error">
                  {attachment.error}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <textarea
        aria-label={`Message ${branchTitle}`}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={
          disabled
            ? "Sign in with ChatGPT to talk with Branchy"
            : `Continue ${branchTitle}…`
        }
        ref={textareaRef}
        rows={1}
        value={value}
      />

      {dictationError ? (
        <div className="composer__error" role="alert">
          <span>{dictationError}</span>
          <button
            type="button"
            onClick={() => {
              setDictationError(null);
              setDictationState("idle");
            }}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <footer className="composer__toolbar">
        <div className="composer__tools">
          <label className="icon-button icon-button--quiet" htmlFor={inputId}>
            <Icon name="paperclip" size={17} />
            <span className="sr-only">Attach files</span>
          </label>
          <input
            id={inputId}
            className="sr-only"
            type="file"
            multiple
            onChange={chooseFiles}
          />
          <button
            className={`icon-button icon-button--quiet ${
              dictationState === "recording" ? "is-recording" : ""
            }`}
            type="button"
            disabled={
              disabled ||
              dictationState === "requesting" ||
              dictationState === "transcribing"
            }
            aria-label={
              dictationState === "recording"
                ? "Stop recording"
                : "Start dictation"
            }
            aria-pressed={dictationState === "recording"}
            onClick={() => void startRecording()}
          >
            {dictationState === "requesting" ||
            dictationState === "transcribing" ? (
              <span className="spinner" aria-hidden="true" />
            ) : dictationState === "recording" ? (
              <Icon name="square" size={14} />
            ) : (
              <Icon name="mic" size={17} />
            )}
          </button>
          <span className="composer__model">ChatGPT · GPT‑5.6 Terra</span>
        </div>

        {streaming ? (
          <button
            className="composer__send composer__stop"
            type="button"
            onClick={onStop}
            aria-label="Stop response"
          >
            <Icon name="square" size={13} />
          </button>
        ) : (
          <button
            className="composer__send"
            type="button"
            disabled={!canSend}
            onClick={onSend}
            aria-label="Send message"
          >
            <Icon name="send" size={17} />
          </button>
        )}
      </footer>
    </section>
  );
}
