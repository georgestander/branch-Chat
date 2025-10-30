"use client";

import { useCallback, useRef, useState, useTransition } from "react";

import {
  createBranchFromSelection,
  type CreateBranchInput,
} from "@/app/pages/conversation/functions";
import { navigate } from "rwsdk/client";
import { MarkdownContent } from "@/app/components/markdown/MarkdownContent";
import type { ToolInvocation } from "@/lib/conversation";
import { ToolInvocationSummary } from "@/app/components/conversation/ToolInvocationSummary";

interface BranchableMessageProps {
  conversationId: string;
  branchId: string;
  messageId: string;
  content: string;
  renderedHtml: string;
  toolInvocations?: ToolInvocation[] | null;
}

type SelectionState = {
  start: number;
  end: number;
  text: string;
  rect: DOMRect;
};

export function BranchableMessage({
  conversationId,
  branchId,
  messageId,
  content,
  renderedHtml,
  toolInvocations,
}: BranchableMessageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const clearSelection = useCallback(() => {
    setSelection(null);
    const sel = window.getSelection();
    if (sel?.rangeCount) {
      sel.removeAllRanges();
    }
  }, []);

  const handleSelection = useCallback(() => {
    const root = containerRef.current;
    if (!root) {
      return;
    }

    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setSelection(null);
      return;
    }

    const range = sel.getRangeAt(0);
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
      setSelection(null);
      return;
    }

    const { start, end } = computeOffsets(root, range);
    if (start === end) {
      setSelection(null);
      return;
    }

    const text = sel.toString();
    const rect = range.getBoundingClientRect();
    setSelection({ start, end, text, rect });
  }, []);

  const runCreateBranch = useCallback(
    (span?: { start: number; end: number }, excerpt?: string) => {
      setError(null);
      startTransition(async () => {
        try {
          const payload: CreateBranchInput = {
            conversationId,
            parentBranchId: branchId,
            messageId,
            span: span ? { start: span.start, end: span.end } : undefined,
            excerpt: excerpt ?? null,
          };
          const response = await createBranchFromSelection(payload);
          clearSelection();
          const params = new URLSearchParams({
            conversationId,
            branchId: response.branch.id,
            focus: "child",
          });
          navigate(`/?${params.toString()}`);
        } catch (cause) {
          console.error("createBranchFromSelection failed", cause);
          setError("Could not create branch. Please try again.");
        }
      });
    },
    [branchId, clearSelection, conversationId, messageId],
  );

  return (
    <div className="relative">
      <MarkdownContent
        ref={containerRef}
        onMouseUp={handleSelection}
        className="prose prose-sm mt-3 max-w-none text-foreground"
        html={renderedHtml}
      />

      <ToolInvocationSummary
        toolInvocations={toolInvocations}
        fallbackHtml={renderedHtml}
      />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        {error ? (
          <span className="text-xs text-destructive">{error}</span>
        ) : (
          <span className="text-xs text-muted-foreground">
            Select text to branch or use the quick branch button.
          </span>
        )}

        <button
          type="button"
          onClick={() =>
            runCreateBranch(
              undefined,
              content.length > 280 ? `${content.slice(0, 277)}…` : content,
            )
          }
          disabled={isPending}
          className="interactive-target inline-flex items-center gap-1 rounded-md border border-border/80 bg-background/95 px-3 py-1 text-xs font-medium text-foreground hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-55"
        >
          {isPending ? "Creating…" : "Branch Message"}
        </button>
      </div>

      {selection ? (
        <SelectionPopover
          selection={selection}
          isPending={isPending}
          onCreate={() =>
            runCreateBranch(
              { start: selection.start, end: selection.end },
              selection.text,
            )
          }
          onCancel={clearSelection}
        />
      ) : null}
    </div>
  );
}

function SelectionPopover({
  selection,
  isPending,
  onCreate,
  onCancel,
}: {
  selection: SelectionState;
  isPending: boolean;
  onCreate: () => void;
  onCancel: () => void;
}) {
  const style: React.CSSProperties = {
    position: "fixed",
    top: Math.max(8, selection.rect.bottom + 6),
    left: Math.max(8, selection.rect.left),
    zIndex: 50,
  };

  return (
    <div
      style={style}
      className="rounded-xl border border-border/80 bg-popover/95 px-3 py-2 shadow-xl backdrop-blur-[2px]"
    >
      <div className="flex flex-col gap-2">
        <span className="max-w-xs text-xs text-muted-foreground">
          Branch from “{selection.text.slice(0, 80)}{selection.text.length > 80 ? "…" : ""}”
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCreate}
            disabled={isPending}
            className="interactive-target inline-flex items-center rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground shadow-sm hover:bg-[color-mix(in_oklab,var(--primary)_92%,black)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-55"
          >
            {isPending ? "Creating…" : "Branch Selection"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="interactive-target inline-flex items-center rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function computeOffsets(root: HTMLElement, range: Range) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let index = 0;
  let start = 0;
  let end = 0;
  let node: Node | null = walker.nextNode();

  while (node) {
    const length = node.textContent?.length ?? 0;
    if (node === range.startContainer) {
      start = index + range.startOffset;
    }
    if (node === range.endContainer) {
      end = index + range.endOffset;
      break;
    }
    index += length;
    node = walker.nextNode();
  }

  if (end === 0) {
    end = index;
  }

  if (start > end) {
    const temp = start;
    start = end;
    end = temp;
  }

  return { start, end };
}
