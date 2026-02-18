"use client";

import { useState, useTransition } from "react";
import { ChevronDown, Loader2, SquarePen } from "lucide-react";
import { navigate } from "rwsdk/client";

import {
  createConversation,
  type CreateConversationResponse,
} from "@/app/pages/conversation/functions";
import type { ComposerPreset } from "@/lib/conversation";
import type { ConversationComposerTool } from "@/lib/conversation/tools";
import type { ConversationDirectoryEntry } from "@/lib/durable-objects/ConversationDirectory";
import {
  isWebSearchSupportedModel,
  supportsReasoningEffortModel,
} from "@/lib/openai/models";
import { cn } from "@/lib/utils";

interface ConversationEmptyLayoutProps {
  conversations: ConversationDirectoryEntry[];
  missingConversationId?: string | null;
}

type StartModeEffort = "low" | "medium" | "high" | null;

const ALLOWED_COMPOSER_TOOLS = new Set<ConversationComposerTool>([
  "study-and-learn",
  "web-search",
  "file-upload",
]);

const START_MODE_DEFAULTS: Record<
  Exclude<ComposerPreset, "custom">,
  {
    model: string;
    reasoningEffort: StartModeEffort;
    tools: ConversationComposerTool[];
  }
> = {
  fast: {
    model: "gpt-5-chat-latest",
    reasoningEffort: null,
    tools: [],
  },
  reasoning: {
    model: "gpt-5-mini",
    reasoningEffort: "medium",
    tools: [],
  },
  study: {
    model: "gpt-5-mini",
    reasoningEffort: "medium",
    tools: ["study-and-learn"],
  },
};

const PRESET_OPTIONS: Array<{
  id: ComposerPreset;
  label: string;
  description: string;
}> = [
  {
    id: "fast",
    label: "Fast",
    description: "Quick answers with chat-tuned defaults.",
  },
  {
    id: "reasoning",
    label: "Reasoning",
    description: "Balanced deeper reasoning for harder tasks.",
  },
  {
    id: "study",
    label: "Study",
    description: "Tutoring mode with Study & Learn enabled.",
  },
  {
    id: "custom",
    label: "Custom",
    description: "Keep your explicit model and tool picks.",
  },
];

const MODEL_OPTIONS: Array<{ id: string; label: string; description: string }> = [
  {
    id: "gpt-5-chat-latest",
    label: "GPT-5 Chat Latest",
    description: "Fast chat-tuned model",
  },
  {
    id: "gpt-5-mini",
    label: "GPT-5 Mini",
    description: "Reasoning model with effort control",
  },
];

const TOOL_OPTIONS: Array<{
  id: ConversationComposerTool;
  label: string;
  description: string;
}> = [
  {
    id: "study-and-learn",
    label: "Study & Learn",
    description: "Guided tutoring responses",
  },
  {
    id: "web-search",
    label: "Web Search",
    description: "Allow live source lookup",
  },
  {
    id: "file-upload",
    label: "File Upload",
    description: "Enable file-aware defaults in composer",
  },
];

function sanitizeComposerTools(value: unknown): ConversationComposerTool[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const tools: ConversationComposerTool[] = [];
  for (const item of value) {
    if (
      typeof item === "string" &&
      ALLOWED_COMPOSER_TOOLS.has(item as ConversationComposerTool) &&
      !tools.includes(item as ConversationComposerTool)
    ) {
      tools.push(item as ConversationComposerTool);
    }
  }
  return tools;
}

function isSameToolSelection(
  left: ConversationComposerTool[],
  right: ConversationComposerTool[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function inferPresetFromSelections(options: {
  model: string;
  reasoningEffort: StartModeEffort;
  tools: ConversationComposerTool[];
}): ComposerPreset {
  const normalizedTools = sanitizeComposerTools(options.tools);
  const normalizedEffort = supportsReasoningEffortModel(options.model)
    ? (options.reasoningEffort ?? "low")
    : null;

  const fastDefaults = START_MODE_DEFAULTS.fast;
  if (
    options.model === fastDefaults.model &&
    normalizedEffort === fastDefaults.reasoningEffort &&
    isSameToolSelection(normalizedTools, fastDefaults.tools)
  ) {
    return "fast";
  }

  const reasoningDefaults = START_MODE_DEFAULTS.reasoning;
  if (
    options.model === reasoningDefaults.model &&
    normalizedEffort === reasoningDefaults.reasoningEffort &&
    isSameToolSelection(normalizedTools, reasoningDefaults.tools)
  ) {
    return "reasoning";
  }

  const studyDefaults = START_MODE_DEFAULTS.study;
  if (
    options.model === studyDefaults.model &&
    normalizedEffort === studyDefaults.reasoningEffort &&
    isSameToolSelection(normalizedTools, studyDefaults.tools)
  ) {
    return "study";
  }

  return "custom";
}

export function ConversationEmptyLayout({
  conversations,
  missingConversationId = null,
}: ConversationEmptyLayoutProps) {
  const [creationError, setCreationError] = useState<string | null>(null);
  const [isCreating, startTransition] = useTransition();
  const [draft, setDraft] = useState("");
  const [selectedPreset, setSelectedPreset] = useState<ComposerPreset>("fast");
  const [selectedModel, setSelectedModel] = useState<string>(
    START_MODE_DEFAULTS.fast.model,
  );
  const [selectedReasoningEffort, setSelectedReasoningEffort] =
    useState<StartModeEffort>(START_MODE_DEFAULTS.fast.reasoningEffort);
  const [selectedTools, setSelectedTools] = useState<ConversationComposerTool[]>(
    [],
  );
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  const resolveCreateConversationSettings = (): {
    preset: ComposerPreset;
    model: string;
    reasoningEffort: StartModeEffort;
    tools: ConversationComposerTool[];
  } => {
    if (selectedPreset !== "custom") {
      const defaults = START_MODE_DEFAULTS[selectedPreset];
      return {
        preset: selectedPreset,
        model: defaults.model,
        reasoningEffort: defaults.reasoningEffort,
        tools: [...defaults.tools],
      };
    }

    const normalizedEffort = supportsReasoningEffortModel(selectedModel)
      ? (selectedReasoningEffort ?? "low")
      : null;
    const canUseWebSearch = isWebSearchSupportedModel(selectedModel);
    const normalizedTools = sanitizeComposerTools(selectedTools).filter((tool) =>
      canUseWebSearch ? true : tool !== "web-search",
    );

    return {
      preset: "custom",
      model: selectedModel,
      reasoningEffort: normalizedEffort,
      tools: normalizedTools,
    };
  };

  const handleStartConversation = (initialMessage?: string) => {
    if (isCreating) {
      return;
    }
    setCreationError(null);
    startTransition(async () => {
      try {
        const trimmedMessage = initialMessage?.trim() ?? "";
        const startSettings = resolveCreateConversationSettings();
        const result: CreateConversationResponse = await createConversation({
          preset: startSettings.preset,
          model: startSettings.model,
          reasoningEffort: startSettings.reasoningEffort,
          tools: startSettings.tools,
        });
        if (trimmedMessage && typeof window !== "undefined") {
          try {
            const storageKey = `connexus:bootstrap:${result.conversationId}`;
            window.sessionStorage.setItem(storageKey, trimmedMessage);
          } catch (storageError) {
            console.warn("[EmptyLayout] unable to persist draft message", storageError);
          }
        }
        navigate(`/app?conversationId=${encodeURIComponent(result.conversationId)}`);
      } catch (error) {
        console.error("[EmptyLayout] createConversation failed", error);
        const errorMessage =
          error instanceof Error ? error.message.toLowerCase() : "";
        if (errorMessage.includes("unauthorized") || errorMessage.includes("401")) {
          setCreationError("Sign in to start your free beta chat.");
        } else {
          setCreationError("Unable to start a new chat. Please try again.");
        }
      }
    });
  };

  const handlePresetSelect = (preset: ComposerPreset) => {
    setSelectedPreset(preset);
    if (preset === "custom") {
      setIsAdvancedOpen(true);
      return;
    }
    const defaults = START_MODE_DEFAULTS[preset];
    setSelectedModel(defaults.model);
    setSelectedReasoningEffort(defaults.reasoningEffort);
    setSelectedTools(defaults.tools);
  };

  const handleModelChange = (nextModel: string) => {
    const nextEffort = supportsReasoningEffortModel(nextModel)
      ? (selectedReasoningEffort ?? "medium")
      : null;
    const nextTools = sanitizeComposerTools(selectedTools).filter((tool) =>
      isWebSearchSupportedModel(nextModel) ? true : tool !== "web-search",
    );
    setSelectedModel(nextModel);
    setSelectedReasoningEffort(nextEffort);
    setSelectedTools(nextTools);
    setSelectedPreset(
      inferPresetFromSelections({
        model: nextModel,
        reasoningEffort: nextEffort,
        tools: nextTools,
      }),
    );
  };

  const handleReasoningEffortChange = (value: "low" | "medium" | "high") => {
    if (!supportsReasoningEffortModel(selectedModel)) {
      return;
    }
    setSelectedReasoningEffort(value);
    setSelectedPreset(
      inferPresetFromSelections({
        model: selectedModel,
        reasoningEffort: value,
        tools: selectedTools,
      }),
    );
  };

  const handleToolToggle = (tool: ConversationComposerTool) => {
    if (tool === "web-search" && !isWebSearchSupportedModel(selectedModel)) {
      return;
    }
    const nextTools = selectedTools.includes(tool)
      ? selectedTools.filter((value) => value !== tool)
      : [...selectedTools, tool];
    setSelectedTools(nextTools);
    setSelectedPreset(
      inferPresetFromSelections({
        model: selectedModel,
        reasoningEffort: supportsReasoningEffortModel(selectedModel)
          ? (selectedReasoningEffort ?? "low")
          : null,
        tools: nextTools,
      }),
    );
  };

  const handleDraftSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    handleStartConversation(draft);
  };

  const canUseWebSearch = isWebSearchSupportedModel(selectedModel);
  const selectedModeSummary =
    selectedPreset === "fast"
      ? "Fast preset: GPT-5 Chat Latest, no extra tools."
      : selectedPreset === "reasoning"
        ? "Reasoning preset: GPT-5 Mini with medium effort."
        : selectedPreset === "study"
          ? "Study preset: GPT-5 Mini with medium effort and Study & Learn."
          : "Custom mode: uses your explicit model, reasoning, and tool picks.";

  return (
    <div className="app-shell flex h-screen min-h-screen w-full overflow-hidden text-foreground">
      <aside className="panel-surface panel-edge flex w-72 flex-col justify-between border-r border-foreground/15 bg-background/70 p-6 backdrop-blur">
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold tracking-tight">Branch-Chat</h2>
            <button
              type="button"
              onClick={() => handleStartConversation()}
              disabled={isCreating}
              className={cn(
                "inline-flex h-9 w-9 items-center justify-center rounded-md border border-foreground/20 bg-background/70 text-foreground shadow-sm transition hover:bg-background",
                isCreating ? "cursor-not-allowed opacity-70" : "",
              )}
              aria-label={isCreating ? "Creating new chat" : "Start a new chat"}
            >
              {isCreating ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <SquarePen className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">
              {conversations.length === 0
                ? "No conversations yet. Start your first chat to begin exploring branches."
                : "Select an existing chat or start a new one to continue."}
            </p>
            {creationError ? (
              <p className="mt-2 text-xs text-destructive" role="status">
                {creationError}
              </p>
            ) : null}
            {missingConversationId ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Conversation "{missingConversationId}" was not found.
              </p>
            ) : null}
          </div>
        </div>

        {conversations.length > 0 ? (
          <div className="mt-6 space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Recent Chats
            </h3>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {conversations.slice(0, 6).map((entry) => (
                <li key={entry.id}>
                  <a
                    href={`/app?conversationId=${encodeURIComponent(entry.id)}`}
                    className="block truncate rounded-md px-2 py-1 transition hover:bg-background hover:text-foreground"
                  >
                    {entry.title || entry.id}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </aside>

      <main className="flex flex-1 items-center justify-center px-6">
        <div className="flex w-full max-w-2xl flex-col items-center gap-6 text-center">
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight">
              Bring your key, start branching
            </h1>
            <p className="text-sm text-muted-foreground">
              Choose a start mode, then connect BYOK before your first send.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => handleStartConversation()}
              disabled={isCreating}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-full bg-primary px-4 text-xs font-semibold uppercase tracking-[0.16em] text-primary-foreground transition hover:bg-primary/90",
                isCreating ? "cursor-not-allowed opacity-70" : "",
              )}
            >
              {isCreating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : null}
              <span>{isCreating ? "Creating…" : "Start Chat"}</span>
            </button>
            <a
              href="/sign-in"
              className="inline-flex h-9 items-center rounded-full border border-foreground/20 bg-background/70 px-4 text-xs font-semibold uppercase tracking-[0.16em] text-foreground transition hover:bg-background"
            >
              Sign In
            </a>
          </div>
          <p className="text-xs text-muted-foreground">
            BYOK is required to send messages. If server persistence is disabled, keys stay in-session only.
          </p>
          <form
            onSubmit={handleDraftSubmit}
            className="panel-surface panel-edge w-full rounded-[28px] px-4 py-4 text-left"
          >
            <div className="flex flex-col gap-4">
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Start Mode
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {PRESET_OPTIONS.map((option) => (
                    <button
                      key={`start-mode-${option.id}`}
                      type="button"
                      onClick={() => handlePresetSelect(option.id)}
                      className={cn(
                        "rounded-xl border px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                        selectedPreset === option.id
                          ? "border-primary/45 bg-primary/15 text-foreground"
                          : "border-foreground/15 bg-background/60 text-foreground hover:bg-background",
                      )}
                    >
                      <span className="block text-xs font-semibold uppercase tracking-[0.16em]">
                        {option.label}
                      </span>
                      <span className="mt-1 block text-[11px] text-muted-foreground">
                        {option.description}
                      </span>
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">{selectedModeSummary}</p>
              </div>

              <button
                type="button"
                onClick={() => setIsAdvancedOpen((open) => !open)}
                className={cn(
                  "inline-flex items-center gap-2 self-start rounded-full border border-foreground/20 bg-background/65 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground transition hover:bg-background",
                  isAdvancedOpen ? "border-primary/45 bg-primary/10" : "",
                )}
                aria-expanded={isAdvancedOpen}
              >
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 transition-transform",
                    isAdvancedOpen ? "rotate-180" : "rotate-0",
                  )}
                  aria-hidden="true"
                />
                <span>Advanced</span>
              </button>

              {isAdvancedOpen ? (
                <div className="space-y-3 rounded-2xl border border-foreground/15 bg-background/55 p-3">
                  <div className="space-y-1">
                    <label
                      htmlFor="start-model"
                      className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"
                    >
                      Model
                    </label>
                    <select
                      id="start-model"
                      value={selectedModel}
                      onChange={(event) => handleModelChange(event.target.value)}
                      className="h-9 w-full rounded-xl border border-foreground/15 bg-background px-3 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {MODEL_OPTIONS.map((option) => (
                        <option key={`start-model-${option.id}`} value={option.id}>
                          {`${option.label} · ${option.description}`}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label
                      htmlFor="start-reasoning"
                      className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"
                    >
                      Reasoning Effort
                    </label>
                    <select
                      id="start-reasoning"
                      value={selectedReasoningEffort ?? "medium"}
                      onChange={(event) =>
                        handleReasoningEffortChange(
                          event.target.value as "low" | "medium" | "high",
                        )
                      }
                      disabled={!supportsReasoningEffortModel(selectedModel)}
                      className="h-9 w-full rounded-xl border border-foreground/15 bg-background px-3 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-55"
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Tools
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {TOOL_OPTIONS.map((tool) => {
                        const disabled =
                          tool.id === "web-search" && !canUseWebSearch;
                        const selected = selectedTools.includes(tool.id);
                        return (
                          <button
                            key={`start-tool-${tool.id}`}
                            type="button"
                            onClick={() => handleToolToggle(tool.id)}
                            disabled={disabled}
                            className={cn(
                              "rounded-xl border px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
                              selected
                                ? "border-primary/45 bg-primary/15 text-foreground"
                                : "border-foreground/15 bg-background text-foreground hover:bg-background/80",
                            )}
                          >
                            <span className="block text-xs font-semibold uppercase tracking-[0.14em]">
                              {tool.label}
                            </span>
                            <span className="mt-1 block text-[11px] text-muted-foreground">
                              {disabled
                                ? "Not supported by selected model"
                                : tool.description}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-full border border-foreground/20 bg-background text-foreground">
                  <SquarePen className="h-5 w-5" aria-hidden="true" />
                </div>
                <label className="sr-only" htmlFor="empty-composer">
                  Start a new chat
                </label>
                <input
                  id="empty-composer"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Ask to explore a new direction…"
                  className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                  disabled={isCreating}
                />
                <button
                  type="submit"
                  disabled={isCreating}
                  className={cn(
                    "inline-flex h-10 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-lg transition hover:bg-primary/90",
                    isCreating ? "cursor-not-allowed opacity-70" : "",
                  )}
                >
                  {isCreating ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : null}
                  <span>{isCreating ? "Creating…" : "Start chat"}</span>
                </button>
              </div>
            </div>
          </form>
          <p className="text-xs text-muted-foreground">
            We'll start a new chat with your selected defaults and send your first message right away.
          </p>
        </div>
      </main>
    </div>
  );
}
