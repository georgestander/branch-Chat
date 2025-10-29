"use client";

import type { FormEvent } from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";

import type { BranchTreeNode } from "@/app/shared/conversation.server";
import {
  createConversation,
  loadConversation,
  renameBranch,
} from "@/app/pages/conversation/functions";
import type {
  Branch,
  BranchId,
  Conversation,
  ConversationGraphSnapshot,
  ConversationModelId,
} from "@/lib/conversation";
import type { ConversationDirectoryEntry } from "@/lib/durable-objects/ConversationDirectory";
import { cn } from "@/lib/utils";
import { MoreHorizontal, Plus } from "lucide-react";
import { navigate } from "rwsdk/client";

interface ConversationSidebarProps {
  conversation: Conversation;
  tree: BranchTreeNode;
  activeBranchId: string;
  conversationId: ConversationModelId;
  conversations: ConversationDirectoryEntry[];
  className?: string;
}

interface LoadedConversationData {
  tree: BranchTreeNode;
  conversation: Conversation;
}

interface DirectoryOverride {
  title?: string;
  branchCount?: number;
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

  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set([conversationId]),
  );
  const [loadedConversations, setLoadedConversations] =
    useState<Record<string, LoadedConversationData>>(() => ({
      [conversationId]: { tree, conversation },
    }));
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [loadingErrors, setLoadingErrors] = useState<Record<string, string>>({});
  const [directoryOverrides, setDirectoryOverrides] = useState<
    Record<string, DirectoryOverride>
  >({});

  useEffect(() => {
    setLoadedConversations((current) => ({
      ...current,
      [conversationId]: { tree, conversation },
    }));
  }, [conversation, conversationId, tree]);

  useEffect(() => {
    setExpandedIds((current) => {
      if (current.has(conversationId)) {
        return current;
      }
      const next = new Set(current);
      next.add(conversationId);
      return next;
    });
  }, [conversationId]);

  const sortedConversations = useMemo(
    () =>
      [...conversations].sort(
        (a, b) =>
          b.lastActiveAt.localeCompare(a.lastActiveAt) ||
          a.id.localeCompare(b.id),
      ),
    [conversations],
  );

  const resolvedActiveEntry = useMemo(() => {
    const override = directoryOverrides[conversationId];
    const baseEntry =
      sortedConversations.find((entry) => entry.id === conversationId) ?? {
        id: conversationId,
        title: conversation.id,
        createdAt: conversation.createdAt,
        lastActiveAt: conversation.createdAt,
        branchCount: countBranches(tree),
      };

    return {
      ...baseEntry,
      ...override,
    } satisfies ConversationDirectoryEntry;
  }, [
    conversation,
    conversationId,
    directoryOverrides,
    sortedConversations,
    tree,
  ]);

  const resolvedOtherEntries = useMemo(() => {
    return sortedConversations
      .filter((entry) => entry.id !== conversationId)
      .map((entry) => ({
        ...entry,
        ...directoryOverrides[entry.id],
      }));
  }, [conversationId, directoryOverrides, sortedConversations]);

  const orderedEntries = useMemo(
    () => [resolvedActiveEntry, ...resolvedOtherEntries],
    [resolvedActiveEntry, resolvedOtherEntries],
  );

  const ensureConversationLoaded = useCallback(
    async (targetConversationId: ConversationModelId) => {
      const existing = loadedConversations[targetConversationId];
      if (existing) {
        return existing;
      }
      if (loadingIds.has(targetConversationId)) {
        return undefined;
      }

      setLoadingIds((current) => {
        const next = new Set(current);
        next.add(targetConversationId);
        return next;
      });
      setLoadingErrors((current) => {
        const { [targetConversationId]: _ignored, ...rest } = current;
        return rest;
      });

      try {
        const result = await loadConversation({
          conversationId: targetConversationId,
        });
        const loadedConversation = result.snapshot.conversation;
        const branchTree = buildBranchTreeFromSnapshot(result.snapshot);
        setLoadedConversations((current) => ({
          ...current,
          [targetConversationId]: {
            tree: branchTree,
            conversation: loadedConversation,
          },
        }));
        setDirectoryOverrides((current) => ({
          ...current,
          [targetConversationId]: {
            title:
              branchTree.branch.title?.trim() ||
              loadedConversation.id,
            branchCount: Object.keys(result.snapshot.branches).length,
          },
        }));
        return {
          tree: branchTree,
          conversation: loadedConversation,
        } satisfies LoadedConversationData;
      } catch (error) {
        console.error("[Sidebar] loadConversation failed", error);
        setLoadingErrors((current) => ({
          ...current,
          [targetConversationId]:
            "Unable to load this chat. Please try again.",
        }));
        return undefined;
      } finally {
        setLoadingIds((current) => {
          const next = new Set(current);
          next.delete(targetConversationId);
          return next;
        });
      }
    },
    [loadedConversations, loadingIds],
  );

  const handleRename = useCallback(
    async (
      targetConversationId: ConversationModelId,
      branchId: BranchId,
      title: string,
    ) => {
      const result = await renameBranch({
        conversationId: targetConversationId,
        branchId,
        title,
      });
      const branchTree = buildBranchTreeFromSnapshot(result.snapshot);
      const loadedConversation = result.snapshot.conversation;
      setLoadedConversations((current) => ({
        ...current,
        [targetConversationId]: {
          tree: branchTree,
          conversation: loadedConversation,
        },
      }));
      setDirectoryOverrides((current) => ({
        ...current,
        [targetConversationId]: {
          title:
            branchTree.branch.title?.trim() ||
            loadedConversation.id,
          branchCount: Object.keys(result.snapshot.branches).length,
        },
      }));
    },
    [],
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
        <div className="flex flex-col gap-3">
          {orderedEntries.map((entry) => {
            const loaded = loadedConversations[entry.id];
            const isExpanded = expandedIds.has(entry.id);
            const isLoading = loadingIds.has(entry.id);
            const errorMessage = loadingErrors[entry.id] ?? null;
            return (
              <ConversationCard
                key={entry.id}
                entry={entry}
                isActive={entry.id === conversationId}
                expanded={isExpanded}
                loading={isLoading}
                error={errorMessage}
                loadedConversation={loaded}
                activeBranchId={
                  entry.id === conversationId ? activeBranchId : undefined
                }
                onToggle={() => {
                  setExpandedIds((current) => {
                    const next = new Set(current);
                    if (next.has(entry.id)) {
                      next.delete(entry.id);
                    } else {
                      next.add(entry.id);
                    }
                    return next;
                  });
                  if (!isExpanded) {
                    void ensureConversationLoaded(entry.id);
                  }
                }}
                onLoad={() => ensureConversationLoaded(entry.id)}
                onRename={async (nextTitle) => {
                  const ensured =
                    loadedConversations[entry.id] ??
                    (await ensureConversationLoaded(entry.id));
                  if (!ensured) {
                    throw new Error("Conversation data unavailable");
                  }
                  await handleRename(entry.id, ensured.tree.branch.id, nextTitle);
                }}
              />
            );
          })}
        </div>
      </nav>
    </aside>
  );
}

interface ConversationCardProps {
  entry: ConversationDirectoryEntry;
  isActive: boolean;
  expanded: boolean;
  loading: boolean;
  error: string | null;
  loadedConversation?: LoadedConversationData;
  activeBranchId?: string;
  onToggle: () => void;
  onLoad: () => Promise<LoadedConversationData | undefined>;
  onRename: (title: string) => Promise<void>;
}

function ConversationCard({
  entry,
  isActive,
  expanded,
  loading,
  error,
  loadedConversation,
  activeBranchId,
  onToggle,
  onLoad,
  onRename,
}: ConversationCardProps) {
  const branchCount = entry.branchCount ?? 0;
  const modelLabel = loadedConversation?.conversation.settings.model;
  const conversationIdentifier = loadedConversation?.conversation.id ?? entry.id;
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(entry.title.trim() || entry.id);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRenaming, startRenameTransition] = useTransition();

  useEffect(() => {
    if (!isEditing) {
      setValue(entry.title.trim() || entry.id);
    }
  }, [entry.id, entry.title, isEditing]);

  const toggleEditing = useCallback(async () => {
    if (!isEditing) {
      const ensured = loadedConversation ?? (await onLoad());
      if (!ensured) {
        setErrorMessage("We couldn't load this chat. Try again before renaming.");
        return;
      }
      setValue(
        ensured.tree.branch.title?.trim() || DEFAULT_BRANCH_TITLE,
      );
    }
    setIsEditing((current) => !current);
    setErrorMessage(null);
  }, [isEditing, loadedConversation, onLoad]);

  const submitRename = useCallback(
    (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      if (isRenaming) {
        return;
      }

      const trimmed = value.trim();
      if (!trimmed) {
        setErrorMessage("Enter a name for this chat.");
        return;
      }

      setErrorMessage(null);
      startRenameTransition(async () => {
        try {
          await onRename(trimmed);
          setIsEditing(false);
        } catch (cause) {
          console.error("[Sidebar] renameBranch failed", cause);
          setErrorMessage("We couldn't rename this chat. Try again.");
        }
      });
    },
    [isRenaming, onRename, value],
  );

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground shadow-sm">
      <button
        type="button"
        onClick={() => {
          onToggle();
        }}
        className={cn(
          "flex items-start justify-between gap-2 text-left",
          expanded ? "text-foreground" : "text-foreground/90",
        )}
        aria-expanded={expanded}
      >
        <div className="min-w-0 flex-1">
          <p className="font-medium" title={entry.title}>
            {entry.title.trim() || entry.id}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {branchCount} branch{branchCount === 1 ? "" : "es"}
            {modelLabel ? ` · ${modelLabel}` : ""}
            {conversationIdentifier && modelLabel
              ? ` · ${conversationIdentifier}`
              : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isActive ? (
            <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-primary-foreground">
              Active
            </span>
          ) : null}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              void toggleEditing();
            }}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-muted-foreground transition hover:border-border hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            aria-label={isEditing ? "Cancel rename" : "Rename chat"}
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </button>

      {isEditing ? (
        <form onSubmit={submitRename} className="flex flex-col gap-2">
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
          {errorMessage ? (
            <p className="text-xs text-destructive" role="status">
              {errorMessage}
            </p>
          ) : null}
          <div className="flex items-center justify-end gap-2 text-xs">
            <button
              type="button"
              onClick={() => {
                setIsEditing(false);
                setValue(entry.title.trim() || entry.id);
                setErrorMessage(null);
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

      {expanded ? (
        <div className="space-y-2">
          {loading ? (
            <p className="text-xs text-muted-foreground">Loading branches…</p>
          ) : null}
          {error ? (
            <p className="text-xs text-destructive" role="status">
              {error}
            </p>
          ) : null}
          {!loading && !error && loadedConversation ? (
            <BranchTree
              tree={loadedConversation.tree}
              activeBranchId={activeBranchId}
              level={0}
              conversationId={entry.id}
            />
          ) : null}
          {!loading && !error && !loadedConversation ? (
            <button
              type="button"
              onClick={() => {
                void onLoad();
              }}
              className="text-xs font-medium text-primary underline-offset-4 hover:underline"
            >
              Load branches
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function BranchTree({
  tree,
  activeBranchId,
  level,
  conversationId,
}: {
  tree: BranchTreeNode;
  activeBranchId?: string;
  level: number;
  conversationId: ConversationModelId;
}) {
  const isActive = Boolean(activeBranchId && tree.branch.id === activeBranchId);
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
  activeBranchId?: string,
): boolean {
  if (!activeBranchId) {
    return false;
  }
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

function buildBranchTreeFromSnapshot(
  snapshot: ConversationGraphSnapshot,
): BranchTreeNode {
  const childrenMap = new Map<BranchId, Branch[]>();

  for (const branch of Object.values(snapshot.branches)) {
    if (!branch.parentId) {
      continue;
    }
    const siblings = childrenMap.get(branch.parentId) ?? [];
    siblings.push(branch);
    childrenMap.set(branch.parentId, siblings);
  }

  const buildNode = (branch: Branch, depth: number): BranchTreeNode => {
    const children = (childrenMap.get(branch.id) ?? [])
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((child) => buildNode(child, depth + 1));
    return { branch, children, depth };
  };

  const rootBranch = snapshot.branches[snapshot.conversation.rootBranchId];
  if (!rootBranch) {
    throw new Error("Root branch missing from snapshot");
  }

  return buildNode(rootBranch, 0);
}
