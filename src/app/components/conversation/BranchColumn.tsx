import { BranchColumnInteractive } from "@/app/components/conversation/BranchColumnInteractive";
import type {
  Branch,
  BranchSpan,
  ConversationModelId,
  Message,
} from "@/lib/conversation";

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

      <BranchColumnInteractive
        branch={branch}
        messages={messages}
        conversationId={conversationId}
        isActive={isActive}
        highlight={highlight}
      />
    </section>
  );
}
