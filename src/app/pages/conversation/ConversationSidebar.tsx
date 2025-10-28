"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useState, useTransition } from "react";

import type { BranchTreeNode } from "@/app/shared/conversation.server";
import type { Conversation } from "@/lib/conversation";
import { renameBranch } from "@/app/pages/conversation/functions";
import { cn } from "@/lib/utils";
import { MoreHorizontal } from "lucide-react";

interface ConversationSidebarProps {
  conversation: Conversation;
  tree: BranchTreeNode;
  activeBranchId: string;
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
  className,
}: ConversationSidebarProps) {
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
  const [isPending, startTransition] = useTransition();

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
    if (isPending) {
      return;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      setError("Enter a name for this chat.");
      return;
    }

    setError(null);
    startTransition(async () => {
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

  return (
    <aside
      className={cn(
        "flex h-full w-72 flex-col border-r border-border bg-muted/30",
        className,
      )}
    >
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Conversations
        </h2>
        <div className="mt-2 rounded-md bg-card px-3 py-2 text-sm text-foreground shadow-sm">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p
                className="font-medium text-foreground"
                title={effectiveTitle}
              >
                {displayTitle}
              </p>
              <p
                className="mt-0.5 text-xs text-muted-foreground"
                title={`${conversation.settings.model} · ${conversation.id}`}
              >
                {conversation.settings.model} · {conversation.id}
              </p>
            </div>
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
                  disabled={isPending}
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
                  disabled={isPending}
                  className="inline-flex items-center rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isPending ? "Saving…" : "Save"}
                </button>
              </div>
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                {value.length}/{MAX_BRANCH_TITLE_LENGTH} characters
              </p>
            </form>
          ) : null}
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

function formatBranchTitle(title?: string | null): string {
  const base = title?.trim() || UNTITLED_BRANCH;
  if (base.length <= MAX_DISPLAY_TITLE_LENGTH) {
    return base;
  }

  return `${base.slice(0, MAX_DISPLAY_TITLE_LENGTH - 3).trimEnd()}...`;
}
