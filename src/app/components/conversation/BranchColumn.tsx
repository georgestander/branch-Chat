import { ConversationComposer } from "@/app/components/conversation/ConversationComposer";
import type {
  Branch,
  BranchSpan,
  ConversationModelId,
  Message,
} from "@/lib/conversation";

import { BranchableMessage } from "./BranchableMessage";

interface BranchColumnProps {
  branch: Branch;
  messages: Message[];
  conversationId: ConversationModelId;
  isActive: boolean;
  highlight?: {
    messageId: string;
    span?: BranchSpan | null;
  };
}

export function BranchColumn({
  branch,
  messages,
  conversationId,
  isActive,
  highlight,
}: BranchColumnProps) {
  const basisClass = isActive ? "basis-[70%]" : "basis-[30%]";
  const stateLabel = isActive ? "Active" : "Parent";
  const referenceText = branch.createdFrom?.excerpt ?? null;

  return (
    <section
      className={`flex ${basisClass} flex-1 flex-col border-l border-border bg-background`}
    >
      <header className="flex items-center justify-between border-b border-border px-5 py-4">
        <div className="flex flex-col">
          <h2 className="text-lg font-semibold text-foreground">
            {branch.title || "Untitled Branch"}
          </h2>
          <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            {stateLabel} Branch
          </span>
        </div>
        <div className={`rounded-full px-3 py-1 text-xs ${isActive ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
          {isActive ? "Editing" : "View Only"}
        </div>
      </header>

      {isActive && referenceText ? (
        <div className="border-b border-border/60 bg-primary/5 px-5 py-3 text-sm text-primary">
          <span className="font-semibold">Reference:</span>{" "}
          <span className="text-foreground/90">“{referenceText}”</span>
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto px-5 py-6">
        <ol className="flex flex-col gap-4">
          {messages.map((message) => (
            <li key={message.id}>
              <MessageBubble
                message={message}
                isActive={isActive}
                highlight={
                  highlight?.messageId === message.id
                    ? highlight?.span ?? null
                    : null
                }
                conversationId={conversationId}
                branch={branch}
              />
            </li>
          ))}
        </ol>
      </div>

      {isActive ? (
        <div className="border-t border-border px-5 py-4">
          <ConversationComposer
            branchId={branch.id}
            conversationId={conversationId}
          />
        </div>
      ) : (
        <div className="border-t border-border px-5 py-4 text-sm text-muted-foreground">
          Switch to this branch to continue the conversation.
        </div>
      )}
    </section>
  );
}

function MessageBubble({
  message,
  highlight,
  isActive,
  conversationId,
  branch,
}: {
  message: Message;
  highlight: BranchSpan | null;
  isActive: boolean;
  conversationId: ConversationModelId;
  branch: Branch;
}) {
  const highlightContent = highlight
    ? renderHighlightedContent(message.content, highlight)
    : message.content;

  const commonHeader = (
    <div className="flex items-center justify-between">
      <span className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
        {message.role}
      </span>
      <span className="text-xs text-muted-foreground">
        {new Date(message.createdAt).toLocaleString()}
      </span>
    </div>
  );

  if (isActive && message.role === "assistant") {
    return (
      <div className="rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
        {commonHeader}
        <BranchableMessage
          branchId={branch.id}
          conversationId={conversationId}
          messageId={message.id}
          content={message.content}
        />
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg border border-border px-4 py-3 shadow-sm ${highlight ? "bg-primary/5" : "bg-card"}`}
    >
      {commonHeader}
      <div className="prose prose-sm mt-3 max-w-none whitespace-pre-wrap text-foreground">
        {highlight ? highlightContent : message.content}
      </div>
    </div>
  );
}

function renderHighlightedContent(content: string, span: BranchSpan) {
  const start = Math.max(0, Math.min(span.start, content.length));
  const end = Math.max(start, Math.min(span.end, content.length));

  const before = content.slice(0, start);
  const highlight = content.slice(start, end);
  const after = content.slice(end);

  return (
    <span className="whitespace-pre-wrap">
      {before}
      <mark className="rounded bg-primary/20 px-0.5 text-primary">{highlight}</mark>
      {after}
    </span>
  );
}
