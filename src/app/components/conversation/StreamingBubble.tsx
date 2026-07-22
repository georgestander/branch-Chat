"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { MarkdownContent } from "@/app/components/markdown/MarkdownContent";
import { emitCompleteStreaming } from "@/app/components/conversation/streamingEvents";
import { cancelMessage } from "@/app/pages/conversation/functions";
import { Pencil, Square, Trash2 } from "lucide-react";

interface StreamingBubbleProps {
  streamId: string;
  conversationId: string;
  branchId: string;
  className?: string;
  compact?: boolean;
  emitCompletionEvent?: boolean;
  onConnected?: (streamId: string) => void;
  originalPrompt?: string | null;
}

export function cancelledPromptStorageKey(conversationId: string, branchId: string) {
  return `connexus:cancelled-prompt:${conversationId}:${branchId}`;
}

export function StreamingBubble({
  streamId,
  conversationId,
  branchId,
  className,
  compact = false,
  emitCompletionEvent = true,
  onConnected,
  originalPrompt = null,
}: StreamingBubbleProps) {
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<
    "connecting" | "streaming" | "complete" | "error"
  >("connecting");
  const sourceRef = useRef<EventSource | null>(null);
  const [html, setHtml] = useState("");
  const [reasoningSummary, setReasoningSummary] = useState("");
  const [toolProgressLabel, setToolProgressLabel] = useState<string | null>(null);
  const [isStopMenuOpen, setIsStopMenuOpen] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const cancellationModeRef = useRef<"edit" | "discard" | null>(null);
  const onConnectedRef = useRef(onConnected);

  useEffect(() => {
    onConnectedRef.current = onConnected;
  }, [onConnected]);

  function escapeHtml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function renderMarkdownClient(markdown: string): string {
    // Basic, safe client-side markdown for streaming: bold, italic, code, links, lists, paragraphs
    // 1) Escape HTML first
    let text = escapeHtml(markdown);
    // 2) Inline code
    text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
    // 3) Bold (**text**)
    text = text.replace(/\*\*([^\*]+)\*\*/g, "<strong>$1</strong>");
    // 4) Italic (*text*) — avoid conflict with bold already handled
    text = text.replace(/(^|\W)\*([^\*]+)\*(?=\W|$)/g, "$1<em>$2</em>");
    // 5) Links [text](url)
    text = text.replace(
      /\[([^\]]+)\]\((https?:[^\)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1<\/a>',
    );

    // 6) Lists: convert consecutive lines starting with - or * into <ul><li>
    const lines = text.split(/\n/);
    const out: string[] = [];
    let inList = false;
    for (const line of lines) {
      const match = /^\s*[-\*]\s+(.+)$/.exec(line);
      if (match) {
        if (!inList) {
          inList = true;
          out.push("<ul>");
        }
        out.push(`<li>${match[1]}</li>`);
      } else {
        if (inList) {
          inList = false;
          out.push("</ul>");
        }
        // Paragraph handling: blank line => spacer, otherwise keep line
        if (line.trim() === "") {
          out.push("<br/>");
        } else {
          out.push(line);
        }
      }
    }
    if (inList) out.push("</ul>");

    // 7) Wrap double-newlines into paragraphs lightly by splitting on <br/><br/>
    const joined = out.join("\n");
    const paragraphs = joined
      .split(/(?:<br\/>\s*){2,}/i)
      .map((p) => `<p>${p}</p>`);
    return paragraphs.join("\n");
  }

  useEffect(() => {
    if (!streamId) return;
    // Close any existing stream
    if (sourceRef.current) {
      try {
        sourceRef.current.close();
      } catch {}
      sourceRef.current = null;
    }
    const url = `/events?streamId=${encodeURIComponent(streamId)}`;
    const es = new EventSource(url, { withCredentials: false });
    sourceRef.current = es;
    setStatus("connecting");
    setReasoningSummary("");
    setToolProgressLabel(null);

    const onOpen = () => onConnectedRef.current?.(streamId);
    const onStart = () => setStatus("streaming");
    const onDelta = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (typeof data?.content === "string") {
          setContent(data.content);
          setStatus("streaming");
          setHtml(renderMarkdownClient(data.content));
          return;
        }
        if (typeof data?.delta === "string" && data.delta.length > 0) {
          setContent((previous) => {
            const next = `${previous}${data.delta}`;
            setHtml(renderMarkdownClient(next));
            return next;
          });
          setStatus("streaming");
        }
      } catch {
        // ignore
      }
    };
    const onReasoningSummary = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (typeof data?.content === "string") {
          setReasoningSummary(data.content);
          return;
        }
        if (typeof data?.delta === "string" && data.delta.length > 0) {
          setReasoningSummary((previous) => `${previous}${data.delta}`);
        }
      } catch {
        // ignore
      }
    };
    const onToolProgress = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        const toolLabel =
          data?.tool === "web_search"
            ? "Web search"
            : data?.tool === "image_generation"
              ? "Image generation"
            : data?.tool === "attachment_retrieval"
              ? "Attachments"
              : "Tool";
        const nextStatus =
          typeof data?.status === "string"
            ? data.status.replaceAll("_", " ")
            : "running";
        setToolProgressLabel(`${toolLabel}: ${nextStatus}`);
      } catch {
        // ignore
      }
    };
    const onComplete = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (typeof data?.content === "string") {
          setContent(data.content);
          if (typeof data?.renderedHtml === "string" && data.renderedHtml.length > 0) {
            setHtml(data.renderedHtml);
          } else {
            setHtml(renderMarkdownClient(data.content));
          }
        }
        if (typeof data?.reasoningSummary === "string") {
          setReasoningSummary(data.reasoningSummary);
        }
      } catch {}
      setStatus("complete");
      es.close();
      if (emitCompletionEvent) {
        try {
          const { emitCompleteStreaming } = require("@/app/components/conversation/streamingEvents");
          emitCompleteStreaming({ conversationId, branchId, streamId });
        } catch {}
      }
    };
    const onError = () => {
      setStatus((s) => (s === "complete" ? s : "error"));
      try {
        es.close();
      } catch {}
    };
    const onCancelled = () => {
      setContent("");
      setHtml("");
      setStatus("complete");
      es.close();
      if (emitCompletionEvent) {
        emitCompleteStreaming({ conversationId, branchId, streamId });
      }
      if (cancellationModeRef.current === "edit" && originalPrompt) {
        window.sessionStorage.setItem(
          cancelledPromptStorageKey(conversationId, branchId),
          originalPrompt,
        );
      }
      window.location.reload();
    };

    es.addEventListener("open", onOpen as EventListener);
    es.addEventListener("start", onStart as EventListener);
    es.addEventListener("delta", onDelta as EventListener);
    es.addEventListener("reasoning_summary", onReasoningSummary as EventListener);
    es.addEventListener("tool_progress", onToolProgress as EventListener);
    es.addEventListener("complete", onComplete as EventListener);
    es.addEventListener("cancelled", onCancelled as EventListener);
    es.addEventListener("error", onError as EventListener);
    es.onerror = onError as any;

    return () => {
      try {
        es.close();
      } catch {}
      sourceRef.current = null;
    };
  }, [branchId, conversationId, emitCompletionEvent, originalPrompt, streamId]);

  const stopGeneration = async (mode: "edit" | "discard") => {
    cancellationModeRef.current = mode;
    setIsStopMenuOpen(false);
    setStopError(null);
    try {
      await cancelMessage({ conversationId, streamId });
    } catch (error) {
      cancellationModeRef.current = null;
      setStopError(error instanceof Error ? error.message : "Unable to stop response");
    }
  };

  const statusLabel = useMemo(() => {
    if (status === "connecting") return "Connecting…";
    if (status === "streaming") return "Streaming response…";
    if (status === "complete") return "Response complete";
    return "Stream error";
  }, [status]);

  return (
    <div
      className={cn(
        compact
          ? "w-full px-1 py-2 text-sm"
          : "panel-surface panel-edge w-full rounded-2xl px-5 py-5 text-sm shadow-sm transition",
        className,
      )}
      aria-live="polite"
    >
      {status !== "complete" ? (
        <div className="relative mb-2 flex justify-end">
          <button
            type="button"
            onClick={() => setIsStopMenuOpen((open) => !open)}
            className="inline-flex h-7 items-center gap-1 rounded border border-destructive/60 px-2 text-[11px] font-semibold text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-haspopup="menu"
            aria-expanded={isStopMenuOpen}
          >
            <Square className="h-3 w-3 fill-current" aria-hidden="true" /> Stop
          </button>
          {isStopMenuOpen ? (
            <div className="absolute right-0 top-full z-20 mt-1 w-40 rounded border border-border bg-popover p-1 shadow-lg" role="menu">
              <button type="button" role="menuitem" onClick={() => void stopGeneration("edit")} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-muted">
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Stop & edit prompt
              </button>
              <button type="button" role="menuitem" onClick={() => void stopGeneration("discard")} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-destructive hover:bg-destructive/10">
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Stop & discard
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {stopError ? <p className="mb-2 text-xs text-destructive">{stopError}</p> : null}
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/70" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:120ms]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:240ms]" />
        </span>
        <span>{statusLabel}</span>
      </div>
      {toolProgressLabel ? (
        <p className="mb-2 text-xs text-muted-foreground">{toolProgressLabel}</p>
      ) : null}
      {reasoningSummary ? (
        <details className="mb-3 rounded-md border border-foreground/15 bg-background/50 px-3 py-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer font-medium text-foreground">
            Reasoning summary
          </summary>
          <p className="mt-2 whitespace-pre-wrap">{reasoningSummary}</p>
        </details>
      ) : null}
      <MarkdownContent
        className="prose prose-sm max-w-none text-foreground"
        html={html || escapeHtml(content)}
      />
    </div>
  );
}
