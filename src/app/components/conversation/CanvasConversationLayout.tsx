"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  Command,
  GitBranch,
  LayoutDashboard,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { navigate } from "rwsdk/client";

import type {
  Branch,
  BranchId,
  ComposerPreset,
  Conversation,
  ConversationCanvasPatch,
  ConversationGraphSnapshot,
  ConversationModelId,
  ReasoningEffort,
} from "@/lib/conversation";
import {
  applyCanvasPatch,
  DEFAULT_CONVERSATION_MODEL,
} from "@/lib/conversation";
import type { ConversationComposerTool } from "@/lib/conversation/tools";
import type { RenderedMessage } from "@/lib/conversation/rendered";
import type { ConversationDirectoryEntry } from "@/lib/durable-objects/ConversationDirectory";
import type { OpenRouterModelOption } from "@/lib/openrouter/models";
import { supportsReasoningEffortModel } from "@/lib/openai/models";
import { cn } from "@/lib/utils";
import {
  createConversation,
  archiveConversation,
  deleteBranch,
  deleteConversation,
  loadCanvasBranchCard,
  openCanvasBranchCard,
  renameBranch,
  sendMessage,
  unarchiveConversation,
  updateConversationCanvas,
  updateConversationSettings,
} from "@/app/pages/conversation/functions";
import { ConversationCanvas } from "@/app/components/conversation/ConversationCanvas";
import { BranchColumn } from "@/app/components/conversation/BranchColumn";
import type { BranchSelectionDraft } from "@/app/components/conversation/BranchableMessage";
import { ToastProvider } from "@/app/components/ui/Toast";
import { ThemeToggle } from "@/app/components/ui/ThemeToggle";
import {
  PERSISTED_MESSAGES_EVENT,
  type PersistedMessagesDetail,
} from "@/app/components/conversation/messageEvents";

interface CanvasConversationLayoutProps {
  snapshot: ConversationGraphSnapshot;
  conversation: Conversation;
  initialActiveBranchId: BranchId;
  initialMessagesByBranch: Record<BranchId, RenderedMessage[]>;
  conversationId: ConversationModelId;
  conversations: ConversationDirectoryEntry[];
  openRouterModels: OpenRouterModelOption[];
}

const VALID_TOOLS = new Set<ConversationComposerTool>([
  "study-and-learn",
  "web-search",
  "file-upload",
]);

function normalizeTools(value: unknown): ConversationComposerTool[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (tool, index): tool is ConversationComposerTool =>
      typeof tool === "string" &&
      VALID_TOOLS.has(tool as ConversationComposerTool) &&
      value.indexOf(tool) === index,
  );
}

function escapeMessageHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function canvasHref(conversationId: string): string {
  const params = new URLSearchParams({ conversationId });
  return `/app?${params.toString()}`;
}

export function CanvasConversationLayout({
  snapshot,
  conversation,
  initialActiveBranchId,
  initialMessagesByBranch,
  conversationId,
  conversations,
  openRouterModels,
}: CanvasConversationLayoutProps) {
  const initialModel = conversation.settings.model || DEFAULT_CONVERSATION_MODEL;
  const [model, setModel] = useState(initialModel);
  const [effort, setEffort] = useState<ReasoningEffort | null>(
    supportsReasoningEffortModel(initialModel)
      ? (conversation.settings.reasoningEffort ?? "medium")
      : null,
  );
  const [preset, setPreset] = useState<ComposerPreset>(
    conversation.settings.composerDefaults?.preset ?? "fast",
  );
  const [tools, setTools] = useState<ConversationComposerTool[]>(
    normalizeTools(conversation.settings.composerDefaults?.tools ?? []),
  );
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [bootstrapMessage, setBootstrapMessage] = useState<string | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [canvasError, setCanvasError] = useState<string | null>(null);
  const [canvasSnapshot, setCanvasSnapshot] = useState(snapshot);
  const [directoryEntries, setDirectoryEntries] = useState(conversations);
  const [messagesByBranch, setMessagesByBranch] = useState(initialMessagesByBranch);
  const [loadingBranchIds, setLoadingBranchIds] = useState<Set<BranchId>>(
    () => new Set(),
  );
  const [branchDraft, setBranchDraft] = useState<BranchSelectionDraft | null>(null);
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);
  const autoOpenedBranchRef = useRef<BranchId | null>(null);
  const [isCreating, startCreate] = useTransition();
  const [isDeleting, startDelete] = useTransition();
  const [isPatching, startPatch] = useTransition();

  useEffect(() => {
    const nextModel = conversation.settings.model || DEFAULT_CONVERSATION_MODEL;
    setModel(nextModel);
    setEffort(
      supportsReasoningEffortModel(nextModel)
        ? (conversation.settings.reasoningEffort ?? "medium")
        : null,
    );
    setPreset(conversation.settings.composerDefaults?.preset ?? "fast");
    setTools(normalizeTools(conversation.settings.composerDefaults?.tools ?? []));
  }, [conversation.settings]);

  useEffect(() => {
    setCanvasSnapshot(snapshot);
    setDirectoryEntries(conversations);
    setMessagesByBranch(initialMessagesByBranch);
    setLoadingBranchIds(new Set());
    setBranchDraft(null);
    setIsCreatingBranch(false);
  }, [conversationId, conversations, initialMessagesByBranch, snapshot]);

  useEffect(() => {
    const handlePersistedMessages = (event: Event) => {
      const detail = (event as CustomEvent<PersistedMessagesDetail>).detail;
      if (!detail || detail.conversationId !== conversationId) return;
      setCanvasSnapshot((current) => {
        const branch = current.branches[detail.branchId];
        if (!branch) return current;
        const nextMessages = { ...current.messages };
        const nextMessageIds = [...branch.messageIds];
        for (const message of detail.messages) {
          nextMessages[message.id] = {
            ...message,
            branchId: detail.branchId,
          };
          if (!nextMessageIds.includes(message.id)) nextMessageIds.push(message.id);
        }
        return {
          ...current,
          branches: {
            ...current.branches,
            [branch.id]: { ...branch, messageIds: nextMessageIds },
          },
          messages: nextMessages,
        };
      });
      setMessagesByBranch((current) => {
        const existing = new Map(
          (current[detail.branchId] ?? []).map((message) => [message.id, message]),
        );
        for (const message of detail.messages) {
          existing.set(message.id, {
            ...message,
            renderedHtml:
              message.renderedHtml?.trim() ||
              `<p>${escapeMessageHtml(message.content)}</p>`,
            hasBranchHighlight: false,
            branchAnchors: [],
          });
        }
        return { ...current, [detail.branchId]: [...existing.values()] };
      });
    };
    window.addEventListener(PERSISTED_MESSAGES_EVENT, handlePersistedMessages);
    return () =>
      window.removeEventListener(PERSISTED_MESSAGES_EVENT, handlePersistedMessages);
  }, [conversationId]);

  useEffect(() => {
    try {
      const storageKey = `connexus:bootstrap:${conversationId}`;
      const pending = window.sessionStorage.getItem(storageKey);
      if (pending?.trim()) {
        window.sessionStorage.removeItem(storageKey);
        setBootstrapMessage(pending);
      } else {
        setBootstrapMessage(null);
      }
    } catch (error) {
      console.warn("[Canvas] unable to read bootstrap message", error);
      setBootstrapMessage(null);
    }
  }, [conversationId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setDrawerOpen(true);
        return;
      }
      if (event.key !== "Escape") return;
      if (drawerOpen) {
        setDrawerOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [drawerOpen]);

  useEffect(() => {
    if (!branchDraft || isCreatingBranch) return;
    const dismissDraft = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-branch-draft-card="true"]')) return;
      console.debug("[Canvas] branch draft dismissed", { reason: "outside-pointer" });
      setBranchDraft(null);
    };
    window.addEventListener("pointerdown", dismissDraft);
    return () => window.removeEventListener("pointerdown", dismissDraft);
  }, [branchDraft, isCreatingBranch]);

  const handleSettingsChange = useCallback(
    async (
      nextModel: string,
      nextEffort: ReasoningEffort | null,
      options?: {
        preset?: ComposerPreset;
        tools?: ConversationComposerTool[];
      },
    ): Promise<boolean> => {
      const previous = { model, effort, preset, tools };
      const nextTools = normalizeTools(options?.tools ?? tools);
      const nextPreset = options?.preset ?? preset;
      const normalizedEffort = supportsReasoningEffortModel(nextModel)
        ? (nextEffort ?? "medium")
        : null;
      setModel(nextModel);
      setEffort(normalizedEffort);
      setPreset(nextPreset);
      setTools(nextTools);
      setIsSavingSettings(true);
      setSettingsError(null);
      try {
        await updateConversationSettings({
          conversationId,
          model: nextModel,
          reasoningEffort: normalizedEffort,
          preset: nextPreset,
          tools: nextTools,
        });
        return true;
      } catch (error) {
        console.error("[Canvas] update settings failed", error);
        setModel(previous.model);
        setEffort(previous.effort);
        setPreset(previous.preset);
        setTools(previous.tools);
        setSettingsError("Unable to save settings. Try again.");
        return false;
      } finally {
        setIsSavingSettings(false);
      }
    },
    [conversationId, effort, model, preset, tools],
  );

  const patchCanvas = useCallback(
    (patch: ConversationCanvasPatch) => {
      setCanvasError(null);
      setCanvasSnapshot((current) => ({
        ...current,
        canvas: applyCanvasPatch(current, patch),
      }));
      startPatch(async () => {
        try {
          await updateConversationCanvas({
            conversationId,
            viewport: patch.viewport ?? undefined,
            focusedBranchId:
              patch.focusedBranchId === undefined
                ? undefined
                : patch.focusedBranchId,
            nodes: patch.nodes,
          });
        } catch (error) {
          console.error("[Canvas] persist failed", error);
          setCanvasError("Canvas layout could not be saved.");
        }
      });
    },
    [conversationId],
  );

  const openBranch = useCallback(
    (branchId: BranchId) => {
      if (messagesByBranch[branchId]) {
        patchCanvas({
          focusedBranchId: branchId,
          nodes: { [branchId]: { expanded: true } },
        });
        return;
      }
      setCanvasError(null);
      setCanvasSnapshot((current) => ({
        ...current,
        canvas: applyCanvasPatch(current, {
          focusedBranchId: branchId,
          nodes: { [branchId]: { expanded: true } },
        }),
      }));
      setLoadingBranchIds((current) => new Set(current).add(branchId));
      startPatch(async () => {
        try {
          const result = await openCanvasBranchCard({ conversationId, branchId });
          setCanvasSnapshot(result.snapshot);
          setMessagesByBranch((current) => ({
            ...current,
            [branchId]: result.messages,
          }));
        } catch (error) {
          console.error("[Canvas] open card failed", error);
          setCanvasError("This chat card could not be opened.");
          setCanvasSnapshot((current) => ({
            ...current,
            canvas: applyCanvasPatch(current, {
              nodes: { [branchId]: { expanded: false } },
            }),
          }));
        } finally {
          setLoadingBranchIds((current) => {
            const next = new Set(current);
            next.delete(branchId);
            return next;
          });
        }
      });
    },
    [conversationId, messagesByBranch, patchCanvas],
  );

  const collapseBranch = useCallback(
    (branchId: BranchId) => {
      patchCanvas({ nodes: { [branchId]: { expanded: false } } });
    },
    [patchCanvas],
  );

  useEffect(() => {
    if (autoOpenedBranchRef.current === initialActiveBranchId) return;
    autoOpenedBranchRef.current = initialActiveBranchId;
    if (canvasSnapshot.canvas.nodes[initialActiveBranchId]?.expanded) return;
    openBranch(initialActiveBranchId);
  }, [canvasSnapshot.canvas.nodes, initialActiveBranchId, openBranch]);

  const startBranchDraft = useCallback((draft: BranchSelectionDraft) => {
    setCanvasError(null);
    console.debug("[Canvas] branch draft opened", {
      parentBranchId: draft.parentBranchId,
      messageId: draft.messageId,
      characterCount: draft.characterCount,
    });
    setBranchDraft(draft);
  }, []);

  const submitBranchDraft = useCallback(
    async (prompt: string) => {
      if (!branchDraft || isCreatingBranch || !prompt.trim()) return;
      setCanvasError(null);
      setIsCreatingBranch(true);
      try {
        const response = await sendMessage({
          conversationId,
          content: prompt.trim(),
          branchDraft: {
            parentBranchId: branchDraft.parentBranchId,
            messageId: branchDraft.messageId,
            span: branchDraft.span,
            excerpt: branchDraft.excerpt,
          },
        });
        const createdBranch = response.createdBranch;
        if (!createdBranch) throw new Error("Branch was not created");

        const refreshedParent = await loadCanvasBranchCard({
          conversationId,
          branchId: branchDraft.parentBranchId,
        });
        const childMessages: RenderedMessage[] = response.appendedMessages.map(
          (message) => ({
            ...message,
            renderedHtml:
              message.role === "assistant" && response.assistantRenderedHtml
                ? response.assistantRenderedHtml
                : `<p>${escapeMessageHtml(message.content)}</p>`,
            hasBranchHighlight: false,
            branchAnchors: [],
          }),
        );
        setCanvasSnapshot(refreshedParent.snapshot);
        setMessagesByBranch((current) => ({
          ...current,
          [branchDraft.parentBranchId]: refreshedParent.messages,
          [createdBranch.id]: childMessages,
        }));
        setBranchDraft(null);
      } catch (error) {
        console.error("[Canvas] create branch failed", error);
        setCanvasError("This branch could not be created. Your draft is still here.");
      } finally {
        setIsCreatingBranch(false);
      }
    },
    [branchDraft, conversationId, isCreatingBranch],
  );

  const removeBranch = useCallback(
    (branchId: BranchId) => {
      const branch = canvasSnapshot.branches[branchId];
      if (!branch?.parentId || isDeleting) return;
      const descendants = Object.values(canvasSnapshot.branches).filter((candidate) => {
        let current: Branch | undefined = candidate;
        while (current?.parentId) {
          if (current.parentId === branchId) return true;
          current = canvasSnapshot.branches[current.parentId];
        }
        return false;
      }).length;
      const confirmed = window.confirm(
        `Delete “${branch.title}”${descendants > 0 ? ` and ${descendants} descendant${descendants === 1 ? "" : "s"}` : ""}? This permanently removes their messages.`,
      );
      if (!confirmed) return;
      startDelete(async () => {
        try {
          const result = await deleteBranch({ conversationId, branchId });
          setCanvasSnapshot(result.snapshot);
          setMessagesByBranch((current) => {
            const next = { ...current };
            for (const cachedBranchId of Object.keys(next)) {
              if (!result.snapshot.branches[cachedBranchId]) delete next[cachedBranchId];
            }
            return next;
          });
          openBranch(result.parentBranchId);
        } catch (error) {
          console.error("[Canvas] delete branch failed", error);
          window.alert("Unable to delete this branch. Please try again.");
        }
      });
    },
    [canvasSnapshot.branches, conversationId, isDeleting, openBranch],
  );

  const createNewCanvas = useCallback(() => {
    if (isCreating) return;
    startCreate(async () => {
      try {
        const result = await createConversation();
        navigate(canvasHref(result.conversationId));
      } catch (error) {
        console.error("[Canvas] create conversation failed", error);
        setCanvasError("Unable to start a new canvas.");
      }
    });
  }, [isCreating]);

  const renameCanvasBranch = useCallback(
    (branchId: BranchId) => {
      const branch = canvasSnapshot.branches[branchId];
      if (!branch) return;
      const title = window.prompt("Rename this chat card", branch.title)?.trim();
      if (!title || title === branch.title) return;
      startPatch(async () => {
        try {
          const result = await renameBranch({ conversationId, branchId, title });
          setCanvasSnapshot(result.snapshot);
          if (branchId === result.snapshot.conversation.rootBranchId) {
            setDirectoryEntries((current) =>
              current.map((entry) =>
                entry.id === conversationId ? { ...entry, title } : entry,
              ),
            );
          }
        } catch (error) {
          console.error("[Canvas] rename branch failed", error);
          setCanvasError("This card could not be renamed.");
        }
      });
    },
    [canvasSnapshot.branches, conversationId],
  );

  const toggleConversationArchive = useCallback(
    (entry: ConversationDirectoryEntry) => {
      startPatch(async () => {
        try {
          const result = entry.archivedAt
            ? await unarchiveConversation({ conversationId: entry.id })
            : await archiveConversation({ conversationId: entry.id });
          setDirectoryEntries((current) =>
            current.map((candidate) =>
              candidate.id === entry.id ? result.entry : candidate,
            ),
          );
        } catch (error) {
          console.error("[Canvas] archive conversation failed", error);
          setCanvasError("This canvas could not be updated.");
        }
      });
    },
    [],
  );

  const removeConversation = useCallback(
    (entry: ConversationDirectoryEntry) => {
      if (!window.confirm(`Delete “${entry.title}”? This cannot be undone.`)) return;
      startDelete(async () => {
        try {
          await deleteConversation({ conversationId: entry.id });
          setDirectoryEntries((current) =>
            current.filter((candidate) => candidate.id !== entry.id),
          );
          if (entry.id === conversationId) navigate("/");
        } catch (error) {
          console.error("[Canvas] delete conversation failed", error);
          setCanvasError("This canvas could not be deleted.");
        }
      });
    },
    [conversationId],
  );

  const visibleConversations = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return directoryEntries;
    return directoryEntries.filter((entry) =>
      entry.title.toLowerCase().includes(normalized),
    );
  }, [directoryEntries, query]);

  const branchColumnCommon = {
    conversationId,
    conversationModel: model,
    reasoningEffort: effort,
    composerPreset: preset,
    composerTools: tools,
    openRouterModels,
    onConversationSettingsChange: handleSettingsChange,
    conversationSettingsSaving: isSavingSettings,
    conversationSettingsError: settingsError,
    onClearConversationSettingsError: () => setSettingsError(null),
  };

  const renderBranchThread = useCallback(
    (branch: Branch, active: boolean) => (
      <BranchColumn
        {...branchColumnCommon}
        branch={branch}
        messages={messagesByBranch[branch.id] ?? []}
        isActive={active}
        className="h-full min-h-0"
        composerBootstrapMessage={active ? bootstrapMessage : null}
        onComposerBootstrapConsumed={() => setBootstrapMessage(null)}
        onOpenBranch={(branchId) => openBranch(branchId)}
        onStartBranchDraft={startBranchDraft}
      />
    ),
    [
      bootstrapMessage,
      branchColumnCommon,
      messagesByBranch,
      openBranch,
      startBranchDraft,
    ],
  );

  return (
    <ToastProvider>
      <main className="app-shell relative flex h-screen min-h-screen w-full flex-col overflow-hidden bg-background text-foreground">
        <header className="relative z-40 flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="inline-flex min-w-0 items-center gap-2 rounded border border-border bg-background px-3 py-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-expanded={drawerOpen}
            >
              <LayoutDashboard className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="max-w-[46vw] truncate text-sm font-semibold sm:max-w-[28rem]">
                {canvasSnapshot.branches[canvasSnapshot.conversation.rootBranchId]?.title ||
                  "Untitled canvas"}
              </span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            </button>
            <span className="hidden text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:inline">
              {Object.keys(canvasSnapshot.branches).length} branches
            </span>
          </div>
          <div className="flex items-center gap-2">
            {isPatching ? (
              <span className="hidden text-[10px] text-muted-foreground sm:inline">Saving layout…</span>
            ) : null}
            <ThemeToggle />
            <button
              type="button"
              onClick={createNewCanvas}
              disabled={isCreating}
              className="inline-flex items-center gap-1.5 rounded border border-foreground bg-foreground px-3 py-2 text-xs font-semibold text-background hover:opacity-85 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">New canvas</span>
            </button>
          </div>
        </header>

        <section className="relative min-h-0 flex-1">
          <ConversationCanvas
            key={conversationId}
            snapshot={canvasSnapshot}
            activeBranchId={initialActiveBranchId}
            renderBranchThread={renderBranchThread}
            isBranchLoading={(branchId) => loadingBranchIds.has(branchId)}
            onOpenBranch={openBranch}
            onCollapseBranch={collapseBranch}
            onPatchCanvas={patchCanvas}
            onDeleteBranch={removeBranch}
            onRenameBranch={renameCanvasBranch}
            branchDraft={branchDraft}
            isCreatingBranch={isCreatingBranch}
            onCancelBranchDraft={() => setBranchDraft(null)}
            onSubmitBranchDraft={submitBranchDraft}
          />
        </section>

        {canvasError ? (
          <div className="absolute bottom-4 left-1/2 z-50 -translate-x-1/2 rounded border border-destructive/40 bg-background px-3 py-2 text-xs text-destructive">
            {canvasError}
          </div>
        ) : null}

        {drawerOpen ? (
          <div className="absolute inset-0 z-50 flex">
            <button
              type="button"
              className="absolute inset-0 bg-foreground/20"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close canvas drawer"
            />
            <aside className="relative z-10 flex h-full w-[min(92vw,360px)] flex-col border-r border-border bg-background">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div>
                  <div className="text-sm font-semibold">All canvases</div>
                  <div className="text-[11px] text-muted-foreground">
                    One canvas per root chat
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="rounded border border-border p-1.5 hover:bg-muted"
                  aria-label="Close canvas drawer"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <label className="mx-3 mt-3 flex items-center gap-2 rounded border border-border bg-background px-3 py-2">
                <Search className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                <span className="sr-only">Search canvases</span>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search canvases…"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
                <Command className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              </label>
              <nav className="min-h-0 flex-1 overflow-y-auto p-3" aria-label="Conversation canvases">
                <div className="space-y-1.5">
                  {visibleConversations.map((entry) => (
                    <div
                      key={entry.id}
                      className={cn(
                        "flex items-center justify-between gap-3 rounded border px-3 py-2.5",
                        entry.id === conversationId
                          ? "border-foreground bg-muted"
                          : "border-transparent hover:border-border hover:bg-muted/60",
                        entry.archivedAt ? "opacity-65" : "",
                      )}
                    >
                      <a href={canvasHref(entry.id)} className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{entry.title}</span>
                        <span className="block text-[10px] text-muted-foreground">
                          {entry.branchCount} branches{entry.archivedAt ? " · archived" : ""}
                        </span>
                      </a>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => toggleConversationArchive(entry)}
                          className="rounded border border-border p-1.5 text-muted-foreground hover:bg-background hover:text-foreground"
                          aria-label={`${entry.archivedAt ? "Unarchive" : "Archive"} ${entry.title}`}
                        >
                          {entry.archivedAt ? (
                            <ArchiveRestore className="h-3.5 w-3.5" aria-hidden="true" />
                          ) : (
                            <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => removeConversation(entry)}
                          disabled={isDeleting}
                          className="rounded border border-destructive/30 p-1.5 text-destructive hover:bg-destructive hover:text-destructive-foreground disabled:opacity-50"
                          aria-label={`Delete ${entry.title}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </nav>
              <div className="border-t border-border p-3">
                <button
                  type="button"
                  onClick={createNewCanvas}
                  className="flex w-full items-center justify-center gap-2 rounded border border-foreground bg-foreground px-3 py-2.5 text-sm font-semibold text-background"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  New canvas
                </button>
              </div>
            </aside>
          </div>
        ) : null}
      </main>
    </ToastProvider>
  );
}
