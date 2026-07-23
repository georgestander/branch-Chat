import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { branchToneByKey } from "@branchy/conversation-core";
import type { RenderedMessage } from "@branchy/conversation-core/presentation";

import { Icon } from "./icons.tsx";
import { trimSelectionRange } from "./markdown.ts";
import { MarkdownContent } from "./MarkdownContent.tsx";
import { sourceSelectionOffsets } from "./state.ts";
import {
  generatedImageDisplayState,
  generatedImagesForMessage,
  toolLabel,
  type BranchSelectionDraft,
} from "./types.ts";

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

const COLLAPSED_USER_MESSAGE_HEIGHT_PX = 208;

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
  const [userMessageExpanded, setUserMessageExpanded] = useState(false);
  const [userMessageCollapsible, setUserMessageCollapsible] =
    useState(false);
  const images = generatedImagesForMessage(message);
  const tools = (message.toolInvocations ?? []).filter(
    (invocation) => invocation.toolType !== "image_generation",
  );
  useEffect(() => {
    setUserMessageExpanded(false);
    const element = contentRef.current;
    if (message.role !== "user" || !element) {
      setUserMessageCollapsible(false);
      return;
    }
    const update = (): void => {
      setUserMessageCollapsible(
        element.scrollHeight > COLLAPSED_USER_MESSAGE_HEIGHT_PX + 4,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [message.content, message.id, message.role]);

  const captureSelection = useCallback(() => {
    if (message.role !== "assistant" || !contentRef.current) return;
    const browserSelection = window.getSelection();
    if (
      !browserSelection ||
      browserSelection.isCollapsed ||
      browserSelection.rangeCount === 0
    ) {
      return;
    }
    const range = browserSelection.getRangeAt(0);
    const root = contentRef.current;
    if (
      !root.contains(range.startContainer) ||
      !root.contains(range.endContainer)
    ) {
      return;
    }
    const trimmedSelection = trimSelectionRange(
      range.toString(),
      sourceSelectionOffsets(root, range),
    );
    if (!trimmedSelection) return;
    onCreateBranch({
      parentBranchId: branchId,
      messageId: message.id,
      excerpt: trimmedSelection.excerpt,
      span: trimmedSelection.span,
    });
    browserSelection.removeAllRanges();
  }, [branchId, message.id, message.role, onCreateBranch]);

  return (
    <article
      className={`message message--${message.role}`}
      aria-label={`${message.role} message`}
    >
      <div
        className="message__body"
        onMouseUp={captureSelection}
      >
        {userMessageCollapsible ? (
          <button
            className="message__expand"
            type="button"
            onClick={() =>
              setUserMessageExpanded((current) => !current)
            }
          >
            {userMessageExpanded ? "Hide" : "Show"}
          </button>
        ) : null}
        <div
          className={`message__content ${
            message.role === "user" &&
            userMessageCollapsible &&
            !userMessageExpanded
              ? "is-collapsed"
              : ""
          }`}
        >
          {message.content ? (
            <MarkdownContent
              branchAnchors={message.branchAnchors}
              markdown={message.content}
              messageId={message.id}
              onOpenExternal={onOpenExternal}
              ref={contentRef}
            />
          ) : null}
          {message.role === "user" &&
          userMessageCollapsible &&
          !userMessageExpanded ? (
            <span className="message__content-fade" aria-hidden="true" />
          ) : null}
        </div>

        {(message.attachments?.length ?? 0) > 0 ? (
          <div className="message-attachments" aria-label="Sent attachments">
            {message.attachments!.map((attachment) => (
              <div className="message-attachment" key={attachment.id}>
                <Icon name="file" size={15} />
                <span>
                  <strong>{attachment.name}</strong>
                  <small>{formatAttachmentSize(attachment.size)}</small>
                </span>
              </div>
            ))}
          </div>
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

function formatAttachmentSize(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${Math.round(bytes / 1_024)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}
