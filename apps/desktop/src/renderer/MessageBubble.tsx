import {
  memo,
  useCallback,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { branchToneByKey } from "@branchy/conversation-core";
import type { RenderedMessage } from "@branchy/conversation-core/presentation";

import { Icon } from "./icons.tsx";
import { sourceSelectionOffsets } from "./state.ts";
import {
  generatedImageDisplayState,
  generatedImagesForMessage,
  toolLabel,
  type BranchSelectionDraft,
} from "./types.ts";

type SelectionAction = {
  excerpt: string;
  span: { start: number; end: number };
  top: number;
  left: number;
};

type MessageBubbleProps = {
  message: RenderedMessage;
  branchId: string;
  toneColor: string | null;
  onCreateBranch: (draft: BranchSelectionDraft) => void;
  onOpenBranch: (branchId: string) => void;
  onDownloadImage: (messageId: string, imageId: string) => void;
  onRetryImage: (
    messageId: string,
    imageId: string,
    prompt: string,
  ) => void;
  onOpenExternal: (url: string) => void;
  resolveImageUrl: (
    messageId: string,
    imageId: string,
    fallback: string | null,
  ) => string | null;
};

const URL_PATTERN = /(https?:\/\/[^\s<>()]+)/g;

function TextWithLinks({
  text,
  onOpenExternal,
}: {
  text: string;
  onOpenExternal: (url: string) => void;
}): React.JSX.Element {
  const parts = text.split(URL_PATTERN);
  return (
    <>
      {parts.map((part, index) =>
        /^https?:\/\//.test(part) ? (
          <a
            className="message-link"
            href={part}
            key={`${part}-${index}`}
            onClick={(event) => {
              event.preventDefault();
              onOpenExternal(part);
            }}
            rel="noreferrer"
            target="_blank"
          >
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </>
  );
}

export const MessageBubble = memo(function MessageBubble({
  message,
  branchId,
  toneColor,
  onCreateBranch,
  onOpenBranch,
  onDownloadImage,
  onRetryImage,
  onOpenExternal,
  resolveImageUrl,
}: MessageBubbleProps): React.JSX.Element {
  const contentRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<SelectionAction | null>(null);
  const images = generatedImagesForMessage(message);
  const tools = (message.toolInvocations ?? []).filter(
    (invocation) => invocation.toolType !== "image_generation",
  );

  const captureSelection = useCallback(() => {
    if (message.role !== "assistant" || !contentRef.current) return;
    const browserSelection = window.getSelection();
    if (
      !browserSelection ||
      browserSelection.isCollapsed ||
      browserSelection.rangeCount === 0
    ) {
      setSelection(null);
      return;
    }
    const range = browserSelection.getRangeAt(0);
    const root = contentRef.current;
    if (
      !root.contains(range.startContainer) ||
      !root.contains(range.endContainer)
    ) {
      setSelection(null);
      return;
    }
    const excerpt = range.toString().trim();
    if (!excerpt) {
      setSelection(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    setSelection({
      excerpt,
      span: sourceSelectionOffsets(root, range),
      top: rect.bottom - rootRect.top + 8,
      left: Math.max(8, Math.min(rect.left - rootRect.left, rootRect.width - 150)),
    });
  }, [message.role]);

  const createBranch = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      if (!selection) return;
      onCreateBranch({
        parentBranchId: branchId,
        messageId: message.id,
        excerpt: selection.excerpt,
        span: selection.span,
      });
      setSelection(null);
      window.getSelection()?.removeAllRanges();
    },
    [branchId, message.id, onCreateBranch, selection],
  );

  return (
    <article
      className={`message message--${message.role}`}
      aria-label={`${message.role} message`}
    >
      <div className="message__role">
        {message.role === "assistant" ? "Branchy" : "You"}
      </div>
      <div
        className="message__body"
        ref={contentRef}
        onMouseUp={captureSelection}
      >
        {message.content ? (
          <div className="message__text">
            <TextWithLinks
              text={message.content}
              onOpenExternal={onOpenExternal}
            />
          </div>
        ) : null}

        {selection ? (
          <button
            className="selection-action"
            style={{ left: selection.left, top: selection.top }}
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={createBranch}
          >
            <Icon name="branch" size={14} />
            Branch from selection
          </button>
        ) : null}

        {tools.length > 0 ? (
          <div className="tool-list" aria-label="Tool activity">
            {tools.map((invocation) => (
              <div className="tool-row" key={invocation.id}>
                <span
                  className={`tool-dot tool-dot--${invocation.status}`}
                  aria-hidden="true"
                />
                <span>{toolLabel(invocation)}</span>
                <span className="tool-row__status">{invocation.status}</span>
              </div>
            ))}
          </div>
        ) : null}

        {images.map((image) => {
          const source = resolveImageUrl(message.id, image.id, image.url);
          const displayState = generatedImageDisplayState(
            image.status,
            source,
          );
          return (
            <section className="generated-image" key={image.id}>
              {displayState === "running" ? (
                <div className="image-progress" role="status">
                  <div className="image-progress__wash" />
                  <div className="image-progress__content">
                    <span className="image-progress__icon">
                      <Icon name="image" size={23} />
                      <span className="spinner spinner--large" />
                    </span>
                    <strong>Creating your image…</strong>
                    <span>You can keep exploring this canvas.</span>
                  </div>
                </div>
              ) : displayState === "resolving" ? (
                <div className="image-progress" role="status">
                  <div className="image-progress__wash" />
                  <div className="image-progress__content">
                    <span className="image-progress__icon">
                      <Icon name="image" size={23} />
                      <span className="spinner spinner--large" />
                    </span>
                    <strong>Loading your image…</strong>
                    <span>Restoring the saved result.</span>
                  </div>
                </div>
              ) : displayState === "ready" && source ? (
                <img src={source} alt={image.prompt ?? "Generated image"} />
              ) : (
                <div className="image-error" role="alert">
                  <Icon name="info" />
                  <div>
                    <strong>Image generation stopped</strong>
                    <p>{image.error ?? "Branchy could not finish this image."}</p>
                  </div>
                </div>
              )}

              {displayState !== "running" ? (
                <div className="generated-image__actions">
                  {image.status === "succeeded" ? (
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => onDownloadImage(message.id, image.id)}
                    >
                      <Icon name="download" size={15} />
                      Download
                    </button>
                  ) : null}
                  {image.prompt ? (
                    <button
                      className="text-button"
                      type="button"
                      onClick={() =>
                        onRetryImage(message.id, image.id, image.prompt!)
                      }
                    >
                      <Icon name="redo" size={15} />
                      Edit prompt &amp; retry
                    </button>
                  ) : null}
                </div>
              ) : null}
            </section>
          );
        })}

        {message.branchAnchors.length > 0 ? (
          <nav
            className="branch-anchors"
            aria-label="Branches from this reply"
          >
            {message.branchAnchors.map((anchor) => {
              const anchorTone = anchor.tone
                ? branchToneByKey(anchor.tone).color
                : toneColor ?? "#6b7280";
              return (
                <button
                  key={anchor.branchId}
                  className="branch-anchor"
                  style={
                    { "--anchor-tone": anchorTone } as React.CSSProperties
                  }
                  type="button"
                  onClick={() => onOpenBranch(anchor.branchId)}
                >
                  <Icon name="branch" size={14} />
                  <span>Child: {anchor.title}</span>
                </button>
              );
            })}
          </nav>
        ) : null}
      </div>
    </article>
  );
});
