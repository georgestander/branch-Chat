"use client";

import { X } from "lucide-react";

import type { Branch } from "@/lib/conversation";
import type { RenderedMessage } from "@/lib/conversation/rendered";
import { cn } from "@/lib/utils";
import { MarkdownContent } from "@/app/components/markdown/MarkdownContent";

interface ParentContextSheetProps {
  open: boolean;
  parentBranch: Branch;
  parentMessages: RenderedMessage[];
  originMessageId: string | null;
  onClose: () => void;
  onOpenCompare: () => void;
}

export function ParentContextSheet({
  open,
  parentBranch,
  parentMessages,
  originMessageId,
  onClose,
  onOpenCompare,
}: ParentContextSheetProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40 flex" role="dialog" aria-modal="true" aria-label="Parent context panel">
      <button
        type="button"
        className="flex-1 bg-background/70 backdrop-blur-[1px]"
        onClick={onClose}
        aria-label="Close parent context panel"
      />
      <aside className="h-full w-full max-w-xl border-l border-border bg-background shadow-2xl">
        <div className="flex h-full flex-col">
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Parent Context
              </p>
              <h2 className="text-sm font-semibold text-foreground">{parentBranch.title || "Parent branch"}</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground transition hover:bg-muted hover:text-foreground"
              aria-label="Close parent context panel"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </header>

          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <button
              type="button"
              onClick={onOpenCompare}
              className="inline-flex h-8 items-center rounded-full bg-primary px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary-foreground transition hover:bg-primary/90"
            >
              Open Compare Mode
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 items-center rounded-full border border-border px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground transition hover:bg-muted"
            >
              Continue Editing
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4">
            <ol className="space-y-3">
              {parentMessages.map((message) => {
                const isOrigin = originMessageId ? message.id === originMessageId : false;
                return (
                  <li
                    key={message.id}
                    className={cn(
                      "rounded-xl border px-3 py-3",
                      message.role === "user"
                        ? "border-primary/30 bg-primary/10"
                        : "border-border bg-card",
                      isOrigin ? "ring-2 ring-primary" : "",
                    )}
                    data-parent-message-id={message.id}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        {message.role}
                      </span>
                      {isOrigin ? (
                        <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
                          Branch Origin
                        </span>
                      ) : null}
                    </div>
                    <MarkdownContent
                      className="prose prose-sm max-w-none text-foreground"
                      html={message.renderedHtml}
                    />
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </aside>
    </div>
  );
}
