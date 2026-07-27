import {
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  type ForwardedRef,
  type HTMLAttributes,
} from "react";
import type { RenderedBranchAnchor } from "@branchy/conversation-core/presentation";
import "katex/dist/katex.min.css";

import {
  copyCodeToClipboard,
  renderDesktopMarkdown,
  safeExternalUrl,
} from "./markdown.ts";

type MarkdownContentProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  markdown: string;
  messageId: string;
  branchAnchors?: readonly RenderedBranchAnchor[];
  selectedBranchId?: string | null;
  onOpenBranch: (branchId: string) => void;
  onOpenExternal: (url: string) => void;
};

export const MarkdownContent = forwardRef<HTMLDivElement, MarkdownContentProps>(
  function MarkdownContent(
    {
      markdown,
      messageId,
      branchAnchors = [],
      selectedBranchId = null,
      onOpenBranch,
      onOpenExternal,
      className,
      ...props
    },
    forwardedRef,
  ): React.JSX.Element {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const resetTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
    const html = useMemo(
      () =>
        renderDesktopMarkdown(markdown, {
          messageId,
          branchAnchors,
          selectedBranchId,
        }),
      [branchAnchors, markdown, messageId, selectedBranchId],
    );

    useEffect(() => {
      assignRef(forwardedRef, rootRef.current);
      return () => assignRef(forwardedRef, null);
    }, [forwardedRef]);

    useEffect(
      () => () => {
        for (const timer of resetTimers.current) clearTimeout(timer);
        resetTimers.current.clear();
      },
      [],
    );

    useEffect(() => {
      const root = rootRef.current;
      if (!root) return;

      const handleClick = async (event: MouseEvent): Promise<void> => {
        const target = event.target;
        if (!(target instanceof Element)) return;

        const branchMarker = target.closest<HTMLButtonElement>(
          "button[data-branch-marker]",
        );
        if (branchMarker && root.contains(branchMarker)) {
          event.preventDefault();
          const branchId = branchMarker.dataset.branchId;
          if (branchId) onOpenBranch(branchId);
          return;
        }

        const copyButton = target.closest<HTMLButtonElement>(
          "button[data-copy-code]",
        );
        if (copyButton && root.contains(copyButton)) {
          event.preventDefault();
          const code =
            copyButton
              .closest<HTMLElement>("[data-code-block]")
              ?.querySelector("code")
              ?.textContent ?? "";
          const clipboard =
            typeof navigator === "undefined" ? null : navigator.clipboard;
          const copied = clipboard
            ? await copyCodeToClipboard(code, clipboard)
            : false;
          copyButton.dataset.copyState = copied ? "copied" : "error";
          copyButton.textContent = copied ? "Copied" : "Retry";
          if (copied) {
            const timer = setTimeout(() => {
              resetTimers.current.delete(timer);
              if (!copyButton.isConnected) return;
              copyButton.dataset.copyState = "ready";
              copyButton.textContent = "Copy";
            }, 2_000);
            resetTimers.current.add(timer);
          }
          return;
        }

        const anchor = target.closest<HTMLAnchorElement>(
          "a[data-external-link]",
        );
        if (!anchor || !root.contains(anchor)) return;
        event.preventDefault();
        const safeUrl = safeExternalUrl(anchor.getAttribute("href"));
        if (safeUrl) onOpenExternal(safeUrl);
      };

      root.addEventListener("click", handleClick);
      return () => root.removeEventListener("click", handleClick);
    }, [html, onOpenBranch, onOpenExternal]);

    const classes = ["message__text", "markdown-body", className]
      .filter(Boolean)
      .join(" ");
    return (
      <div
        {...props}
        className={classes}
        dangerouslySetInnerHTML={{ __html: html }}
        ref={rootRef}
      />
    );
  },
);

function assignRef(
  ref: ForwardedRef<HTMLDivElement>,
  value: HTMLDivElement | null,
): void {
  if (!ref) return;
  if (typeof ref === "function") {
    ref(value);
  } else {
    ref.current = value;
  }
}
