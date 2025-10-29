"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Plus, SendHorizontal } from "lucide-react";

import {
  getConversationSummary,
  sendMessage,
} from "@/app/pages/conversation/functions";
import { cn } from "@/lib/utils";
import { emitDirectoryUpdate } from "@/app/components/conversation/directoryEvents";
import {
  emitOptimisticUserMessage,
  emitOptimisticMessageClear,
} from "@/app/components/conversation/messageEvents";

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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingRefreshTimers = useRef<number[]>([]);

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
        const result = await sendMessage({
          conversationId,
          branchId,
          content,
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

  return (
    <div className={cn("mx-auto flex w-full max-w-3xl flex-col gap-2", className)}>
      <form
        onSubmit={handleSubmit}
        className="flex items-end gap-3 rounded-full border border-border/70 bg-card/95 px-1 py-2"
      >
        <button
          type="button"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-background"
          aria-label="New prompt options"
        >
          <Plus className="h-5 w-5" aria-hidden="true" />
        </button>

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
