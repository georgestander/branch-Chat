"use client";

import { forwardRef, useEffect, useRef } from "react";
import type { ForwardedRef, HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

interface MarkdownContentProps extends HTMLAttributes<HTMLDivElement> {
  html: string;
}

export const MarkdownContent = forwardRef<HTMLDivElement, MarkdownContentProps>(
  ({ html, className, ...props }, ref) => {
    const localRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
      assignRef(ref, localRef.current);
      return () => assignRef(ref, null);
    }, [ref]);

    useEffect(() => {
      const root = localRef.current;
      if (!root) {
        return;
      }

      const handleCopy = async (event: MouseEvent) => {
        const target = event.target;
        if (!(target instanceof HTMLButtonElement)) {
          return;
        }
        if (!target.dataset.copyCode) {
          return;
        }

        const block = target.closest<HTMLElement>("[data-code-block]");
        const code = block?.querySelector("code");
        const text = code?.textContent ?? "";
        if (!text.trim()) {
          return;
        }

        try {
          await navigator.clipboard.writeText(text);
          target.dataset.copyState = "copied";
          target.textContent = "Copied";
        } catch (error) {
          console.error("code copy failed", error);
          target.dataset.copyState = "error";
          target.textContent = "Retry";
          return;
        }

        setTimeout(() => {
          target.dataset.copyState = "ready";
          target.textContent = "Copy";
        }, 2000);
      };

      root.addEventListener("click", handleCopy);
      return () => {
        root.removeEventListener("click", handleCopy);
      };
    }, [html]);

    return (
      <div
        ref={localRef}
        className={cn("markdown-body", className)}
        dangerouslySetInnerHTML={{ __html: html }}
        {...props}
      />
    );
  },
);

MarkdownContent.displayName = "MarkdownContent";

function assignRef(
  ref: ForwardedRef<HTMLDivElement>,
  value: HTMLDivElement | null,
) {
  if (!ref) {
    return;
  }
  if (typeof ref === "function") {
    ref(value);
  } else {
    // eslint-disable-next-line no-param-reassign
    ref.current = value;
  }
}
