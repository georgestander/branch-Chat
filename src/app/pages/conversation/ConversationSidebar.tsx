"use client";

import { PanelLeftClose } from "lucide-react";

import type { BranchTreeNode } from "@/app/shared/conversation.server";
import type { Conversation } from "@/lib/conversation";

interface ConversationSidebarProps {
  conversation: Conversation;
  tree: BranchTreeNode;
  activeBranchId: string;
  onCollapse?: () => void;
}

export function ConversationSidebar({
  conversation,
  tree,
  activeBranchId,
  onCollapse,
}: ConversationSidebarProps) {
  return (
    <aside className="flex h-full w-72 flex-col border-r border-border bg-muted/30">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Conversations
          </h2>
          {onCollapse ? (
            <button
              type="button"
              onClick={onCollapse}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border/40 bg-background/80 text-muted-foreground transition hover:bg-muted hover:text-foreground"
              aria-label="Collapse conversation sidebar"
            >
              <PanelLeftClose className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
        </div>
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

  return (
    <div className="flex flex-col">
      <a
        href={buildBranchHref(tree.branch.id)}
        className={`flex items-center justify-between rounded-md px-3 py-2 text-sm transition hover:bg-muted/80 ${isActive ? "bg-primary/10 font-semibold text-primary" : "text-foreground"}`}
        data-active={isActive}
        style={{ paddingLeft: `${level * 0.75 + 0.75}rem` }}
      >
        <span>{tree.branch.title || "Untitled Branch"}</span>
        {tree.children.length > 0 ? (
          <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            {tree.children.length}
          </span>
        ) : null}
      </a>

      {tree.children.length > 0 ? (
        <div className="ml-2 border-l border-border/60 pl-2">
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
