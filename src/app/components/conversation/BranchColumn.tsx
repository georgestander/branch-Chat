"use client";

import { useEffect, useMemo, useRef } from "react";

import { ConversationComposer } from "@/app/components/conversation/ConversationComposer";
import type { Branch, ConversationModelId } from "@/lib/conversation";
import type { RenderedMessage } from "@/lib/conversation/rendered";
import { cn } from "@/lib/utils";

import { BranchableMessage } from "./BranchableMessage";
import { MarkdownContent } from "@/app/components/markdown/MarkdownContent";

const SCROLL_EPSILON_PX = 120;

interface BranchColumnProps {
  branch: Branch;
  messages: RenderedMessage[];
  conversationId: ConversationModelId;
  isActive: boolean;
  className?: string;
  withLeftBorder?: boolean;
}

export function BranchColumn({
  branch,
  messages,
  conversationId,
  isActive,
  className,
  withLeftBorder = true,
}: BranchColumnProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const shouldRespectUserScrollRef = useRef(false);

  const lastMessage =
    messages.length > 0 ? messages[messages.length - 1] : undefined;
  const isStreamingAssistant =
    isActive &&
    !!lastMessage &&
    lastMessage.role === "assistant" &&
    !lastMessage.tokenUsage;

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
      <header className="flex items-center justify-between border-b border-border px-5 py-4">
        <div className="flex flex-col">
          <h2 className="text-lg font-semibold text-foreground">
            {branch.title || "Untitled Branch"}
          </h2>
          <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            {stateLabel} Branch
          </span>
        </div>
        <div className={`rounded-full px-3 py-1 text-xs ${isActive ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
          {isActive ? "Editing" : "View Only"}
        </div>
      </header>

      {isActive && referenceText ? (
        <div className="border-b border-border/60 bg-primary/5 px-5 py-3 text-sm text-primary">
          <span className="font-semibold">Reference:</span>{" "}
          <span className="text-foreground/90">“{referenceText}”</span>
        </div>
      ) : null}

      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-5 py-6 pb-24"
      >
        <ol className="flex flex-col gap-4">
          {messages.map((message) => (
            <li key={message.id}>
              <MessageBubble
                message={message}
                isActive={isActive}
                conversationId={conversationId}
                branch={branch}
              />
            </li>
          ))}
        </ol>
        <div ref={sentinelRef} aria-hidden className="h-px w-px" />
      </div>

      <div className="relative border-t border-border/60 bg-background px-5 pb-6 pt-4">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-10 left-0 right-0 h-10 bg-gradient-to-t from-background via-background/95 to-transparent"
        />
        <div className="relative z-10">
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

  const commonHeader = (
    <div className="flex items-center justify-between">
      <span className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
        {message.role}
      </span>
      <span className="text-xs text-muted-foreground">
        {formatTimestamp(message.createdAt)}
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
          renderedHtml={message.renderedHtml}
        />
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg border border-border px-4 py-3 shadow-sm ${message.hasBranchHighlight ? "bg-primary/5" : "bg-card"}`}
    >
      {commonHeader}
      <MarkdownContent
        className="prose prose-sm mt-3 max-w-none text-foreground"
        html={message.renderedHtml}
      />
    </div>
  );
}

function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }
  const iso = date.toISOString();
  const [dayPart, timePart] = iso.split("T");
  const time = timePart?.slice(0, 8) ?? "00:00:00";
  return `${dayPart}, ${time} UTC`;
}
