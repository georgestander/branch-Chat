"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { MarkdownContent } from "@/app/components/markdown/MarkdownContent";

interface StreamingBubbleProps {
  streamId: string;
  conversationId: string;
  branchId: string;
  className?: string;
}

export function StreamingBubble({
  streamId,
  conversationId,
  branchId,
  className,
}: StreamingBubbleProps) {
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<
    "connecting" | "streaming" | "complete" | "error"
  >("connecting");
  const sourceRef = useRef<EventSource | null>(null);
  const [html, setHtml] = useState("");
  const [reasoningSummary, setReasoningSummary] = useState("");
  const [toolProgressLabel, setToolProgressLabel] = useState<string | null>(null);

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
        const toolLabel = data?.tool === "web_search" ? "Web search" : "Tool";
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
          setHtml(renderMarkdownClient(data.content));
        }
        if (typeof data?.reasoningSummary === "string") {
          setReasoningSummary(data.reasoningSummary);
        }
      } catch {}
      setStatus("complete");
      es.close();
      try {
        const { emitCompleteStreaming } = require("@/app/components/conversation/streamingEvents");
        emitCompleteStreaming({ conversationId, branchId, streamId });
      } catch {}
    };
    const onError = () => {
      setStatus((s) => (s === "complete" ? s : "error"));
      try {
        es.close();
      } catch {}
    };

    es.addEventListener("start", onStart as EventListener);
    es.addEventListener("delta", onDelta as EventListener);
    es.addEventListener("reasoning_summary", onReasoningSummary as EventListener);
    es.addEventListener("tool_progress", onToolProgress as EventListener);
    es.addEventListener("complete", onComplete as EventListener);
    es.addEventListener("error", onError as EventListener);
    es.onerror = onError as any;

    return () => {
      try {
        es.close();
      } catch {}
      sourceRef.current = null;
    };
  }, [branchId, conversationId, streamId]);

  const statusLabel = useMemo(() => {
    if (status === "connecting") return "Connecting…";
    if (status === "streaming") return "Streaming response…";
    if (status === "complete") return "Response complete";
    return "Stream error";
  }, [status]);

  return (
    <div
      className={cn(
        "panel-surface panel-edge w-full rounded-2xl px-5 py-5 text-sm shadow-sm transition",
        className,
      )}
      aria-live="polite"
    >
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
