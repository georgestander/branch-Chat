import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { BranchId } from "@branchy/conversation-core";

import { Icon } from "./icons.tsx";
import type { ParentBranchComparison } from "./state.ts";

type BranchCompareDialogProps = {
  comparison: ParentBranchComparison;
  onClose: () => void;
  onOpenBranch: (branchId: BranchId) => void;
};

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function comparisonMessageLabel(
  role: "assistant" | "system" | "user",
): string {
  if (role === "assistant") return "Branchy";
  if (role === "system") return "System";
  return "You";
}

function ComparisonMessages({
  messages,
  emptyLabel,
}: {
  messages: ParentBranchComparison["parent"]["messages"];
  emptyLabel: string;
}): React.JSX.Element {
  if (messages.length === 0) {
    return <p className="branch-compare__empty">{emptyLabel}</p>;
  }

  return (
    <div className="branch-compare__messages" role="list">
      {messages.map((message) => (
        <article
          className={`branch-compare__message branch-compare__message--${message.role}`}
          key={message.id}
          role="listitem"
        >
          <span>{comparisonMessageLabel(message.role)}</span>
          <p>{message.content || "No text content."}</p>
          {message.toolInvocations?.length ? (
            <small>
              {message.toolInvocations.length} tool{" "}
              {message.toolInvocations.length === 1 ? "event" : "events"}
            </small>
          ) : null}
        </article>
      ))}
    </div>
  );
}

export function BranchCompareDialog({
  comparison,
  onClose,
  onOpenBranch,
}: BranchCompareDialogProps): React.JSX.Element {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  const trapFocus = (
    event: ReactKeyboardEvent<HTMLElement>,
  ): void => {
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter((element) => !element.hidden);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const { parent, child, sourceMessage } = comparison;
  const sourceExcerpt =
    child.branch.createdFrom.excerpt?.trim() ||
    sourceMessage?.content.trim() ||
    "The child branch was created from this parent message.";
  const sourceSpan = child.branch.createdFrom.span;

  return (
    <div
      className="overlay overlay--center"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="dialog branch-compare"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={trapFocus}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dialog__header">
          <div>
            <h2 id={titleId}>Compare branch with parent</h2>
            <p id={descriptionId}>
              Review the fork point and both paths without leaving the active
              branch.
            </p>
          </div>
          <button
            className="icon-button icon-button--quiet"
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close branch comparison"
          >
            <Icon name="close" />
          </button>
        </header>

        <div className="branch-compare__source">
          <Icon name="branch" size={17} />
          <div>
            <strong>Fork point in {parent.branch.title}</strong>
            <blockquote>{sourceExcerpt}</blockquote>
            <small>
              Source message {child.branch.createdFrom.messageId}
              {sourceSpan
                ? ` · characters ${sourceSpan.start}–${sourceSpan.end}`
                : ""}
            </small>
          </div>
        </div>

        <div className="branch-compare__columns">
          <section
            className="branch-compare__column"
            aria-labelledby={`${titleId}-parent`}
          >
            <header>
              <div>
                <span>Parent path</span>
                <h3 id={`${titleId}-parent`}>{parent.branch.title}</h3>
              </div>
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  onClose();
                  onOpenBranch(parent.branch.id);
                }}
              >
                Open parent
              </button>
            </header>
            <ComparisonMessages
              messages={parent.messages}
              emptyLabel="No parent messages are available."
            />
          </section>

          <section
            className="branch-compare__column"
            aria-labelledby={`${titleId}-child`}
          >
            <header>
              <div>
                <span>Child path</span>
                <h3 id={`${titleId}-child`}>{child.branch.title}</h3>
              </div>
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  onClose();
                  onOpenBranch(child.branch.id);
                }}
              >
                Open child
              </button>
            </header>
            <ComparisonMessages
              messages={child.messages}
              emptyLabel="No child messages are available yet."
            />
          </section>
        </div>
      </section>
    </div>
  );
}
