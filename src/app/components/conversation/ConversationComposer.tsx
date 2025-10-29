"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";
import type { LucideIcon } from "lucide-react";
import {
  Check,
  Globe,
  GraduationCap,
  Loader2,
  Plus,
  SendHorizontal,
  Upload,
  X,
} from "lucide-react";

import { getConversationSummary, sendMessage } from "@/app/pages/conversation/functions";
import { cn } from "@/lib/utils";
import { emitDirectoryUpdate } from "@/app/components/conversation/directoryEvents";
import {
  emitOptimisticUserMessage,
  emitOptimisticMessageClear,
} from "@/app/components/conversation/messageEvents";
import { emitStartStreaming } from "@/app/components/conversation/streamingEvents";
import type { ConversationComposerTool } from "@/lib/conversation/tools";

type ToolOption = {
  id: ConversationComposerTool;
  label: string;
  description?: string;
  icon: LucideIcon;
};

const TOOL_OPTIONS: ToolOption[] = [
  {
    id: "study-and-learn",
    label: "Study & Learn",
    description: "Guided tutoring agent",
    icon: GraduationCap,
  },
  {
    id: "web-search",
    label: "Web Search",
    description: "Pull in live sources",
    icon: Globe,
  },
  {
    id: "file-upload",
    label: "File Upload",
    description: "Attach reference files",
    icon: Upload,
  },
];

interface ConversationComposerProps {
  branchId: string;
  conversationId: string;
  autoFocus?: boolean;
  className?: string;
}

export function ConversationComposer({
  branchId,
  conversationId,
  autoFocus = false,
  className,
}: ConversationComposerProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [selectedTools, setSelectedTools] = useState<ConversationComposerTool[]>(
    [],
  );
  const [isToolMenuOpen, setIsToolMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingRefreshTimers = useRef<number[]>([]);
  const toolMenuRef = useRef<HTMLDivElement | null>(null);
  const toolMenuId = useId();

  useEffect(() => {
    if (!autoFocus) {
      return;
    }

    const node = textareaRef.current;
    if (!node) {
      return;
    }

    node.focus({ preventScroll: true });
    const length = node.value.length;
    node.setSelectionRange(length, length);
  }, [autoFocus, branchId]);

  useEffect(() => {
    const node = textareaRef.current;
    if (!node) {
      return;
    }

    node.style.height = "auto";
    const next = Math.min(node.scrollHeight, 160);
    node.style.height = `${next}px`;
  }, [value]);

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined") {
        pendingRefreshTimers.current.forEach((timer) => {
          window.clearTimeout(timer);
        });
      }
      pendingRefreshTimers.current = [];
    };
  }, []);

  useEffect(() => {
    if (!isToolMenuOpen) {
      return;
    }
    if (typeof document === "undefined") {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const container = toolMenuRef.current;
      if (!container) {
        return;
      }
      if (!container.contains(event.target as Node)) {
        setIsToolMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isToolMenuOpen]);

  useEffect(() => {
    if (!isToolMenuOpen) {
      return;
    }
    if (typeof document === "undefined") {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsToolMenuOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isToolMenuOpen]);

  const handleToolSelect = useCallback((tool: ToolOption["id"]) => {
    setSelectedTools((previous) => {
      if (previous.includes(tool)) {
        return previous.filter((value) => value !== tool);
      }
      return [...previous, tool];
    });
  }, []);

  const handleClearTool = useCallback(() => {
    setSelectedTools([]);
  }, []);

  const activeToolOptions = TOOL_OPTIONS.filter((option) =>
    selectedTools.includes(option.id),
  );
  const MAX_VISIBLE_TOOL_ICONS = 3;
  const visibleToolOptions = activeToolOptions.slice(0, MAX_VISIBLE_TOOL_ICONS);
  const overflowCount = activeToolOptions.length - visibleToolOptions.length;
  const hasSelectedTools = activeToolOptions.length > 0;

  const submitMessage = () => {
    if (isPending) {
      return;
    }

    const content = value.trim();
    if (!content) {
      setError("Enter a message before sending.");
      return;
    }

    setError(null);
    const optimisticId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `optimistic-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    emitOptimisticUserMessage({
      conversationId,
      branchId,
      messageId: optimisticId,
      content,
      createdAt: new Date().toISOString(),
    });

    startTransition(async () => {
      try {
        const streamId =
          typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `stream-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        emitStartStreaming({ conversationId, branchId, streamId });
        const result = await sendMessage({
          conversationId,
          branchId,
          content,
          streamId,
          tools: selectedTools,
        });
        setValue("");

        const branchCount = Object.keys(result.snapshot.branches).length;
        const rootBranch =
          result.snapshot.branches[result.snapshot.conversation.rootBranchId];
        const persistedUserMessage = result.appendedMessages.find(
          (message) => message.role === "user" && message.branchId === branchId,
        );
        emitOptimisticMessageClear({
          conversationId,
          branchId,
          messageId: optimisticId,
          reason: "resolved",
          replacementMessageId: persistedUserMessage?.id ?? null,
        });
        emitDirectoryUpdate({
          conversationId,
          title: rootBranch?.title ?? conversationId,
          branchCount,
          lastActiveAt: new Date().toISOString(),
          archivedAt: null,
        });

        if (typeof window !== "undefined") {
          const scheduleRefresh = (delay: number) => {
            const timer = window.setTimeout(async () => {
              try {
                const summary = await getConversationSummary({
                  conversationId,
                });
                emitDirectoryUpdate(summary);
              } catch (refreshError) {
                console.error(
                  "[Composer] refresh conversation summary failed",
                  refreshError,
                );
              } finally {
                pendingRefreshTimers.current = pendingRefreshTimers.current.filter(
                  (value) => value !== timer,
                );
              }
            }, delay);
            pendingRefreshTimers.current.push(timer);
          };

          scheduleRefresh(1500);
          scheduleRefresh(4000);
        }
      } catch (cause) {
        emitOptimisticMessageClear({
          conversationId,
          branchId,
          messageId: optimisticId,
          reason: "failed",
        });
        console.error("[Composer] sendMessage failed", cause);
        setError("We couldn't send that message. Please try again.");
      }
    });
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitMessage();
  };

  const LeadingIcon = visibleToolOptions[0]?.icon;
  return (
    <div className={cn("mx-auto flex w-full max-w-3xl flex-col gap-2", className)}>
      <form
        onSubmit={handleSubmit}
        className="flex items-end gap-3 rounded-full border border-border/70 bg-card/95 px-1 py-2"
      >
        <div className="relative" ref={toolMenuRef}>
          <button
            type="button"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-background"
            aria-label="New prompt options"
            aria-expanded={isToolMenuOpen}
            aria-controls={isToolMenuOpen ? toolMenuId : undefined}
            aria-haspopup="menu"
            onClick={() => setIsToolMenuOpen((prev) => !prev)}
          >
            <Plus className="h-5 w-5" aria-hidden="true" />
          </button>

          {isToolMenuOpen ? (
            <div
              id={toolMenuId}
              role="menu"
              className="absolute left-0 bottom-full z-20 mb-2 w-56 rounded-xl border border-border/70 bg-popover p-1 shadow-lg"
            >
              {TOOL_OPTIONS.map((option) => {
                const isSelected = selectedTools.includes(option.id);
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={isSelected}
                    onClick={() => handleToolSelect(option.id)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      isSelected
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-muted/60",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-flex h-7 w-7 items-center justify-center rounded-full border border-transparent",
                        isSelected
                          ? "bg-primary/20 text-primary"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {isSelected ? (
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <option.icon className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                    </span>
                    <span className="flex-1">
                      <span className="block font-medium">{option.label}</span>
                      {option.description ? (
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {option.description}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}

              <div className="my-1 border-t border-border/60" aria-hidden="true" />

              <button
                type="button"
                role="menuitem"
                onClick={handleClearTool}
                disabled={!hasSelectedTools}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  hasSelectedTools
                    ? "hover:bg-muted/60"
                    : "cursor-default text-muted-foreground",
                )}
              >
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                <span className="flex-1 font-medium">Clear selection</span>
              </button>
            </div>
          ) : null}
        </div>

        <div className="inline-flex h-10 w-14 shrink-0 items-center justify-center">
          {hasSelectedTools ? (
            <div className="flex items-center gap-1">
              <div className="flex -space-x-2">
                {visibleToolOptions.map((option) => (
                  <span
                    key={`composer-tool-${option.id}`}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-primary/40 bg-primary/15 text-primary"
                    aria-label={`${option.label} tool selected`}
                  >
                    <option.icon className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                ))}
              </div>
              {overflowCount > 0 ? (
                <span className="inline-flex h-6 items-center justify-center rounded-full bg-primary/20 px-2 text-[10px] font-semibold uppercase tracking-wide text-primary">
                  +{overflowCount}
                </span>
              ) : null}
            </div>
          ) : (
            <span className="inline-flex h-6 w-6 items-center justify-center opacity-0">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          )}
        </div>

        <div className="relative flex-1">
          <label htmlFor="conversation-composer" className="sr-only">
            Message
          </label>
          <textarea
            id="conversation-composer"
            ref={textareaRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Ask Connexus to explore a new direction..."
            rows={1}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                submitMessage();
              }
            }}
            className="w-full resize-none border-none bg-transparent px-0 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none disabled:cursor-not-allowed disabled:opacity-70"
            disabled={isPending}
            aria-disabled={isPending}
            aria-invalid={error ? true : undefined}
            style={{ maxHeight: 160 }}
          />
        </div>

        <button
          type="submit"
          disabled={isPending}
          className={cn(
            "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70",
            isPending ? "animate-pulse" : "",
          )}
          aria-label="Send message"
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <SendHorizontal className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </form>

      <div className="flex items-center justify-center px-2">
        {error ? (
          <p className="text-xs text-destructive" role="status">
            {error}
          </p>
        ) : (
          <span className="text-xs text-muted-foreground">
            Enter to send · Shift+Enter for line break
          </span>
        )}
      </div>
    </div>
  );
}
