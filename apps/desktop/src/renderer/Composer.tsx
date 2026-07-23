import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

import { recordingToWav } from "./audio.ts";
import {
  COMPOSER_MODEL_OPTIONS,
  REASONING_EFFORT_LABELS,
  composerModelLabel,
  normalizeComposerSettings,
  reasoningEffortsForModel,
  settingsForModel,
  settingsForPreset,
  settingsForReasoningEffort,
  settingsWithWebSearch,
  type ComposerSettingsChangeHandler,
  type ComposerSettingsSelection,
} from "./composer-settings.ts";
import {
  dictationOwnsDraft,
  dictationPresentation,
  mergeDictationTranscript,
  type DictationState,
} from "./dictation.ts";
import {
  hasAudioInputDevice,
  microphonePermissionRecoveryMessage,
  withMicrophoneRequestTimeout,
} from "./microphone.ts";
import { Icon } from "./icons.tsx";
import type { AttachmentDraft } from "./types.ts";
import "./Composer.css";

export type {
  ComposerSettingsChangeHandler,
  ComposerSettingsSelection,
} from "./composer-settings.ts";

export type ComposerProps = {
  branchTitle: string;
  value: string;
  attachments: AttachmentDraft[];
  variant?: "default" | "canvas-start" | "branch-draft";
  disabled?: boolean;
  streaming?: boolean;
  focusToken?: number;
  settings?: ComposerSettingsSelection;
  settingsSaving?: boolean;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onChooseFiles: (files: File[]) => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onTranscribe: (audio: Uint8Array, contentType: string) => Promise<string>;
  onSettingsChange?: ComposerSettingsChangeHandler;
  onSaveNote?: () => void;
};

const MAX_RECORDING_MS = 120_000;

const PRESET_OPTIONS = [
  {
    id: "fast",
    label: "Fast",
    description: "Terra · medium reasoning",
  },
  {
    id: "reasoning",
    label: "Reasoning",
    description: "Sol · high reasoning",
  },
  {
    id: "study",
    label: "Study",
    description: "Sol · guided learning",
  },
] as const;

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${Math.round(bytes / 1_024)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export function Composer({
  branchTitle,
  value,
  attachments,
  variant = "default",
  disabled = false,
  streaming = false,
  focusToken = 0,
  settings,
  settingsSaving = false,
  onChange,
  onSend,
  onStop,
  onChooseFiles,
  onRemoveAttachment,
  onTranscribe,
  onSettingsChange,
  onSaveNote,
}: ComposerProps): React.JSX.Element {
  const inputId = useId();
  const settingsPanelId = useId();
  const expandedEditorTitleId = useId();
  const dictationStatusId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const expandedTextareaRef = useRef<HTMLTextAreaElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingTimeoutRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const draftAtRecordingStartRef = useRef("");
  const currentDraftRef = useRef(value);
  const dictationAttemptRef = useRef(0);
  const [dictationState, setDictationState] =
    useState<DictationState>("idle");
  const [dictationError, setDictationError] = useState<string | null>(null);
  const [failedDictation, setFailedDictation] =
    useState<Uint8Array | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [expandedEditorOpen, setExpandedEditorOpen] = useState(false);
  const [settingsChanging, setSettingsChanging] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const selectedSettings = useMemo(
    () => normalizeComposerSettings(settings),
    [settings],
  );
  const reasoningOptions = useMemo(
    () => reasoningEffortsForModel(selectedSettings.model),
    [selectedSettings.model],
  );
  const currentReasoningEffort =
    selectedSettings.reasoningEffort ?? reasoningOptions[0] ?? "low";
  const webSearchEnabled =
    selectedSettings.tools.includes("web-search");
  const currentModelLabel = composerModelLabel(selectedSettings.model);
  const settingsBusy = settingsSaving || settingsChanging;
  const settingsDisabled =
    disabled || streaming || settingsBusy || !onSettingsChange;
  currentDraftRef.current = value;

  useEffect(() => {
    if (focusToken > 0) {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(value.length, value.length);
    }
  }, [focusToken, value.length]);

  useEffect(
    () => () => {
      dictationAttemptRef.current += 1;
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

  useEffect(() => {
    if (!settingsOpen && !expandedEditorOpen) return;

    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (expandedEditorOpen) {
        setExpandedEditorOpen(false);
      } else {
        setSettingsOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [expandedEditorOpen, settingsOpen]);

  const stopRecording = useCallback(() => {
    if (recordingTimeoutRef.current !== null) {
      window.clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  }, []);

  const transcribeRecording = useCallback(
    async (wav: Uint8Array, attemptId: number) => {
      if (attemptId !== dictationAttemptRef.current) return;
      setDictationState("transcribing");
      setDictationError(null);
      try {
        const transcript = await onTranscribe(wav, "audio/wav");
        if (attemptId !== dictationAttemptRef.current) return;
        const merged = mergeDictationTranscript(
          draftAtRecordingStartRef.current,
          currentDraftRef.current,
          transcript,
        );
        if (merged.kind === "stale") {
          setFailedDictation(wav);
          setDictationState("error");
          setDictationError(
            "The draft changed while dictation was processing, so the transcript was not inserted. Retry to add it to the current draft.",
          );
          return;
        }
        onChange(merged.value);
        currentDraftRef.current = merged.value;
        setFailedDictation(null);
        setDictationState("idle");
        window.requestAnimationFrame(() => {
          if (expandedTextareaRef.current) {
            expandedTextareaRef.current?.focus();
          } else {
            textareaRef.current?.focus();
          }
        });
      } catch (error) {
        if (attemptId !== dictationAttemptRef.current) return;
        setFailedDictation(wav);
        setDictationState("error");
        setDictationError(
          error instanceof Error
            ? error.message
            : "Dictation could not be transcribed.",
        );
      }
    },
    [onChange, onTranscribe],
  );

  const startRecording = useCallback(async () => {
    if (dictationState === "recording") {
      stopRecording();
      return;
    }
    if (dictationState === "requesting" || dictationState === "transcribing") {
      return;
    }
    const attemptId = dictationAttemptRef.current + 1;
    dictationAttemptRef.current = attemptId;
    draftAtRecordingStartRef.current = currentDraftRef.current;
    setDictationError(null);
    setFailedDictation(null);
    setDictationState("requesting");
    let requestedStream: MediaStream | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Microphone recording is unavailable on this Mac.");
      }
      const permission = await withMicrophoneRequestTimeout(
        window.branchy.requestMicrophonePermission(),
      );
      if (!permission.granted) {
        throw new Error(
          microphonePermissionRecoveryMessage(permission.status),
        );
      }
      if (
        !hasAudioInputDevice(
          await withMicrophoneRequestTimeout(
            navigator.mediaDevices.enumerateDevices(),
          ),
        )
      ) {
        throw new DOMException(
          "No microphone input device is available.",
          "NotFoundError",
        );
      }
      requestedStream = await withMicrophoneRequestTimeout(
        navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
          },
        }),
        {
          onLateResult: (stream) => {
            for (const track of stream.getTracks()) {
              track.stop();
            }
          },
        },
      );
      if (attemptId !== dictationAttemptRef.current) {
        for (const track of requestedStream.getTracks()) track.stop();
        return;
      }
      const mediaStream = requestedStream;
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
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      });
      recorder.addEventListener(
        "stop",
        () => {
          for (const track of mediaStream.getTracks()) track.stop();
          streamRef.current = null;
          recorderRef.current = null;
          if (attemptId !== dictationAttemptRef.current) return;
          const blob = new Blob(chunksRef.current, {
            type: recorder.mimeType || "audio/webm",
          });
          if (blob.size === 0) {
            setDictationState("error");
            setDictationError("No speech was recorded. Try again.");
            return;
          }
          setDictationState("transcribing");
          setDictationError(null);
          void recordingToWav(blob)
            .then((wav) => transcribeRecording(wav, attemptId))
            .catch((error: unknown) => {
              if (attemptId !== dictationAttemptRef.current) return;
              setFailedDictation(null);
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
      for (const track of requestedStream?.getTracks() ?? []) track.stop();
      if (attemptId !== dictationAttemptRef.current) return;
      if (streamRef.current === requestedStream) {
        streamRef.current = null;
      }
      setDictationState("error");
      setDictationError(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? microphonePermissionRecoveryMessage("denied")
          : error instanceof DOMException && error.name === "NotFoundError"
            ? "No microphone was detected. Connect one, then try again."
          : error instanceof Error
            ? error.message
            : "Branchy could not open the microphone.",
      );
    }
  }, [
    dictationState,
    stopRecording,
    transcribeRecording,
  ]);

  const dictationDraftLocked = dictationOwnsDraft(dictationState);
  const blockedAttachment = attachments.some(
    (attachment) =>
      attachment.status === "uploading" ||
      attachment.status === "error",
  );
  const canSend =
    !disabled &&
    !streaming &&
    !dictationDraftLocked &&
    !blockedAttachment &&
    value.trim().length > 0;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.nativeEvent.isComposing
      ) {
        event.preventDefault();
        if (canSend) {
          setExpandedEditorOpen(false);
          onSend();
        }
      }
    },
    [canSend, onSend],
  );

  const chooseFiles = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      if (files.length > 0) onChooseFiles(files);
      event.target.value = "";
    },
    [onChooseFiles],
  );

  const applySettings = useCallback(
    async (nextSettings: ComposerSettingsSelection) => {
      if (!onSettingsChange || settingsBusy) return;
      setSettingsError(null);
      setSettingsChanging(true);
      try {
        await onSettingsChange(nextSettings);
      } catch (error) {
        setSettingsError(
          error instanceof Error
            ? error.message
            : "Composer settings could not be saved.",
        );
      } finally {
        setSettingsChanging(false);
      }
    },
    [onSettingsChange, settingsBusy],
  );

  const dictationUi = dictationPresentation(dictationState);
  const dictationDisabled =
    dictationState !== "recording" &&
    (disabled ||
      dictationState === "requesting" ||
      dictationState === "transcribing");

  const renderDictationButton = (expanded = false) => (
    <button
      className={`icon-button icon-button--quiet composer__dictation ${
        dictationState === "recording" ? "is-recording" : ""
      } ${expanded ? "composer__dictation--expanded" : ""}`}
      type="button"
      disabled={dictationDisabled}
      aria-label={dictationUi.buttonLabel}
      aria-describedby={
        dictationUi.status ? dictationStatusId : undefined
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
  );

  return (
    <section
      className={`composer composer--${variant} nodrag nowheel nopan`}
      aria-label={`Message ${branchTitle}`}
    >
      <input
        id={inputId}
        className="sr-only"
        type="file"
        accept=".pdf,.doc,.docx,.txt,image/*"
        multiple
        onChange={chooseFiles}
      />
      <span
        id={dictationStatusId}
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {dictationUi.status ?? ""}
      </span>

      <div className="composer__settings-bar">
        <div
          className="composer__presets"
          role="group"
          aria-label="Response mode"
        >
          {PRESET_OPTIONS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={
                selectedSettings.preset === preset.id ? "is-selected" : ""
              }
              disabled={settingsDisabled}
              aria-pressed={selectedSettings.preset === preset.id}
              title={preset.description}
              onClick={() => void applySettings(settingsForPreset(preset.id))}
            >
              {preset.label}
            </button>
          ))}
          {selectedSettings.preset === "custom" ? (
            <span className="composer__custom-mode">Custom</span>
          ) : null}
        </div>

        <div className="composer__settings-actions">
          <button
            type="button"
            className={`composer__compact-control ${
              webSearchEnabled ? "is-selected" : ""
            }`}
            disabled={settingsDisabled}
            aria-pressed={webSearchEnabled}
            aria-label={
              webSearchEnabled ? "Disable web search" : "Enable web search"
            }
            title={webSearchEnabled ? "Web search on" : "Web search off"}
            onClick={() =>
              void applySettings(
                settingsWithWebSearch(
                  selectedSettings,
                  !webSearchEnabled,
                ),
              )
            }
          >
            <Icon name="search" size={13} />
          </button>
          <button
            type="button"
            className={`composer__compact-control ${
              settingsOpen ? "is-selected" : ""
            }`}
            disabled={disabled || streaming}
            aria-expanded={settingsOpen}
            aria-controls={settingsOpen ? settingsPanelId : undefined}
            aria-label="Choose model and reasoning"
            title="Model and reasoning"
            onClick={() => setSettingsOpen((open) => !open)}
          >
            <Icon name="settings" size={13} />
          </button>
        </div>
      </div>

      {settingsOpen ? (
        <div
          className="composer__settings-panel"
          id={settingsPanelId}
          aria-label="Model and reasoning controls"
        >
          <label>
            <span>Model</span>
            <select
              value={selectedSettings.model}
              disabled={settingsDisabled}
              onChange={(event) =>
                void applySettings(
                  settingsForModel(selectedSettings, event.target.value),
                )
              }
            >
              {COMPOSER_MODEL_OPTIONS.some(
                (option) => option.id === selectedSettings.model,
              ) ? null : (
                <option value={selectedSettings.model}>
                  {selectedSettings.model}
                </option>
              )}
              {COMPOSER_MODEL_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Reasoning</span>
            <select
              value={currentReasoningEffort}
              disabled={settingsDisabled}
              onChange={(event) =>
                void applySettings(
                  settingsForReasoningEffort(
                    selectedSettings,
                    event.target.value as keyof typeof REASONING_EFFORT_LABELS,
                  ),
                )
              }
            >
              {reasoningOptions.map((effort) => (
                <option key={effort} value={effort}>
                  {REASONING_EFFORT_LABELS[effort]}
                </option>
              ))}
            </select>
          </label>
          <div className="composer__settings-summary">
            <strong>{currentModelLabel}</strong>
            <span>
              {REASONING_EFFORT_LABELS[currentReasoningEffort]} reasoning
              {webSearchEnabled ? " · Search on" : " · Search off"}
            </span>
          </div>
          {settingsBusy ? (
            <span className="composer__settings-status">Saving…</span>
          ) : settingsError ? (
            <span className="composer__settings-status composer__settings-status--error">
              {settingsError}
            </span>
          ) : null}
        </div>
      ) : null}

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

      <div className="composer__editor">
        <textarea
          aria-label={`Message ${branchTitle}`}
          disabled={disabled}
          readOnly={dictationDraftLocked}
          aria-describedby={
            dictationUi.status ? dictationStatusId : undefined
          }
          onChange={(event) => {
            if (!dictationDraftLocked) onChange(event.target.value);
          }}
          onKeyDown={handleKeyDown}
          placeholder={
            disabled
              ? "Sign in with ChatGPT to talk with Branchy"
              : variant === "branch-draft"
                ? "Write a note or ask the model…"
                : variant === "canvas-start"
                  ? "Ask anything to start this canvas…"
                  : `Continue ${branchTitle}…`
          }
          ref={textareaRef}
          rows={1}
          value={value}
        />
        <button
          type="button"
          className="composer__expand"
          disabled={disabled}
          aria-label="Open large editor"
          title="Open large editor"
          onClick={() => setExpandedEditorOpen(true)}
        >
          <span aria-hidden="true">↗</span>
        </button>
      </div>

      {dictationError ? (
        <div className="composer__error" role="alert">
          <span>{dictationError}</span>
          <span className="composer__error-actions">
            {failedDictation ? (
              <button
                type="button"
                onClick={() => {
                  const attemptId = dictationAttemptRef.current + 1;
                  dictationAttemptRef.current = attemptId;
                  draftAtRecordingStartRef.current =
                    currentDraftRef.current;
                  void transcribeRecording(failedDictation, attemptId);
                }}
              >
                Retry
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                dictationAttemptRef.current += 1;
                setFailedDictation(null);
                setDictationError(null);
                setDictationState("idle");
              }}
            >
              Dismiss
            </button>
          </span>
        </div>
      ) : null}

      <footer className="composer__toolbar">
        <div className="composer__tools">
          <label className="icon-button icon-button--quiet" htmlFor={inputId}>
            <Icon name="paperclip" size={17} />
            <span className="sr-only">Attach files</span>
          </label>
          {renderDictationButton()}
          <span
            className="composer__model"
            title={
              dictationUi.status ??
              `${currentModelLabel} · ${REASONING_EFFORT_LABELS[currentReasoningEffort]}`
            }
            aria-hidden={dictationUi.status ? "true" : undefined}
          >
            {dictationUi.status ??
              `${currentModelLabel} · ${REASONING_EFFORT_LABELS[currentReasoningEffort]}`}
          </span>
        </div>

        <div className="composer__submit-actions">
          {onSaveNote && !streaming ? (
            <button
              className="composer__note"
              type="button"
              disabled={!canSend}
              onClick={onSaveNote}
            >
              Save note
            </button>
          ) : null}
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
        </div>
      </footer>

      {expandedEditorOpen
        ? createPortal(
            <div
              className="composer-expanded"
              onMouseDown={(event) => {
                if (event.currentTarget === event.target) {
                  setExpandedEditorOpen(false);
                }
              }}
            >
              <section
                className="composer-expanded__dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby={expandedEditorTitleId}
              >
                <header>
                  <div>
                    <strong id={expandedEditorTitleId}>
                      Continue {branchTitle}
                    </strong>
                    <span>
                      {currentModelLabel} ·{" "}
                      {REASONING_EFFORT_LABELS[currentReasoningEffort]}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="icon-button icon-button--quiet"
                    aria-label="Close expanded editor"
                    onClick={() => setExpandedEditorOpen(false)}
                  >
                    <Icon name="close" size={16} />
                  </button>
                </header>
                <textarea
                  ref={expandedTextareaRef}
                  autoFocus
                  value={value}
                  disabled={disabled}
                  readOnly={dictationDraftLocked}
                  aria-label={`Expanded message ${branchTitle}`}
                  aria-describedby={
                    dictationUi.status ? dictationStatusId : undefined
                  }
                  placeholder={`Continue ${branchTitle}…`}
                  onChange={(event) => {
                    if (!dictationDraftLocked) onChange(event.target.value);
                  }}
                  onKeyDown={handleKeyDown}
                />
                <footer>
                  <div className="composer-expanded__tools">
                    <label
                      className="icon-button icon-button--quiet"
                      htmlFor={inputId}
                    >
                      <Icon name="paperclip" size={17} />
                      <span className="sr-only">Attach files</span>
                    </label>
                    {renderDictationButton(true)}
                    <span aria-hidden={dictationUi.status ? "true" : undefined}>
                      {dictationUi.status ??
                        "Enter to send · Shift + Enter for a new line"}
                    </span>
                  </div>
                  {streaming ? (
                    <button
                      className="composer-expanded__send composer-expanded__stop"
                      type="button"
                      onClick={onStop}
                    >
                      <Icon name="square" size={13} />
                      Stop
                    </button>
                  ) : (
                    <button
                      className="composer-expanded__send"
                      type="button"
                      disabled={!canSend}
                      onClick={() => {
                        setExpandedEditorOpen(false);
                        onSend();
                      }}
                    >
                      <Icon name="send" size={15} />
                      Send
                    </button>
                  )}
                </footer>
              </section>
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}
