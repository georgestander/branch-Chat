"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { ConversationComposer } from "@/app/components/conversation/ConversationComposer";
import type { Branch, ConversationModelId } from "@/lib/conversation";
import type { RenderedMessage } from "@/lib/conversation/rendered";
import { cn } from "@/lib/utils";

import { BranchableMessage } from "./BranchableMessage";
import { MarkdownContent } from "@/app/components/markdown/MarkdownContent";
import { ToolInvocationSummary } from "@/app/components/conversation/ToolInvocationSummary";

const SCROLL_EPSILON_PX = 120;

interface BranchColumnProps {
  branch: Branch;
  messages: RenderedMessage[];
  conversationId: ConversationModelId;
  isActive: boolean;
  className?: string;
  withLeftBorder?: boolean;
  headerActions?: ReactNode;
  leadingActions?: ReactNode;
}

function AssistantPendingBubble() {
  return (
    <div
      className="w-full rounded-2xl bg-muted/30 px-4 py-4 shadow-sm ring-1 ring-border/30"
      aria-live="polite"
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/70" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:120ms]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:240ms]" />
          </span>
          <span>Connexus is preparing a response…</span>
        </div>
        <div className="mt-2 flex flex-col gap-3">
          <span className="h-3 w-4/5 rounded-full bg-muted-foreground/15 animate-pulse" />
          <span className="h-3 w-3/4 rounded-full bg-muted-foreground/10 animate-pulse" />
          <span className="h-3 w-1/2 rounded-full bg-muted-foreground/10 animate-pulse" />
        </div>
      </div>
    </div>
  );
}

export function BranchColumn({
  branch,
  messages,
  conversationId,
  isActive,
  className,
  withLeftBorder = true,
  headerActions,
  leadingActions,
}: BranchColumnProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const shouldRespectUserScrollRef = useRef(false);

  const visibleMessages = useMemo(
    () => messages.filter((message) => message.role !== "system"),
    [messages],
  );

  const lastMessage =
    visibleMessages.length > 0
      ? visibleMessages[visibleMessages.length - 1]
      : undefined;
  const isStreamingAssistant =
    isActive &&
    !!lastMessage &&
    lastMessage.role === "assistant" &&
    !lastMessage.tokenUsage;
  const awaitingAssistant = isActive && lastMessage?.role === "user";

  const scrollSignature = useMemo(() => {
    if (!lastMessage) {
      return `empty-${visibleMessages.length}`;
    }
    const suffix = lastMessage.tokenUsage ? "final" : "delta";
    return `${visibleMessages.length}-${lastMessage.id}-${lastMessage.content.length}-${suffix}`;
  }, [lastMessage, visibleMessages.length]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    const handleScroll = () => {
      const distanceFromBottom =
        container.scrollHeight -
        (container.scrollTop + container.clientHeight);
      shouldRespectUserScrollRef.current =
        distanceFromBottom > SCROLL_EPSILON_PX;
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", handleScroll);
    };
  }, []);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    const container = scrollContainerRef.current;
    const sentinel = sentinelRef.current;
    if (!container || !sentinel) {
      return;
    }

    const distanceFromBottom =
      container.scrollHeight - (container.scrollTop + container.clientHeight);

    if (
      shouldRespectUserScrollRef.current &&
      distanceFromBottom > SCROLL_EPSILON_PX
    ) {
      return;
    }

    requestAnimationFrame(() => {
      sentinel.scrollIntoView({
        block: "end",
        behavior: isStreamingAssistant ? "auto" : "smooth",
      });
    });
  }, [isActive, isStreamingAssistant, scrollSignature]);

  const stateLabel = isActive ? "Active" : "Parent";
  const referenceText = branch.createdFrom?.excerpt ?? null;

  return (
    <section
      className={cn(
        "flex min-h-0 flex-1 flex-col bg-background",
        withLeftBorder ? "border-l border-border" : "",
        className,
      )}
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3 text-sm">
        {leadingActions ? (
          <div className="flex items-center gap-2">{leadingActions}</div>
        ) : null}
        <h2 className="text-base font-semibold text-foreground">
          {branch.title || "Untitled Branch"}
        </h2>
        <span className="hidden h-4 w-px bg-border/70 sm:inline" aria-hidden="true" />
        <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          {stateLabel} Branch
        </span>
        {referenceText ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Reference:</span>
            <span className="text-foreground/85">“{referenceText}”</span>
          </span>
        ) : null}
        <span className="grow" aria-hidden="true" />
        {headerActions ? (
          <div className="flex items-center gap-2">{headerActions}</div>
        ) : null}
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${isActive ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}
        >
          {isActive ? "Editing" : "View Only"}
        </span>
      </header>

      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-5 py-6 pb-24"
      >
        <ol className="mx-auto flex w-full max-w-4xl flex-col gap-4">
          {visibleMessages.map((message) => (
            <li
              key={message.id}
              className={cn(
                "flex w-full",
                message.role === "user" ? "justify-end" : "justify-start",
              )}
            >
              <MessageBubble
                message={message}
                isActive={isActive}
                conversationId={conversationId}
                branch={branch}
              />
            </li>
          ))}
          {awaitingAssistant ? (
            <li className="flex w-full justify-start">
              <AssistantPendingBubble />
            </li>
          ) : null}
        </ol>
        <div ref={sentinelRef} aria-hidden className="h-px w-px" />
      </div>

      <div className="relative  bg-background px-1 pb-1 pt-1">
        <div
          aria-hidden
          className="pointer-events-none absolute"
        />
        <div className="relative z-10">
          {isActive ? (
            <ConversationComposer
              branchId={branch.id}
              conversationId={conversationId}
              autoFocus
              className=""
            />
          ) : (
            <div className="rounded-lg  px-1 py-1 text-sm text-muted-foreground">
              Switch to this branch to continue the conversation.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function MessageBubble({
  message,
  isActive,
  conversationId,
  branch,
}: {
  message: RenderedMessage;
  isActive: boolean;
  conversationId: ConversationModelId;
  branch: Branch;
}) {
  if (message.role === "user") {
    return (
      <UserMessageBubble
        message={message}
        className="inline-flex max-w-xl flex-col rounded-2xl bg-primary/10 px-4 py-3 text-sm shadow-sm text-primary"
      />
    );
  }

  const highlightClass = message.hasBranchHighlight
    ? "ring-2 ring-primary/40"
    : "";

  if (isActive && message.role === "assistant") {
    const isStreaming = !message.tokenUsage;
    return (
      <div
        className={cn(
          "w-full rounded-2xl bg-card px-4 py-4 shadow-sm transition",
          highlightClass,
          "[&_.prose]:mt-0",
        )}
      >
        <BranchableMessage
          branchId={branch.id}
          conversationId={conversationId}
          messageId={message.id}
          content={message.content}
          renderedHtml={message.renderedHtml}
          toolInvocations={message.toolInvocations}
        />
        {isStreaming ? (
          <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/70" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:120ms]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:240ms]" />
            </span>
            <span>Streaming response…</span>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "w-full rounded-2xl bg-muted/40 px-4 py-4 text-sm shadow-sm transition",
        highlightClass,
        "[&_.prose]:mt-0",
      )}
    >
      <MarkdownContent
        className="prose prose-sm max-w-none text-foreground"
        html={message.renderedHtml}
      />
      <ToolInvocationSummary
        toolInvocations={message.toolInvocations}
        fallbackHtml={message.renderedHtml}
        className="mt-3"
      />
    </div>
  );
}

function UserMessageBubble({
  message,
  className,
}: {
  message: RenderedMessage;
  className?: string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const previewText = useMemo(() => {
    const normalized = message.content.replace(/\s+/g, " ").trim();
    if (!normalized) {
      return "User prompt";
    }
    return normalized.length > 96
      ? `${normalized.slice(0, 93)}…`
      : normalized;
  }, [message.content]);

  return (
    <div className={cn(className, message.hasBranchHighlight ? "ring-2 ring-primary/50" : "", "transition")}>
      <button
        type="button"
        onClick={() => setIsExpanded((value) => !value)}
        className="flex items-start justify-between gap-3 text-left"
        aria-expanded={isExpanded}
      >
        <span className="font-medium leading-relaxed">
          “{previewText}”
        </span>
        <span className="shrink-0 text-xs font-semibold uppercase tracking-[0.18em] text-primary/70">
          {isExpanded ? "Hide" : "Show"}
        </span>
      </button>

      <div
        className={cn(
          "overflow-hidden pt-3 text-primary transition-all duration-300 ease-out",
          isExpanded ? "max-h-[100rem] opacity-100" : "max-h-0 opacity-0",
          "[&_.prose]:text-primary [&_.prose strong]:text-primary",
        )}
      >
        <MarkdownContent
          className="prose prose-sm max-w-none text-primary"
          html={message.renderedHtml}
        />
      </div>
    </div>
  );
}
