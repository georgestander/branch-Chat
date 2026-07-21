"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import {
  ArrowLeft,
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
import { DEFAULT_CONVERSATION_MODEL } from "@/lib/conversation";
import type { ConversationComposerTool } from "@/lib/conversation/tools";
import type { RenderedMessage } from "@/lib/conversation/rendered";
import type { ConversationDirectoryEntry } from "@/lib/durable-objects/ConversationDirectory";
import type { OpenRouterModelOption } from "@/lib/openrouter/models";
import { supportsReasoningEffortModel } from "@/lib/openai/models";
import { cn } from "@/lib/utils";
import {
  createConversation,
  deleteBranch,
  updateConversationCanvas,
  updateConversationSettings,
} from "@/app/pages/conversation/functions";
import { ConversationCanvas } from "@/app/components/conversation/ConversationCanvas";
import { BranchColumn } from "@/app/components/conversation/BranchColumn";
import { ToastProvider } from "@/app/components/ui/Toast";
import { ThemeToggle } from "@/app/components/ui/ThemeToggle";

interface CanvasConversationLayoutProps {
  snapshot: ConversationGraphSnapshot;
  conversation: Conversation;
  activeBranch: Branch;
  activeMessages: RenderedMessage[];
  parentBranch: Branch | null;
  parentMessages: RenderedMessage[];
  conversationId: ConversationModelId;
  conversations: ConversationDirectoryEntry[];
  openRouterModels: OpenRouterModelOption[];
  focusRequested: boolean;
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

function canvasHref(
  conversationId: string,
  branchId?: string | null,
  focus = false,
): string {
  const params = new URLSearchParams({ conversationId });
  if (branchId) params.set("branchId", branchId);
  if (focus) params.set("focus", "1");
  if (focus && branchId) params.set("compare", "1");
  return `/app?${params.toString()}`;
}

export function CanvasConversationLayout({
  snapshot,
  conversation,
  activeBranch,
  activeMessages,
  parentBranch,
  parentMessages,
  conversationId,
  conversations,
  openRouterModels,
  focusRequested,
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
        return;
      }
      if (focusRequested) {
        navigate(canvasHref(conversationId, activeBranch.id, false));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeBranch.id, conversationId, drawerOpen, focusRequested]);

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
      navigate(canvasHref(conversationId, branchId, true));
    },
    [conversationId],
  );

  const removeBranch = useCallback(
    (branchId: BranchId) => {
      const branch = snapshot.branches[branchId];
      if (!branch?.parentId || isDeleting) return;
      const descendants = Object.values(snapshot.branches).filter((candidate) => {
        let current: Branch | undefined = candidate;
        while (current?.parentId) {
          if (current.parentId === branchId) return true;
          current = snapshot.branches[current.parentId];
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
          navigate(canvasHref(conversationId, result.parentBranchId, false));
        } catch (error) {
          console.error("[Canvas] delete branch failed", error);
          window.alert("Unable to delete this branch. Please try again.");
        }
      });
    },
    [conversationId, isDeleting, snapshot.branches],
  );

  const createNewCanvas = useCallback(() => {
    if (isCreating) return;
    startCreate(async () => {
      try {
        const result = await createConversation();
        navigate(
          canvasHref(
            result.conversationId,
            result.snapshot.conversation.rootBranchId,
            true,
          ),
        );
      } catch (error) {
        console.error("[Canvas] create conversation failed", error);
        setCanvasError("Unable to start a new canvas.");
      }
    });
  }, [isCreating]);

  const visibleConversations = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return conversations;
    return conversations.filter((entry) =>
      entry.title.toLowerCase().includes(normalized),
    );
  }, [conversations, query]);

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
                {snapshot.branches[snapshot.conversation.rootBranchId]?.title ||
                  "Untitled canvas"}
              </span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            </button>
            <span className="hidden text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:inline">
              {Object.keys(snapshot.branches).length} branches
            </span>
          </div>
          <div className="flex items-center gap-2">
            {isPatching ? (
              <span className="hidden text-[10px] text-muted-foreground sm:inline">Saving layout…</span>
            ) : null}
            <a
              href={`/app/legacy?conversationId=${encodeURIComponent(conversationId)}&branchId=${encodeURIComponent(activeBranch.id)}`}
              className="hidden rounded px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground md:inline-flex"
            >
              Legacy view
            </a>
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
            snapshot={snapshot}
            activeBranchId={activeBranch.id}
            onOpenBranch={openBranch}
            onPatchCanvas={patchCanvas}
            onDeleteBranch={removeBranch}
          />

          {focusRequested ? (
            <section
              className="absolute inset-x-3 bottom-3 top-3 z-30 flex min-h-0 overflow-hidden rounded border border-foreground/35 bg-background sm:inset-x-6 lg:inset-x-[5vw]"
              aria-label="Expanded branch conversation"
            >
              {parentBranch ? (
                <div className="grid min-h-0 w-full grid-cols-[minmax(320px,0.8fr)_minmax(520px,1.2fr)] overflow-hidden">
                  <BranchColumn
                    {...branchColumnCommon}
                    branch={parentBranch}
                    messages={parentMessages}
                    isActive={false}
                    highlightedBranchId={activeBranch.id}
                    className="nodrag nowheel nopan min-h-0 border-r border-border bg-background"
                    onActivateBranch={() =>
                      navigate(canvasHref(conversationId, parentBranch.id, true))
                    }
                  />
                  <BranchColumn
                    {...branchColumnCommon}
                    branch={activeBranch}
                    messages={activeMessages}
                    isActive
                    parentBranchTitle={parentBranch.title}
                    composerBootstrapMessage={bootstrapMessage}
                    onComposerBootstrapConsumed={() => setBootstrapMessage(null)}
                    className="nodrag nowheel nopan min-h-0 min-w-0"
                    headerActions={
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => removeBranch(activeBranch.id)}
                          disabled={isDeleting}
                          className="rounded border border-destructive/40 p-1.5 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                          aria-label="Delete active branch"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            navigate(canvasHref(conversationId, activeBranch.id, false))
                          }
                          className="rounded border border-border p-1.5 text-foreground hover:bg-muted"
                          aria-label="Collapse branch to canvas"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    }
                  />
                </div>
              ) : (
                <div className="mx-auto flex min-h-0 w-full max-w-5xl">
                  <BranchColumn
                    {...branchColumnCommon}
                    branch={activeBranch}
                    messages={activeMessages}
                    isActive
                    composerBootstrapMessage={bootstrapMessage}
                    onComposerBootstrapConsumed={() => setBootstrapMessage(null)}
                    className="nodrag nowheel nopan min-h-0 min-w-0 flex-1"
                    headerActions={
                      <button
                        type="button"
                        onClick={() =>
                          navigate(canvasHref(conversationId, activeBranch.id, false))
                        }
                        className="rounded border border-border p-1.5 text-foreground hover:bg-muted"
                        aria-label="Collapse chat to canvas"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    }
                  />
                </div>
              )}
            </section>
          ) : null}
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
                    <a
                      key={entry.id}
                      href={canvasHref(entry.id)}
                      className={cn(
                        "flex items-center justify-between gap-3 rounded border px-3 py-2.5",
                        entry.id === conversationId
                          ? "border-foreground bg-muted"
                          : "border-transparent hover:border-border hover:bg-muted/60",
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{entry.title}</span>
                        <span className="block text-[10px] text-muted-foreground">
                          {entry.branchCount} branches
                        </span>
                      </span>
                      <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </a>
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
                <a
                  href={`/app/legacy?conversationId=${encodeURIComponent(conversationId)}`}
                  className="mt-2 flex items-center justify-center gap-1.5 rounded px-3 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  Manage conversations in legacy view
                </a>
              </div>
            </aside>
          </div>
        ) : null}
      </main>
    </ToastProvider>
  );
}
