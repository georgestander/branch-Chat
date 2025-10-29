"use client";

import type { FormEvent } from "react";
import {
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";

import type { BranchTreeNode } from "@/app/shared/conversation.server";
import {
  createConversation,
  renameBranch,
} from "@/app/pages/conversation/functions";
import type {
  Conversation,
  ConversationModelId,
} from "@/lib/conversation";
import type { ConversationDirectoryEntry } from "@/lib/durable-objects/ConversationDirectory";
import { cn } from "@/lib/utils";
import {
  MoreHorizontal,
  Plus,
} from "lucide-react";
import { navigate } from "rwsdk/client";

interface ConversationSidebarProps {
  conversation: Conversation;
  tree: BranchTreeNode;
  activeBranchId: string;
  conversationId: ConversationModelId;
  conversations: ConversationDirectoryEntry[];
  className?: string;
}

const DEFAULT_BRANCH_TITLE = "Main Branch";
const UNTITLED_BRANCH = "Untitled Branch";
const MAX_DISPLAY_TITLE_LENGTH = 32;
const MAX_BRANCH_TITLE_LENGTH = 60;

export function ConversationSidebar({
  conversation,
  tree,
  activeBranchId,
  conversationId,
  conversations,
  className,
}: ConversationSidebarProps) {
  const [creationError, setCreationError] = useState<string | null>(null);
  const [isCreating, startCreateTransition] = useTransition();

  const sortedConversations = useMemo(
    () =>
      [...conversations].sort(
        (a, b) =>
          b.lastActiveAt.localeCompare(a.lastActiveAt) ||
          a.id.localeCompare(b.id),
      ),
    [conversations],
  );

  const activeEntry = useMemo(() => {
    return (
      sortedConversations.find((entry) => entry.id === conversationId) ?? {
        id: conversationId,
        title: conversation.id,
        createdAt: conversation.createdAt,
        lastActiveAt: conversation.createdAt,
        branchCount: countBranches(tree),
      }
    );
  }, [conversation, conversationId, sortedConversations, tree]);

  const otherConversations = useMemo(
    () =>
      sortedConversations.filter((entry) => entry.id !== conversationId),
    [conversationId, sortedConversations],
  );

  const startNewConversation = () => {
    if (isCreating) {
      return;
    }
    setCreationError(null);
    startCreateTransition(async () => {
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
            disabled={isCreating}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {isCreating ? "Creating…" : "New chat"}
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
  const rootBranch = tree.branch;
  const resolvedTitle = rootBranch.title?.trim() || DEFAULT_BRANCH_TITLE;
  const [optimisticTitle, setOptimisticTitle] = useState<string | null>(null);
  const effectiveTitle = optimisticTitle ?? resolvedTitle;
  const displayTitle = useMemo(
    () => formatBranchTitle(effectiveTitle),
    [effectiveTitle],
  );

  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(effectiveTitle);
  const [error, setError] = useState<string | null>(null);
  const [isRenaming, startRenameTransition] = useTransition();

  useEffect(() => {
    setOptimisticTitle(null);
  }, [resolvedTitle]);

  useEffect(() => {
    if (!isEditing) {
      setValue(effectiveTitle);
    }
  }, [effectiveTitle, isEditing]);

  const submitRename = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (isRenaming) {
      return;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      setError("Enter a name for this chat.");
      return;
    }

    setError(null);
    startRenameTransition(async () => {
      try {
        await renameBranch({
          conversationId: conversation.id,
          branchId: rootBranch.id,
          title: trimmed,
        });
        setOptimisticTitle(trimmed);
        setValue(trimmed);
        setIsEditing(false);
      } catch (cause) {
        console.error("[Sidebar] renameBranch failed", cause);
        setError("We couldn't rename this chat. Try again.");
      }
    });
  };

  const branchCount = countBranches(tree);

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground" title={effectiveTitle}>
              {displayTitle}
            </p>
            <p
              className="mt-0.5 text-xs text-muted-foreground"
              title={`${conversation.settings.model} · ${conversation.id}`}
            >
              {conversation.settings.model} · {conversation.id}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {branchCount} branch{branchCount === 1 ? "" : "es"}
            </span>
            <button
              type="button"
              onClick={() => {
                setIsEditing((value) => !value);
                setError(null);
              }}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-muted-foreground transition hover:border-border hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              aria-label={isEditing ? "Cancel rename" : "Rename chat"}
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {isEditing ? (
          <form
            onSubmit={submitRename}
            className="mt-3 flex flex-col gap-2"
          >
            <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              Rename Chat
              <input
                value={value}
                maxLength={MAX_BRANCH_TITLE_LENGTH}
                onChange={(event) => setValue(event.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-70"
                placeholder="Enter a short title"
                disabled={isRenaming}
              />
            </label>
            {error ? (
              <p className="text-xs text-destructive" role="status">
                {error}
              </p>
            ) : null}
            <div className="flex items-center justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  setIsEditing(false);
                  setValue(resolvedTitle);
                  setError(null);
                }}
                className="text-muted-foreground transition hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isRenaming}
                className="inline-flex items-center rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isRenaming ? "Saving…" : "Save"}
              </button>
            </div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              {value.length}/{MAX_BRANCH_TITLE_LENGTH} characters
            </p>
          </form>
        ) : null}
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
      className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground shadow-sm transition hover:border-primary hover:text-primary"
    >
      <span className="truncate font-medium" title={title}>
        {title}
      </span>
      <span className="whitespace-nowrap text-xs font-medium text-muted-foreground">
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
          <span
            className="truncate"
            title={tree.branch.title?.trim() || UNTITLED_BRANCH}
          >
            {formatBranchTitle(tree.branch.title)}
          </span>
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

function formatBranchTitle(title?: string | null): string {
  const base = title?.trim() || UNTITLED_BRANCH;
  if (base.length <= MAX_DISPLAY_TITLE_LENGTH) {
    return base;
  }

  return `${base.slice(0, MAX_DISPLAY_TITLE_LENGTH - 3).trimEnd()}...`;
}
