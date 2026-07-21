"use client";

import { useCallback, useRef, useState, useTransition } from "react";

import {
  sendMessage,
} from "@/app/pages/conversation/functions";
import { navigate } from "rwsdk/client";
import { MarkdownContent } from "@/app/components/markdown/MarkdownContent";
import type { ToolInvocation } from "@/lib/conversation";
import type { RenderedBranchAnchor } from "@/lib/conversation/rendered";
import { ToolInvocationSummary } from "@/app/components/conversation/ToolInvocationSummary";
import { GitBranch } from "lucide-react";

interface BranchableMessageProps {
  conversationId: string;
  branchId: string;
  messageId: string;
  content: string;
  renderedHtml: string;
  toolInvocations?: ToolInvocation[] | null;
  branchAnchors?: RenderedBranchAnchor[];
}

type SelectionState = {
  span?: { start: number; end: number };
  text: string;
  rect: DOMRect;
  characterCount: number;
  blockCount: number;
};

export function BranchableMessage({
  conversationId,
  branchId,
  messageId,
  content,
  renderedHtml,
  toolInvocations,
  branchAnchors = [],
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

    const fragment = range.cloneContents();
    const text = fragment.textContent ?? "";
    if (!text) {
      setSelection(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    setSelection({
      span: { start, end },
      text,
      rect,
      characterCount: text.length,
      blockCount: countSelectionBlocks(fragment),
    });
  }, []);

  const runCreateBranch = useCallback(
    (draft: SelectionState, prompt: string) => {
      setError(null);
      startTransition(async () => {
        try {
          const response = await sendMessage({
            conversationId,
            content: prompt,
            branchDraft: {
              parentBranchId: branchId,
              messageId,
              span: draft.span,
              excerpt: draft.text,
            },
          });
          const createdBranchId = response.createdBranch?.id;
          clearSelection();
          if (!createdBranchId) {
            throw new Error("Branch was not created");
          }
          const params = new URLSearchParams({
            conversationId,
            branchId: createdBranchId,
            compare: "1",
            focus: "1",
          });
          navigate(`/app?${params.toString()}`);
        } catch (cause) {
          console.error("createBranchFromSelection failed", cause);
          setError("Could not create and send this branch. Please try again.");
        }
      });
    },
    [branchId, clearSelection, conversationId, messageId],
  );

  const openChildBranch = useCallback(
    (branchId: string) => {
      const params = new URLSearchParams({
        conversationId,
        branchId,
        compare: "1",
        focus: "1",
      });
      navigate(`/app?${params.toString()}`);
    },
    [conversationId],
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

      {branchAnchors.length > 0 ? (
        <nav
          className="mt-3 flex flex-wrap gap-2"
          aria-label="Branches created from this message"
        >
          {branchAnchors.map((anchor) => (
            <button
              key={anchor.branchId}
              type="button"
              onClick={() => openChildBranch(anchor.branchId)}
              className="interactive-target inline-flex max-w-full items-center gap-1.5 rounded border border-accent/50 bg-accent/10 px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              title={
                anchor.excerpt
                  ? `Open ${anchor.title}: “${anchor.excerpt}”`
                  : `Open ${anchor.title}`
              }
            >
              <GitBranch className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{anchor.title}</span>
              {anchor.range ? null : (
                <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Message
                </span>
              )}
            </button>
          ))}
        </nav>
      ) : null}

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
          onClick={(event) => {
            const excerpt =
              content.length > 280 ? `${content.slice(0, 277)}…` : content;
            setSelection({
              text: excerpt,
              rect: event.currentTarget.getBoundingClientRect(),
              characterCount: excerpt.length,
              blockCount: 1,
            });
          }}
          disabled={isPending}
          className="interactive-target inline-flex items-center gap-1 rounded border border-border bg-background px-3 py-1 text-xs font-medium text-foreground hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55"
        >
          {isPending ? "Creating…" : "Branch Message"}
        </button>
      </div>

      {selection ? (
        <SelectionPopover
          selection={selection}
          isPending={isPending}
          onCreate={(prompt) => runCreateBranch(selection, prompt)}
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
  onCreate: (prompt: string) => void;
  onCancel: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const selectionLabel = `${selection.text.slice(0, 80)}${
    selection.text.length > 80 ? "…" : ""
  }`;
  const hasMultiBlockSelection = selection.blockCount > 1;
  const popoverWidth = Math.min(384, window.innerWidth - 16);
  const popoverHeight = 340;
  const style: React.CSSProperties = {
    position: "fixed",
    top: Math.min(
      Math.max(8, selection.rect.bottom + 6),
      Math.max(8, window.innerHeight - popoverHeight - 8),
    ),
    left: Math.min(
      Math.max(8, selection.rect.left),
      Math.max(8, window.innerWidth - popoverWidth - 8),
    ),
    zIndex: 50,
  };

  return (
    <div
      style={style}
      className="w-[min(24rem,calc(100vw-1rem))] rounded border border-border bg-popover px-3 py-3 shadow-sm"
    >
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmedPrompt = prompt.trim();
          if (trimmedPrompt) {
            onCreate(trimmedPrompt);
          }
        }}
      >
        <span className="max-w-xs text-xs text-muted-foreground">
          Branch from “{selectionLabel}”
        </span>
        <div className="rounded border border-border bg-background/70 px-2.5 py-2 text-[11px] text-muted-foreground">
          <div className="flex items-center justify-between gap-3">
            <span>{selection.characterCount} chars</span>
            <span>{selection.blockCount} block{selection.blockCount === 1 ? "" : "s"}</span>
          </div>
          {hasMultiBlockSelection ? (
            <div className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-amber-900 dark:text-amber-200">
              Multi-block selection. Double-check that you intended to branch from everything shown below.
            </div>
          ) : null}
          <div className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap rounded border border-border/70 bg-background px-2 py-1.5 text-foreground">
            {selection.text}
          </div>
        </div>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Ask a question on this new branch…"
          rows={3}
          autoFocus
          className="w-full resize-none rounded border border-border bg-background px-2.5 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground/40 focus:ring-2 focus:ring-ring"
        />
        <span className="text-[11px] text-muted-foreground">
          The branch is only created when you send this prompt.
        </span>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={isPending || prompt.trim().length === 0}
            className="interactive-target inline-flex items-center rounded bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {isPending ? "Creating…" : "Create & send"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="interactive-target inline-flex items-center rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function computeOffsets(root: HTMLElement, range: Range) {
  return {
    start: computeTextOffset(root, range.startContainer, range.startOffset),
    end: computeTextOffset(root, range.endContainer, range.endOffset),
  };
}

function computeTextOffset(root: HTMLElement, container: Node, offset: number) {
  const prefix = document.createRange();
  prefix.selectNodeContents(root);
  prefix.setEnd(container, offset);
  return prefix.cloneContents().textContent?.length ?? 0;
}

function countSelectionBlocks(fragment: DocumentFragment): number {
  const blockSelector =
    "p,li,pre,blockquote,h1,h2,h3,h4,h5,h6,table,tr";
  const count = fragment.querySelectorAll(blockSelector).length;
  return Math.max(1, count);
}
