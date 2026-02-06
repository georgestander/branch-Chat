"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { ChevronDown, File as FileIcon, FileText, Image as ImageIcon, type LucideIcon } from "lucide-react";

import { ConversationComposer } from "@/app/components/conversation/ConversationComposer";
import type { Branch, ConversationModelId, MessageAttachment } from "@/lib/conversation";
import type { RenderedMessage } from "@/lib/conversation/rendered";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/app/shared/uploads.config";

import { BranchableMessage } from "./BranchableMessage";
import { MarkdownContent } from "@/app/components/markdown/MarkdownContent";
import { ToolInvocationSummary } from "@/app/components/conversation/ToolInvocationSummary";
import {
  useOptimisticMessageEvents,
  type OptimisticMessageDetail,
  type ClearOptimisticMessageDetail,
} from "@/app/components/conversation/messageEvents";
import { StreamingBubble } from "@/app/components/conversation/StreamingBubble";
import { START_STREAMING_EVENT, COMPLETE_STREAMING_EVENT, type StartStreamingDetail } from "@/app/components/conversation/streamingEvents";
import { navigate } from "rwsdk/client";
import type { OpenRouterModelOption } from "@/lib/openrouter/models";

const SCROLL_EPSILON_PX = 120;
type OptimisticMessageStatus = "pending" | "resolved";

interface OptimisticEntry {
  message: RenderedMessage;
  status: OptimisticMessageStatus;
  replacementMessageId?: string | null;
}

interface BranchColumnProps {
  branch: Branch;
  messages: RenderedMessage[];
  conversationId: ConversationModelId;
  isActive: boolean;
  className?: string;
  withLeftBorder?: boolean;
  headerActions?: ReactNode;
  leadingActions?: ReactNode;
  style?: React.CSSProperties;
  highlightedBranchId?: string | null;
  conversationModel: string;
  reasoningEffort: "low" | "medium" | "high" | null;
  openRouterModels: OpenRouterModelOption[];
  onConversationSettingsChange: (
    model: string,
    effort: "low" | "medium" | "high" | null,
  ) => Promise<boolean>;
  conversationSettingsSaving: boolean;
  conversationSettingsError: string | null;
  onClearConversationSettingsError: () => void;
  composerBootstrapMessage?: string | null;
  onComposerBootstrapConsumed?: () => void;
}

function AssistantPendingBubble() {
  return (
    <div
      className="panel-surface panel-edge w-full rounded-2xl px-5 py-5 shadow-sm"
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

function createOptimisticRenderedMessage(
  detail: OptimisticMessageDetail,
): RenderedMessage {
  return {
    id: detail.messageId,
    branchId: detail.branchId,
    role: "user",
    content: detail.content,
    createdAt: detail.createdAt,
    tokenUsage: null,
    attachments: [],
    toolInvocations: null,
    hasBranchHighlight: false,
    renderedHtml: formatOptimisticHtml(detail.content),
  };
}

function formatOptimisticHtml(content: string): string {
  return escapeHtml(content).replace(/\n/g, "<br />");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
  style,
  highlightedBranchId,
  conversationModel,
  reasoningEffort,
  openRouterModels,
  onConversationSettingsChange,
  conversationSettingsSaving,
  conversationSettingsError,
  onClearConversationSettingsError,
  composerBootstrapMessage,
  onComposerBootstrapConsumed,
}: BranchColumnProps) {
  const scrollPaddingClass = isActive ? "pb-44" : "pb-10";
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const lastHighlightScrollRef = useRef<string | null>(null);
  const lastStreamAnchorRef = useRef<string | null>(null);
  const shouldRespectUserScrollRef = useRef(false);
  const [optimisticMessages, setOptimisticMessages] = useState<OptimisticEntry[]>([]);
  const [activeStreamId, setActiveStreamId] = useState<string | null>(null);

  const handleOptimisticAppend = useCallback(
    (detail: OptimisticMessageDetail) => {
      setOptimisticMessages((current) => [
        ...current,
        {
          message: createOptimisticRenderedMessage(detail),
          status: "pending",
        },
      ]);
    },
    [],
  );

  const handleOptimisticClear = useCallback((detail: ClearOptimisticMessageDetail) => {
    setOptimisticMessages((current) => {
      if (detail.reason === "failed") {
        const next = current.filter(
          (entry) => entry.message.id !== detail.messageId,
        );
        return next.length === current.length ? current : next;
      }

      let didUpdate = false;
      const next = current.map((entry) => {
        if (entry.message.id !== detail.messageId) {
          return entry;
        }

        if (
          entry.status === "resolved" &&
          entry.replacementMessageId === detail.replacementMessageId
        ) {
          return entry;
        }

        didUpdate = true;
        return {
          ...entry,
          status: "resolved" as const,
          replacementMessageId: detail.replacementMessageId ?? null,
        };
      });

      return didUpdate ? next : current;
    });
  }, []);

  useOptimisticMessageEvents({
    conversationId,
    branchId: branch.id,
    onAppend: handleOptimisticAppend,
    onClear: handleOptimisticClear,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (event: Event) => {
      const custom = event as CustomEvent<StartStreamingDetail>;
      const detail = custom.detail;
      if (!detail) return;
      if (detail.conversationId !== conversationId || detail.branchId !== branch.id) return;
      setActiveStreamId(detail.streamId);
    };
    window.addEventListener(START_STREAMING_EVENT, handler as EventListener);
    return () => {
      window.removeEventListener(START_STREAMING_EVENT, handler as EventListener);
    };
  }, [branch.id, conversationId]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    const handleHighlightClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }
      const highlight = target.closest("mark[data-branch-id]") as HTMLElement | null;
      if (!highlight) {
        return;
      }
      const targetBranchId = highlight.getAttribute("data-branch-id");
      if (!targetBranchId) {
        return;
      }
      const params = new URLSearchParams({
        conversationId,
        branchId: targetBranchId,
      });
      navigate(`/?${params.toString()}`);
    };

    container.addEventListener("click", handleHighlightClick);
    return () => {
      container.removeEventListener("click", handleHighlightClick);
    };
  }, [conversationId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleComplete = (event: Event) => {
      const custom = event as CustomEvent<{ conversationId: string; branchId: string; streamId: string }>;
      const detail = custom.detail;
      if (!detail) return;
      if (detail.conversationId !== conversationId || detail.branchId !== branch.id) return;
      setActiveStreamId(null);
      // Soft refresh to get server-rendered, sanitized markdown for the final message
      try {
        navigate(window.location.href);
      } catch {
        window.location.reload();
      }
    };
    window.addEventListener(COMPLETE_STREAMING_EVENT, handleComplete as EventListener);
    return () => {
      window.removeEventListener(COMPLETE_STREAMING_EVENT, handleComplete as EventListener);
    };
  }, [branch.id, conversationId]);

  useEffect(() => {
    setOptimisticMessages((current) => {
      if (current.length === 0) {
        return current;
      }

      const next = current.filter((entry) => {
        if (entry.status === "resolved") {
          if (entry.replacementMessageId) {
            const replacementExists = messages.some(
              (message) => message.id === entry.replacementMessageId,
            );
            if (replacementExists) {
              return false;
            }
          }

          const hasContentMatch = messages.some(
            (message) =>
              message.role === "user" &&
              message.content.trim() === entry.message.content.trim(),
          );

          if (hasContentMatch) {
            return false;
          }
        }

        return true;
      });

      return next.length === current.length ? current : next;
    });
  }, [messages]);

  const combinedMessages = useMemo(
    () => [...messages, ...optimisticMessages.map((entry) => entry.message)],
    [messages, optimisticMessages],
  );

  const visibleMessages = useMemo(
    () => combinedMessages.filter((message) => message.role !== "system"),
    [combinedMessages],
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
    if (!highlightedBranchId) {
      return;
    }
    if (lastHighlightScrollRef.current === highlightedBranchId) {
      return;
    }
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }
    const safeBranchId =
      typeof CSS !== "undefined" && "escape" in CSS
        ? (CSS.escape as (value: string) => string)(highlightedBranchId)
        : highlightedBranchId;
    const highlight = container.querySelector<HTMLElement>(
      `mark[data-branch-id="${safeBranchId}"]`,
    );
    if (!highlight) {
      return;
    }
    lastHighlightScrollRef.current = highlightedBranchId;
    requestAnimationFrame(() => {
      highlight.scrollIntoView({ block: "center" });
    });
  }, [highlightedBranchId, scrollSignature]);

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

    if (isStreamingAssistant && lastMessage?.id) {
      const nextStreamId = lastMessage.id;
      if (lastStreamAnchorRef.current !== nextStreamId) {
        lastStreamAnchorRef.current = nextStreamId;
        const target = container.querySelector<HTMLElement>(
          `[data-message-id="${nextStreamId}"]`,
        );
        if (target) {
          requestAnimationFrame(() => {
            target.scrollIntoView({ block: "start", behavior: "auto" });
          });
          return;
        }
      }
      return;
    }

    lastStreamAnchorRef.current = null;
    requestAnimationFrame(() => {
      sentinel.scrollIntoView({
        block: "end",
        behavior: "smooth",
      });
    });
  }, [isActive, isStreamingAssistant, lastMessage?.id, scrollSignature]);

  const stateLabel = isActive ? "Active" : "Parent";
  const referenceText = branch.createdFrom?.excerpt ?? null;

  const truncatedReference = useMemo(() => {
    if (!referenceText) {
      return "";
    }

    if (referenceText.length <= 20) {
      return referenceText;
    }

    return `${referenceText.slice(0, 20).trimEnd()}…`;
  }, [referenceText]);

  return (
    <section
      className={cn(
        "relative flex min-h-0 min-w-0 flex-1 flex-col bg-transparent",
        withLeftBorder ? "border-l border-foreground/15" : "",
        className,
      )}
      style={style}
    >
      <header className="flex min-h-[64px] items-center gap-3 border-b border-foreground/15 bg-background/70 px-6 py-4 text-sm backdrop-blur">
        {leadingActions ? (
          <div className="flex items-center gap-2">{leadingActions}</div>
        ) : null}
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-base font-semibold text-foreground sm:text-[1.05rem]">
            {branch.title || "Untitled Branch"}
          </h2>
          <span className="hidden h-4 w-px bg-foreground/15 sm:inline" aria-hidden="true" />
          <span className="text-[0.65rem] uppercase tracking-[0.24em] text-muted-foreground sm:text-[0.7rem]">
            {stateLabel} Branch
          </span>
          {referenceText ? (
            <span
              className="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
              title={`Reference: “${referenceText}”`}
            >
              <ChevronDown aria-hidden className="h-3 w-3 opacity-60" />
              <span className="font-semibold text-foreground">Reference:</span>
              <span className="truncate text-foreground/85">
                “{truncatedReference}”
              </span>
            </span>
          ) : null}
        </div>
        <span className="grow" aria-hidden="true" />
        {headerActions ? (
          <div className="flex items-center gap-2">{headerActions}</div>
        ) : null}
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${isActive ? "border-primary/40 bg-primary/15 text-primary" : "border-foreground/15 bg-background/70 text-muted-foreground"}`}
        >
          {isActive ? "Editing" : "View Only"}
        </span>
      </header>

      <div
        ref={scrollContainerRef}
        className={cn("flex-1 overflow-y-auto px-6 py-8", scrollPaddingClass)}
      >
        <ol className="flex w-full flex-col gap-4">
          {visibleMessages.map((message) => (
            <li
              key={message.id}
              className={cn(
                "flex w-full",
                message.role === "user" ? "justify-end" : "justify-start",
              )}
              data-message-id={message.id}
              data-message-role={message.role}
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
              {activeStreamId ? (
                <StreamingBubble streamId={activeStreamId} conversationId={conversationId} branchId={branch.id} />
              ) : (
                <AssistantPendingBubble />
              )}
            </li>
          ) : null}
        </ol>
        <div ref={sentinelRef} aria-hidden className="h-px w-px" />
      </div>

      {isActive ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 z-20 flex justify-center">
          <div className="pointer-events-auto w-full max-w-[640px] px-4 sm:px-5">
            <div className="floating-composer halo-border rounded-[28px] px-4 py-3">
              <ConversationComposer
                branchId={branch.id}
                conversationId={conversationId}
                autoFocus
                className=""
            conversationModel={conversationModel}
            reasoningEffort={reasoningEffort}
            openRouterModels={openRouterModels}
            onConversationSettingsChange={onConversationSettingsChange}
                conversationSettingsSaving={conversationSettingsSaving}
                conversationSettingsError={conversationSettingsError}
                onClearConversationSettingsError={onClearConversationSettingsError}
                bootstrapMessage={composerBootstrapMessage}
                onBootstrapConsumed={onComposerBootstrapConsumed}
              />
            </div>
          </div>
        </div>
      ) : null}
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
    return <UserMessageBubble message={message} />;
  }

  const highlightClass = message.hasBranchHighlight
    ? "ring-2 ring-primary"
    : "";

  if (isActive && message.role === "assistant") {
    const isStreaming = !message.tokenUsage;
    return (
      <div
        className={cn(
          "panel-surface panel-edge w-full rounded-2xl px-5 py-5 transition",
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
        "panel-surface panel-edge w-full rounded-2xl px-5 py-5 text-sm transition",
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

const COLLAPSED_USER_MESSAGE_HEIGHT_PX = 208;

function UserMessageBubble({ message }: { message: RenderedMessage }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isCollapsible, setIsCollapsible] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const attachments = Array.isArray(message.attachments)
    ? (message.attachments as MessageAttachment[])
    : [];
  const hasAttachments = attachments.length > 0;

  const updateCollapsibleState = useCallback(() => {
    const element = contentRef.current;
    if (!element) {
      return;
    }
    const requiresExpansion =
      element.scrollHeight > COLLAPSED_USER_MESSAGE_HEIGHT_PX + 4;
    setIsCollapsible(requiresExpansion);
  }, []);

  useEffect(() => {
    setIsExpanded(false);
  }, [message.id]);

  useEffect(() => {
    updateCollapsibleState();
  }, [updateCollapsibleState, message.renderedHtml, message.toolInvocations]);

  useEffect(() => {
    const element = contentRef.current;
    if (!element) {
      return;
    }
    const resizeObserver = new ResizeObserver(() => {
      updateCollapsibleState();
    });
    resizeObserver.observe(element);
    return () => {
      resizeObserver.disconnect();
    };
  }, [updateCollapsibleState]);

  const handleToggle = () => {
    if (!isCollapsible) {
      return;
    }
    setIsExpanded((value) => !value);
  };

  return (
    <div className="flex w-full flex-col gap-3">
      {hasAttachments ? (
        <div className="flex flex-wrap gap-2">
          {attachments.map((attachment) => (
            <AttachmentCard key={attachment.id} attachment={attachment} />
          ))}
        </div>
      ) : null}

      <div
        className={cn(
          "panel-edge w-full rounded-2xl bg-primary/10 px-4 py-3 text-sm text-foreground transition",
          message.hasBranchHighlight ? "ring-2 ring-primary" : "",
        )}
      >
        {isCollapsible ? (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleToggle}
              className="text-xs font-semibold uppercase tracking-[0.18em] text-primary/70 transition hover:text-primary"
              aria-expanded={isExpanded}
            >
              {isExpanded ? "Hide" : "Show"}
            </button>
          </div>
        ) : null}

        <div className={cn("relative", isCollapsible ? "pt-3" : undefined)}>
          <div
            ref={contentRef}
            className={cn(
              "overflow-hidden text-foreground transition-all duration-300 ease-out",
              isExpanded || !isCollapsible
                ? "max-h-[100rem] opacity-100"
                : "max-h-[13rem] opacity-100",
              "[&_.prose]:text-foreground [&_.prose strong]:text-foreground",
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
          {isCollapsible && !isExpanded ? (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-primary/15 to-transparent"
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AttachmentCard({ attachment }: { attachment: MessageAttachment }) {
  const Icon = resolveAttachmentIcon(attachment.contentType);
  return (
    <div className="panel-edge flex min-w-[180px] items-center gap-3 rounded-xl bg-background/80 px-3 py-2 text-sm text-foreground">
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-foreground/20 bg-background">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-semibold text-foreground">{attachment.name}</span>
        <span className="text-xs text-muted-foreground">
          {attachment.contentType} · {formatBytes(attachment.size)}
        </span>
      </div>
    </div>
  );
}

function resolveAttachmentIcon(contentType: string): LucideIcon {
  if (contentType.startsWith("image/")) {
    return ImageIcon;
  }
  if (contentType === "application/pdf" || contentType.startsWith("text/")) {
    return FileText;
  }
  return FileIcon;
}
