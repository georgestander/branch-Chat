"use client";

import type { FormEvent } from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import type { BranchTreeNode } from "@/app/shared/conversation.server";
import {
  archiveConversation,
  createConversation,
  deleteConversation,
  loadConversation,
  renameBranch,
  unarchiveConversation,
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
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  MoreVertical,
  SquarePen,
  Trash2,
} from "lucide-react";
import { navigate } from "rwsdk/client";
import {
  emitDirectoryUpdate,
  useDirectoryUpdate,
  type DirectoryUpdateDetail,
} from "@/app/components/conversation/directoryEvents";

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
  archivedAt?: string | null;
}

const DEFAULT_BRANCH_TITLE = "New Chat";
const UNTITLED_BRANCH = "Untitled Branch";
const MAX_DISPLAY_TITLE_LENGTH = 32;
const MAX_BRANCH_TITLE_LENGTH = 60;

// Keeps nested branch indentation compact enough to stay within the sidebar.
const BRANCH_INDENT_BASE_REM = 0.65;
const BRANCH_INDENT_STEP_REM = 0.45;
const BRANCH_INDENT_MAX_REM = 3.75;
const BRANCH_GUIDE_MARGIN_BASE_REM = 0.55;
const BRANCH_GUIDE_MARGIN_STEP_REM = 0.35;
const BRANCH_GUIDE_MARGIN_MAX_REM = 3.2;
const BRANCH_GUIDE_PADDING_REM = 0.7;

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
  const [archivingIds, setArchivingIds] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [showArchived, setShowArchived] = useState(false);
  const directoryUpdateHandler = useCallback(
    (detail: DirectoryUpdateDetail) => {
      setDirectoryOverrides((current) => {
        const existing = current[detail.conversationId] ?? {};
        const nextOverride: DirectoryOverride = { ...existing };
        if (detail.title !== undefined) {
          nextOverride.title = detail.title;
        }
        if (detail.branchCount !== undefined) {
          nextOverride.branchCount = detail.branchCount;
        }
        if (detail.archivedAt !== undefined) {
          nextOverride.archivedAt = detail.archivedAt;
        }

        const hasChanges =
          nextOverride.title !== existing.title ||
          nextOverride.branchCount !== existing.branchCount ||
          nextOverride.archivedAt !== existing.archivedAt;

        if (!hasChanges) {
          return current;
        }

        return {
          ...current,
          [detail.conversationId]: nextOverride,
        };
      });

      const nextTitle = detail.title;
      if (nextTitle === undefined) {
        return;
      }

      setLoadedConversations((current) => {
        const loaded = current[detail.conversationId];
        if (!loaded) {
          return current;
        }
        if (loaded.tree.branch.title === nextTitle) {
          return current;
        }
        return {
          ...current,
          [detail.conversationId]: {
            ...loaded,
            tree: {
              ...loaded.tree,
              branch: {
                ...loaded.tree.branch,
                title: nextTitle,
              },
            },
          },
        };
      });
    },
    [],
  );

  useDirectoryUpdate(directoryUpdateHandler);

  const toggleArchivingState = useCallback(
    (conversationId: ConversationModelId, enable: boolean) => {
      setArchivingIds((current) => {
        const next = new Set(current);
        if (enable) {
          next.add(conversationId);
        } else {
          next.delete(conversationId);
        }
        return next;
      });
    },
    [],
  );

  const toggleDeletingState = useCallback(
    (conversationId: ConversationModelId, enable: boolean) => {
      setDeletingIds((current) => {
        const next = new Set(current);
        if (enable) {
          next.add(conversationId);
        } else {
          next.delete(conversationId);
        }
        return next;
      });
    },
    [],
  );

  const applyDirectoryEntry = useCallback(
    (entry: ConversationDirectoryEntry) => {
      setDirectoryOverrides((current) => ({
        ...current,
        [entry.id]: {
          ...current[entry.id],
          title: entry.title,
          branchCount: entry.branchCount,
          archivedAt: entry.archivedAt,
        },
      }));

      emitDirectoryUpdate({
        conversationId: entry.id,
        title: entry.title,
        branchCount: entry.branchCount,
        lastActiveAt: entry.lastActiveAt,
        archivedAt: entry.archivedAt,
      });
    },
    [],
  );

  const removeConversationLocally = useCallback((targetConversationId: ConversationModelId) => {
    setDirectoryOverrides((current) => {
      if (!current[targetConversationId]) {
        return current;
      }
      const next = { ...current };
      delete next[targetConversationId];
      return next;
    });

    setLoadedConversations((current) => {
      if (!current[targetConversationId]) {
        return current;
      }
      const next = { ...current };
      delete next[targetConversationId];
      return next;
    });

    setExpandedIds((current) => {
      if (!current.has(targetConversationId)) {
        return current;
      }
      const next = new Set(current);
      next.delete(targetConversationId);
      return next;
    });

    setLoadingErrors((current) => {
      if (!current[targetConversationId]) {
        return current;
      }
      const { [targetConversationId]: _removed, ...rest } = current;
      return rest;
    });

    setArchivingIds((current) => {
      if (!current.has(targetConversationId)) {
        return current;
      }
      const next = new Set(current);
      next.delete(targetConversationId);
      return next;
    });

    setDeletingIds((current) => {
      if (!current.has(targetConversationId)) {
        return current;
      }
      const next = new Set(current);
      next.delete(targetConversationId);
      return next;
    });
  }, []);

  const runArchiveConversation = useCallback(
    async (targetConversationId: ConversationModelId) => {
      toggleArchivingState(targetConversationId, true);
      setLoadingErrors((current) => {
        const { [targetConversationId]: _removed, ...rest } = current;
        return rest;
      });

      try {
        const result = await archiveConversation({
          conversationId: targetConversationId,
        });
        applyDirectoryEntry(result.entry);
      } catch (error) {
        console.error("[Sidebar] archiveConversation failed", error);
        setLoadingErrors((current) => ({
          ...current,
          [targetConversationId]: "Unable to archive this chat. Please try again.",
        }));
      } finally {
        toggleArchivingState(targetConversationId, false);
      }
    },
    [applyDirectoryEntry, toggleArchivingState],
  );

  const runUnarchiveConversation = useCallback(
    async (targetConversationId: ConversationModelId) => {
      toggleArchivingState(targetConversationId, true);
      setLoadingErrors((current) => {
        const { [targetConversationId]: _removed, ...rest } = current;
        return rest;
      });

      try {
        const result = await unarchiveConversation({
          conversationId: targetConversationId,
        });
        applyDirectoryEntry(result.entry);
      } catch (error) {
        console.error("[Sidebar] unarchiveConversation failed", error);
        setLoadingErrors((current) => ({
          ...current,
          [targetConversationId]: "Unable to unarchive this chat. Please try again.",
        }));
      } finally {
        toggleArchivingState(targetConversationId, false);
      }
    },
    [applyDirectoryEntry, toggleArchivingState],
  );

  const runDeleteConversation = useCallback(
    async (targetConversationId: ConversationModelId) => {
      toggleDeletingState(targetConversationId, true);
      setLoadingErrors((current) => {
        const { [targetConversationId]: _removed, ...rest } = current;
        return rest;
      });

      try {
        await deleteConversation({ conversationId: targetConversationId });
        removeConversationLocally(targetConversationId);
        if (targetConversationId === conversationId) {
          navigate("/");
        }
      } catch (error) {
        console.error("[Sidebar] deleteConversation failed", error);
        setLoadingErrors((current) => ({
          ...current,
          [targetConversationId]: "Unable to delete this chat. Please try again.",
        }));
      } finally {
        toggleDeletingState(targetConversationId, false);
      }
    },
    [conversationId, removeConversationLocally, toggleDeletingState],
  );

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
        archivedAt: null,
      };

    return {
      ...baseEntry,
      ...override,
      archivedAt: override?.archivedAt ?? baseEntry.archivedAt ?? null,
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
        archivedAt:
          directoryOverrides[entry.id]?.archivedAt ?? entry.archivedAt ?? null,
      }));
  }, [conversationId, directoryOverrides, sortedConversations]);

  const allEntries = useMemo(
    () => [resolvedActiveEntry, ...resolvedOtherEntries],
    [resolvedActiveEntry, resolvedOtherEntries],
  );

  const activeEntries = useMemo(
    () => allEntries.filter((entry) => !entry.archivedAt),
    [allEntries],
  );

  const archivedEntries = useMemo(
    () => allEntries.filter((entry) => entry.archivedAt),
    [allEntries],
  );

  useEffect(() => {
    if (archivedEntries.length === 0 && showArchived) {
      setShowArchived(false);
    }
  }, [archivedEntries.length, showArchived]);

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
        const normalizedTitle =
          branchTree.branch.title?.trim() || loadedConversation.id;
        const normalizedBranchCount = Object.keys(result.snapshot.branches).length;
        setDirectoryOverrides((current) => ({
          ...current,
          [targetConversationId]: {
            ...current[targetConversationId],
            title: normalizedTitle,
            branchCount: normalizedBranchCount,
          },
        }));
        emitDirectoryUpdate({
          conversationId: targetConversationId,
          title: normalizedTitle,
          branchCount: normalizedBranchCount,
          archivedAt:
            directoryOverrides[targetConversationId]?.archivedAt ?? null,
        });
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
          ...current[targetConversationId],
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
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            Connexus
          </h2>
          <button
            type="button"
            onClick={startNewConversation}
            disabled={isCreating}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-foreground shadow-sm transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-70"
            aria-label={isCreating ? "Creating new chat" : "Start a new chat"}
          >
            <SquarePen className="h-4 w-4" aria-hidden="true" />
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
          {activeEntries.map((entry) => {
            const loaded = loadedConversations[entry.id];
            const isExpanded = expandedIds.has(entry.id);
            const isLoading = loadingIds.has(entry.id);
            const errorMessage = loadingErrors[entry.id] ?? null;
            return (
              <ConversationCard
                key={entry.id}
                entry={entry}
                isActive={entry.id === conversationId}
                isArchived={false}
                expanded={isExpanded}
                loading={isLoading}
                archiving={archivingIds.has(entry.id)}
                deleting={deletingIds.has(entry.id)}
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
                onArchive={() => runArchiveConversation(entry.id)}
                onUnarchive={() => runUnarchiveConversation(entry.id)}
                onDelete={() => runDeleteConversation(entry.id)}
              />
            );
          })}
        </div>

        {archivedEntries.length > 0 ? (
          <div className="mt-6">
            <button
              type="button"
              onClick={() => setShowArchived((value) => !value)}
              className="flex w-full items-center justify-between rounded-md border border-border/60 bg-muted/50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground transition hover:bg-muted"
              aria-expanded={showArchived}
            >
              <span className="flex items-center gap-2">
                <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                Archived ({archivedEntries.length})
              </span>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 transition-transform",
                  showArchived ? "rotate-180" : "rotate-0",
                )}
                aria-hidden="true"
              />
            </button>

            {showArchived ? (
              <div className="mt-3 flex flex-col gap-3">
                {archivedEntries.map((entry) => {
                  const loaded = loadedConversations[entry.id];
                  const isExpanded = expandedIds.has(entry.id);
                  const isLoading = loadingIds.has(entry.id);
                  const errorMessage = loadingErrors[entry.id] ?? null;
                  return (
                    <ConversationCard
                      key={entry.id}
                      entry={entry}
                      isActive={entry.id === conversationId}
                      isArchived
                      expanded={isExpanded}
                      loading={isLoading}
                      archiving={archivingIds.has(entry.id)}
                      deleting={deletingIds.has(entry.id)}
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
                      onArchive={() => runArchiveConversation(entry.id)}
                      onUnarchive={() => runUnarchiveConversation(entry.id)}
                      onDelete={() => runDeleteConversation(entry.id)}
                    />
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}
      </nav>
    </aside>
  );
}

interface ConversationCardProps {
  entry: ConversationDirectoryEntry;
  isActive: boolean;
  isArchived: boolean;
  expanded: boolean;
  loading: boolean;
  archiving: boolean;
  deleting: boolean;
  error: string | null;
  loadedConversation?: LoadedConversationData;
  activeBranchId?: string;
  onToggle: () => void;
  onLoad: () => Promise<LoadedConversationData | undefined>;
  onRename: (title: string) => Promise<void>;
  onArchive: () => Promise<void> | void;
  onUnarchive: () => Promise<void> | void;
  onDelete: () => Promise<void> | void;
}

function ConversationCard({
  entry,
  isActive,
  isArchived,
  expanded,
  loading,
  archiving,
  deleting,
  error,
  loadedConversation,
  activeBranchId,
  onToggle,
  onLoad,
  onRename,
  onArchive,
  onUnarchive,
  onDelete,
}: ConversationCardProps) {
  const branchCount = entry.branchCount ?? 0;
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(entry.title.trim() || entry.id);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRenaming, startRenameTransition] = useTransition();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const statusLabel = isArchived ? "Archived" : isActive ? "Active" : "Idle";
  const statusBadgeClass = isArchived
    ? "bg-muted text-muted-foreground"
    : isActive
      ? "bg-primary/15 text-primary"
      : "bg-muted text-muted-foreground";

  useEffect(() => {
    if (!isEditing) {
      setValue(entry.title.trim() || entry.id);
    }
  }, [entry.id, entry.title, isEditing]);

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    const handlePointer = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (
        menuRef.current?.contains(target) ||
        menuButtonRef.current?.contains(target)
      ) {
        return;
      }
      setIsMenuOpen(false);
    };

    window.addEventListener("mousedown", handlePointer);
    return () => {
      window.removeEventListener("mousedown", handlePointer);
    };
  }, [isMenuOpen]);

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
    };
  }, [isMenuOpen]);

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }
    if (archiving || deleting) {
      setIsMenuOpen(false);
    }
  }, [archiving, deleting, isMenuOpen]);

  const toggleEditing = useCallback(async () => {
    if (archiving || deleting) {
      return;
    }
    setIsMenuOpen(false);
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
  }, [archiving, deleting, isEditing, loadedConversation, onLoad]);

  const submitRename = useCallback(
    (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      if (isRenaming) {
        return;
      }

      if (archiving || deleting) {
        setErrorMessage("Finish the pending action before renaming.");
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
    [archiving, deleting, isRenaming, onRename, value],
  );

  const handleMenuRename = useCallback(() => {
    setIsMenuOpen(false);
    void toggleEditing();
  }, [toggleEditing]);

  const handleMenuArchiveToggle = useCallback(() => {
    setIsMenuOpen(false);
    if (isArchived) {
      void onUnarchive();
    } else {
      void onArchive();
    }
  }, [isArchived, onArchive, onUnarchive]);

  const handleMenuDelete = useCallback(() => {
    if (deleting) {
      return;
    }
    const confirmed = window.confirm(
      "Delete this chat? This action cannot be undone.",
    );
    if (!confirmed) {
      return;
    }
    setIsMenuOpen(false);
    void onDelete();
  }, [deleting, onDelete]);

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-md px-3 py-2 text-sm shadow-sm transition",
        isActive
          ? "bg-primary/10 text-primary shadow-sm hover:bg-primary/15"
          : "bg-card text-foreground hover:bg-muted/70",
      )}
      data-active={isActive}
    >
      <div className="grid grid-cols-[1fr_auto] items-center gap-2">
        <button
          type="button"
          onClick={() => {
            onToggle();
          }}
          className={cn(
            "flex min-w-0 items-center gap-2 text-left transition",
            isActive
              ? "text-primary"
              : expanded
                ? "text-foreground"
                : "text-foreground/90",
          )}
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          <span className="min-w-0 truncate font-medium" title={entry.title}>
            {entry.title.trim() || entry.id}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          <span className="shrink-0 text-xs text-muted-foreground">
            {branchCount} branch{branchCount === 1 ? "" : "es"}
          </span>
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em]",
              statusBadgeClass,
            )}
          >
            {statusLabel}
          </span>
          <div className="relative">
            <button
              ref={menuButtonRef}
              type="button"
              onClick={() => setIsMenuOpen((value) => !value)}
              className={cn(
                "inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-muted-foreground transition hover:border-border hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                isActive && "text-primary/80 hover:text-primary",
                (archiving || deleting) && "cursor-wait",
              )}
              aria-haspopup="menu"
              aria-expanded={isMenuOpen}
              disabled={archiving || deleting}
            >
              <MoreVertical className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">Conversation options</span>
            </button>
            {isMenuOpen ? (
              <div
                ref={menuRef}
                role="menu"
                className="absolute right-0 top-full z-50 mt-2 w-48 rounded-md border border-border bg-popover p-2 text-foreground shadow-xl"
              >
                <button
                  type="button"
                  onClick={handleMenuRename}
                  disabled={loading || archiving || deleting}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                  role="menuitem"
                >
                  <SquarePen className="h-4 w-4" aria-hidden="true" />
                  Rename chat
                </button>
                <button
                  type="button"
                  onClick={handleMenuArchiveToggle}
                  disabled={archiving || deleting}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                  role="menuitem"
                >
                  {isArchived ? (
                    <ArchiveRestore className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Archive className="h-4 w-4" aria-hidden="true" />
                  )}
                  {isArchived ? "Unarchive chat" : "Archive chat"}
                </button>
                <button
                  type="button"
                  onClick={handleMenuDelete}
                  disabled={deleting || archiving}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-destructive transition hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-60"
                  role="menuitem"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Delete chat
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

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
              disabled={isRenaming || archiving || deleting}
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
              disabled={isRenaming || archiving || deleting}
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

      {archiving ? (
        <p className="text-xs text-muted-foreground" role="status">
          Archiving chat…
        </p>
      ) : null}
      {deleting ? (
        <p className="text-xs text-muted-foreground" role="status">
          Deleting chat…
        </p>
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
  const indentRem = Math.min(
    BRANCH_INDENT_BASE_REM + level * BRANCH_INDENT_STEP_REM,
    BRANCH_INDENT_MAX_REM,
  );
  const guideMarginRem = Math.min(
    BRANCH_GUIDE_MARGIN_BASE_REM + level * BRANCH_GUIDE_MARGIN_STEP_REM,
    BRANCH_GUIDE_MARGIN_MAX_REM,
  );

  return (
    <div className="flex flex-col">
      <a
        href={buildBranchHref(conversationId, tree.branch.id)}
        className={cn(
          "group relative flex max-w-full items-center justify-between rounded-md px-3 py-2 text-sm transition hover:bg-muted/80",
          isActive
            ? "bg-primary/10 font-semibold text-primary shadow-sm hover:bg-primary/15"
            : "text-foreground",
        )}
        data-active={isActive}
        aria-current={isActive ? "page" : undefined}
        style={{ paddingInlineStart: `${indentRem}rem` }}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "h-2 w-2 shrink-0 rounded-full border border-border/60 transition",
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
            "border-l",
            containsActiveDescendant
              ? "border-primary/40"
              : "border-border/60",
          )}
          style={{
            marginLeft: `${guideMarginRem}rem`,
            paddingLeft: `${BRANCH_GUIDE_PADDING_REM}rem`,
          }}
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
