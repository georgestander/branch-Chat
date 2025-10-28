"use client";

import { useEffect, useMemo, useRef } from "react";

import { BranchableMessage } from "@/app/components/conversation/BranchableMessage";
import { ConversationComposer } from "@/app/components/conversation/ConversationComposer";
import type {
  Branch,
  BranchSpan,
  ConversationModelId,
  Message,
} from "@/lib/conversation";

interface BranchColumnInteractiveProps {
  branch: Branch;
  messages: Message[];
  conversationId: ConversationModelId;
  isActive: boolean;
  highlight?: {
    messageId: string;
    span?: BranchSpan | null;
  };
}

const SCROLL_EPSILON_PX = 120;

export function BranchColumnInteractive({
  branch,
  messages,
  conversationId,
  isActive,
  highlight,
}: BranchColumnInteractiveProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const shouldRespectUserScrollRef = useRef(false);

  const lastMessage =
    messages.length > 0 ? messages[messages.length - 1] : undefined;
  const isStreamingAssistant =
    Boolean(isActive) &&
    Boolean(lastMessage) &&
    lastMessage?.role === "assistant" &&
    !lastMessage?.tokenUsage;

  const scrollSignature = useMemo(() => {
    if (!lastMessage) {
      return `empty-${messages.length}`;
    }
    const suffix = lastMessage.tokenUsage ? "final" : "delta";
    return `${messages.length}-${lastMessage.id}-${lastMessage.content.length}-${suffix}`;
  }, [lastMessage, messages.length]);

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

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-5 py-6"
      >
        <ol className="flex flex-col gap-4 pb-36">
          {messages.map((message) => (
            <li key={message.id}>
              <MessageBubble
                message={message}
                isActive={isActive}
                highlight={
                  highlight?.messageId === message.id
                    ? highlight?.span ?? null
                    : null
                }
                conversationId={conversationId}
                branch={branch}
              />
            </li>
          ))}
        </ol>

        <div className="sticky bottom-0 mt-6 -mx-5 bg-gradient-to-t from-background via-background/95 to-transparent px-5 pb-6 pt-4 backdrop-blur-sm">
          {isActive ? (
            <ConversationComposer
              branchId={branch.id}
              conversationId={conversationId}
              autoFocus
              className="shadow-lg shadow-black/5"
            />
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-card/80 px-4 py-3 text-sm text-muted-foreground">
              Switch to this branch to continue the conversation.
            </div>
          )}
        </div>

        <div ref={sentinelRef} aria-hidden className="h-px w-px" />
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  highlight,
  isActive,
  conversationId,
  branch,
}: {
  message: Message;
  highlight: BranchSpan | null;
  isActive: boolean;
  conversationId: ConversationModelId;
  branch: Branch;
}) {
  const highlightContent = highlight
    ? renderHighlightedContent(message.content, highlight)
    : message.content;

  const commonHeader = (
    <div className="flex items-center justify-between">
      <span className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
        {message.role}
      </span>
      <span className="text-xs text-muted-foreground">
        {new Date(message.createdAt).toLocaleString()}
      </span>
    </div>
  );

  if (isActive && message.role === "assistant") {
    return (
      <div className="rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
        {commonHeader}
        <BranchableMessage
          branchId={branch.id}
          conversationId={conversationId}
          messageId={message.id}
          content={message.content}
        />
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg border border-border px-4 py-3 shadow-sm ${highlight ? "bg-primary/5" : "bg-card"}`}
    >
      {commonHeader}
      <div className="prose prose-sm mt-3 max-w-none whitespace-pre-wrap text-foreground">
        {highlight ? highlightContent : message.content}
      </div>
    </div>
  );
}

function renderHighlightedContent(content: string, span: BranchSpan) {
  const start = Math.max(0, Math.min(span.start, content.length));
  const end = Math.max(start, Math.min(span.end, content.length));

  const before = content.slice(0, start);
  const highlight = content.slice(start, end);
  const after = content.slice(end);

  return (
    <span className="whitespace-pre-wrap">
      {before}
      <mark className="rounded bg-primary/20 px-0.5 text-primary">
        {highlight}
      </mark>
      {after}
    </span>
  );
}
