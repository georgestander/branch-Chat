"use client";

import { useMemo, useState, useTransition } from "react";

import type { BranchTreeNode } from "@/app/shared/conversation.server";
import type {
  Conversation,
  ConversationModelId,
} from "@/lib/conversation";
import type { ConversationDirectoryEntry } from "@/lib/durable-objects/ConversationDirectory";
import { createConversation } from "@/app/pages/conversation/functions";
import { cn } from "@/lib/utils";
import { Plus } from "lucide-react";
import { navigate } from "rwsdk/client";

interface ConversationSidebarProps {
  conversation: Conversation;
  tree: BranchTreeNode;
  activeBranchId: string;
  conversationId: ConversationModelId;
  conversations: ConversationDirectoryEntry[];
  className?: string;
}

export function ConversationSidebar({
  conversation,
  tree,
  activeBranchId,
  conversationId,
  conversations,
  className,
}: ConversationSidebarProps) {
  const [isPending, startTransition] = useTransition();
  const [creationError, setCreationError] = useState<string | null>(null);

  const activeEntry = useMemo(() => {
    return (
      conversations.find((entry) => entry.id === conversationId) ?? {
        id: conversationId,
        title: conversation.id,
        createdAt: conversation.createdAt,
        lastActiveAt: conversation.createdAt,
        branchCount: countBranches(tree),
      }
    );
  }, [conversation, conversationId, conversations, tree]);

  const otherConversations = useMemo(
    () => conversations.filter((entry) => entry.id !== conversationId),
    [conversations, conversationId],
  );

  const startNewConversation = () => {
    if (isPending) {
      return;
    }
    setCreationError(null);
    startTransition(async () => {
      try {
        const result = await createConversation();
        navigate(
          `/?conversationId=${encodeURIComponent(result.conversationId)}`,
        );
      } catch (error) {
        console.error("[Sidebar] createConversation failed", error);
        setCreationError("Unable to start a new chat. Please try again.");
      }
    });
  };

  return (
    <aside
      className={cn(
        "flex h-full w-72 flex-col border-r border-border bg-muted/30",
        className,
      )}
    >
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Conversations
            </h2>
            <p className="text-xs text-muted-foreground">
              {conversations.length} chat{conversations.length === 1 ? "" : "s"}
            </p>
          </div>
          <button
            type="button"
            onClick={startNewConversation}
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {isPending ? "Creating…" : "New chat"}
          </button>
        </div>
        {creationError ? (
          <p className="mt-2 text-xs text-destructive" role="status">
            {creationError}
          </p>
        ) : null}
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <div className="flex flex-col gap-4">
          <ActiveConversationPanel
            conversation={conversation}
            entry={activeEntry}
            tree={tree}
            activeBranchId={activeBranchId}
          />

          {otherConversations.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Previous chats
              </p>
              {otherConversations.map((entry) => (
                <ConversationSummaryCard key={entry.id} entry={entry} />
              ))}
            </div>
          ) : null}
        </div>
      </nav>
    </aside>
  );
}

function ActiveConversationPanel({
  conversation,
  entry,
  tree,
  activeBranchId,
}: {
  conversation: Conversation;
  entry: ConversationDirectoryEntry;
  tree: BranchTreeNode;
  activeBranchId: string;
}) {
  const title = entry.title.trim() ? entry.title : conversation.id;

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="font-semibold leading-tight">{title}</span>
            <span className="text-xs text-muted-foreground">
              {conversation.settings.model}
            </span>
          </div>
          <span className="text-xs font-medium text-muted-foreground">
            {entry.branchCount} branch{entry.branchCount === 1 ? "" : "es"}
          </span>
        </div>
        <p className="mt-1 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
          {conversation.id}
        </p>
      </div>

      <BranchTree
        tree={tree}
        activeBranchId={activeBranchId}
        level={0}
        conversationId={entry.id}
      />
    </div>
  );
}

function ConversationSummaryCard({
  entry,
}: {
  entry: ConversationDirectoryEntry;
}) {
  const title = entry.title.trim() ? entry.title : entry.id;
  const href = buildConversationHref(entry.id);

  return (
    <a
      href={href}
      className="flex flex-col gap-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm transition hover:border-primary hover:text-primary"
    >
      <span className="font-medium leading-tight">{title}</span>
      <span className="text-xs text-muted-foreground">{entry.id}</span>
      <span className="text-xs font-medium text-muted-foreground">
        {entry.branchCount} branch{entry.branchCount === 1 ? "" : "es"}
      </span>
    </a>
  );
}

function BranchTree({
  tree,
  activeBranchId,
  level,
  conversationId,
}: {
  tree: BranchTreeNode;
  activeBranchId: string;
  level: number;
  conversationId: ConversationModelId;
}) {
  const isActive = tree.branch.id === activeBranchId;
  const containsActiveDescendant = tree.children.some((child) =>
    branchContainsActive(child, activeBranchId),
  );

  return (
    <div className="flex flex-col">
      <a
        href={buildBranchHref(conversationId, tree.branch.id)}
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
              conversationId={conversationId}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function buildConversationHref(conversationId: ConversationModelId): string {
  const params = new URLSearchParams({
    conversationId,
  });
  return `/?${params.toString()}`;
}

function buildBranchHref(
  conversationId: ConversationModelId,
  branchId: string,
): string {
  const params = new URLSearchParams({ conversationId });
  if (branchId) {
    params.set("branchId", branchId);
  }
  return `/?${params.toString()}`;
}

function countBranches(node: BranchTreeNode): number {
  return 1 + node.children.reduce((total, child) => total + countBranches(child), 0);
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
