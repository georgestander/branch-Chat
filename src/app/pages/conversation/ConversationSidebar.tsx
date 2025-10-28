import type { BranchTreeNode } from "@/app/shared/conversation.server";
import type { Conversation } from "@/lib/conversation";
import { cn } from "@/lib/utils";

interface ConversationSidebarProps {
  conversation: Conversation;
  tree: BranchTreeNode;
  activeBranchId: string;
}

export function ConversationSidebar({
  conversation,
  tree,
  activeBranchId,
}: ConversationSidebarProps) {
  return (
    <aside className="flex h-full w-72 flex-col border-r border-border bg-muted/30">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Conversations
        </h2>
        <div className="mt-2 rounded-md bg-card px-3 py-2 text-sm text-foreground shadow-sm">
          {conversation.settings.systemPrompt ? (
            <div className="flex flex-col gap-1">
              <span className="font-medium">{conversation.id}</span>
              <span className="text-xs text-muted-foreground">
                {conversation.settings.model}
              </span>
            </div>
          ) : (
            <span className="font-medium">{conversation.id}</span>
          )}
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <BranchTree tree={tree} activeBranchId={activeBranchId} level={0} />
      </nav>
    </aside>
  );
}

function BranchTree({
  tree,
  activeBranchId,
  level,
}: {
  tree: BranchTreeNode;
  activeBranchId: string;
  level: number;
}) {
  const isActive = tree.branch.id === activeBranchId;
  const containsActiveDescendant = tree.children.some((child) =>
    branchContainsActive(child, activeBranchId),
  );

  return (
    <div className="flex flex-col">
      <a
        href={buildBranchHref(tree.branch.id)}
        className={cn(
          "group relative flex items-center justify-between rounded-md border border-transparent px-3 py-2 text-sm transition hover:bg-muted/80",
          isActive
            ? "border-primary bg-primary/10 font-semibold text-primary shadow-sm"
            : "text-foreground",
        )}
        data-active={isActive}
        aria-current={isActive ? "page" : undefined}
        style={{ paddingLeft: `${level * 0.75 + 0.75}rem` }}
      >
        <span className="flex items-center gap-2">
          <span
            className={cn(
              "h-2 w-2 rounded-full border border-border/60 transition",
              isActive
                ? "border-primary bg-primary"
                : "bg-muted group-hover:border-foreground/40",
            )}
            aria-hidden
          />
          <span>{tree.branch.title || "Untitled Branch"}</span>
        </span>
        {tree.children.length > 0 ? (
          <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            {tree.children.length}
          </span>
        ) : null}
      </a>

      {tree.children.length > 0 ? (
        <div
          className={cn(
            "ml-2 border-l pl-2",
            containsActiveDescendant
              ? "border-primary/40"
              : "border-border/60",
          )}
        >
          {tree.children.map((child) => (
            <BranchTree
              key={child.branch.id}
              tree={child}
              activeBranchId={activeBranchId}
              level={level + 1}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function buildBranchHref(branchId: string): string {
  if (!branchId) {
    return "/";
  }
  return `/?branchId=${encodeURIComponent(branchId)}`;
}

function branchContainsActive(
  node: BranchTreeNode,
  activeBranchId: string,
): boolean {
  if (node.branch.id === activeBranchId) {
    return true;
  }

  return node.children.some((child) =>
    branchContainsActive(child, activeBranchId),
  );
}
