"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface StreamingBubbleProps {
  streamId: string;
  conversationId: string;
  branchId: string;
  className?: string;
}

export function StreamingBubble({ streamId, conversationId, branchId, className }: StreamingBubbleProps) {
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<"connecting" | "streaming" | "complete" | "error">(
    "connecting",
  );
  const sourceRef = useRef<EventSource | null>(null);

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

    const onStart = () => setStatus("streaming");
    const onDelta = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (typeof data?.content === "string") {
          setContent(data.content);
          setStatus("streaming");
        }
      } catch {
        // ignore
      }
    };
    const onComplete = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (typeof data?.content === "string") {
          setContent(data.content);
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
    es.addEventListener("complete", onComplete as EventListener);
    es.addEventListener("error", onError as EventListener);
    es.onerror = onError as any;

    return () => {
      try {
        es.close();
      } catch {}
      sourceRef.current = null;
    };
  }, [streamId]);

  const statusLabel = useMemo(() => {
    if (status === "connecting") return "Connecting…";
    if (status === "streaming") return "Streaming response…";
    if (status === "complete") return "Response complete";
    return "Stream error";
  }, [status]);

  return (
    <div
      className={cn(
        "w-full rounded-2xl bg-muted/40 px-4 py-4 text-sm shadow-sm transition",
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
      <div className="whitespace-pre-wrap text-foreground">{content}</div>
    </div>
  );
}
