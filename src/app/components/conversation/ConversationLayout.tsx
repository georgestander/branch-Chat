"use client";

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  useTransition,
  type CSSProperties,
} from "react";

import { ConversationSidebar } from "@/app/pages/conversation/ConversationSidebar";
import type { BranchTreeNode } from "@/app/shared/conversation.server";
import type {
  Branch,
  ComposerPreset,
  Conversation,
  ConversationModelId,
} from "@/lib/conversation";
import type { ConversationComposerTool } from "@/lib/conversation/tools";
import type { RenderedMessage } from "@/lib/conversation/rendered";
import type { ConversationDirectoryEntry } from "@/lib/durable-objects/ConversationDirectory";
import { cn } from "@/lib/utils";
import {
  Columns2,
  FileSearch,
  PanelLeftOpen,
  PanelRightClose,
  SquarePen,
} from "lucide-react";
import { navigate } from "rwsdk/client";
import type { OpenRouterModelOption } from "@/lib/openrouter/models";
import { supportsReasoningEffortModel } from "@/lib/openai/models";

import { BranchColumn } from "./BranchColumn";
import { ToastProvider } from "@/app/components/ui/Toast";
import { ParentContextSheet } from "@/app/components/conversation/ParentContextSheet";
import {
  createConversation,
  updateConversationSettings,
} from "@/app/pages/conversation/functions";

interface ConversationLayoutProps {
  conversation: Conversation;
  tree: BranchTreeNode;
  activeBranch: Branch;
  activeMessages: RenderedMessage[];
  parentBranch: Branch | null;
  parentMessages: RenderedMessage[];
  conversationId: ConversationModelId;
  initialSidebarCollapsed?: boolean;
  initialParentCollapsed?: boolean;
  compareModeRequested?: boolean;
  activeBranchId: string;
  conversations: ConversationDirectoryEntry[];
  openRouterModels: OpenRouterModelOption[];
}

const PARENT_MIN_WIDTH_PX = 280;
const ACTIVE_MIN_WIDTH_PX = 680;
const MAX_PARENT_RATIO = 0.48;
const RESIZER_WIDTH_PX = 6;
const ALLOWED_COMPOSER_TOOLS = new Set<ConversationComposerTool>([
  "study-and-learn",
  "web-search",
  "file-upload",
]);

type ConversationReasoningEffort = "low" | "medium" | "high" | null;

const START_MODE_DEFAULTS: Record<
  Exclude<ComposerPreset, "custom">,
  {
    model: string;
    reasoningEffort: ConversationReasoningEffort;
    tools: ConversationComposerTool[];
  }
> = {
  fast: {
    model: "gpt-5-chat-latest",
    reasoningEffort: null,
    tools: [],
  },
  reasoning: {
    model: "gpt-5-mini",
    reasoningEffort: "medium",
    tools: [],
  },
  study: {
    model: "gpt-5-mini",
    reasoningEffort: "medium",
    tools: ["study-and-learn"],
  },
};

function sanitizeComposerTools(value: unknown): ConversationComposerTool[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const tools: ConversationComposerTool[] = [];
  for (const item of value) {
    if (
      typeof item === "string" &&
      ALLOWED_COMPOSER_TOOLS.has(item as ConversationComposerTool) &&
      !tools.includes(item as ConversationComposerTool)
    ) {
      tools.push(item as ConversationComposerTool);
    }
  }
  return tools;
}

function isSameToolSelection(
  left: ConversationComposerTool[],
  right: ConversationComposerTool[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function inferPresetFromSelections(options: {
  model: string;
  reasoningEffort: ConversationReasoningEffort;
  tools: ConversationComposerTool[];
}): ComposerPreset {
  const normalizedTools = sanitizeComposerTools(options.tools);
  const normalizedEffort = supportsReasoningEffortModel(options.model)
    ? (options.reasoningEffort ?? "low")
    : null;

  const fastDefaults = START_MODE_DEFAULTS.fast;
  if (
    options.model === fastDefaults.model &&
    normalizedEffort === fastDefaults.reasoningEffort &&
    isSameToolSelection(normalizedTools, fastDefaults.tools)
  ) {
    return "fast";
  }

  const reasoningDefaults = START_MODE_DEFAULTS.reasoning;
  if (
    options.model === reasoningDefaults.model &&
    normalizedEffort === reasoningDefaults.reasoningEffort &&
    isSameToolSelection(normalizedTools, reasoningDefaults.tools)
  ) {
    return "reasoning";
  }

  const studyDefaults = START_MODE_DEFAULTS.study;
  if (
    options.model === studyDefaults.model &&
    normalizedEffort === studyDefaults.reasoningEffort &&
    isSameToolSelection(normalizedTools, studyDefaults.tools)
  ) {
    return "study";
  }

  return "custom";
}

function resolvePresetFromConversation(options: {
  model: string;
  reasoningEffort: ConversationReasoningEffort;
  tools: ConversationComposerTool[];
  preset: unknown;
}): ComposerPreset {
  const fallbackPreset = inferPresetFromSelections({
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    tools: options.tools,
  });
  if (
    options.preset === "fast" ||
    options.preset === "reasoning" ||
    options.preset === "study" ||
    options.preset === "custom"
  ) {
    return options.preset;
  }
  return fallbackPreset;
}

export function ConversationLayout({
  conversation,
  tree,
  activeBranch,
  activeMessages,
  parentBranch,
  parentMessages,
  conversationId,
  initialSidebarCollapsed = false,
  initialParentCollapsed = true,
  compareModeRequested = false,
  activeBranchId,
  conversations,
  openRouterModels,
}: ConversationLayoutProps) {
  const resolvedInitialModel =
    conversation.settings.model || "gpt-5-chat-latest";
  const resolvedInitialEffort = supportsReasoningEffortModel(resolvedInitialModel)
    ? ((conversation.settings as any).reasoningEffort ?? "low")
    : null;
  const resolvedInitialTools = sanitizeComposerTools(
    conversation.settings.composerDefaults?.tools ?? [],
  );
  const resolvedInitialPreset = resolvePresetFromConversation({
    model: resolvedInitialModel,
    reasoningEffort: resolvedInitialEffort,
    tools: resolvedInitialTools,
    preset: conversation.settings.composerDefaults?.preset,
  });
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(
    initialSidebarCollapsed,
  );
  const [isParentCollapsed, setIsParentCollapsed] = useState(
    initialParentCollapsed,
  );
  const [settingsModel, setSettingsModel] = useState(resolvedInitialModel);
  const [settingsEffort, setSettingsEffort] = useState<"low" | "medium" | "high" | null>(
    resolvedInitialEffort,
  );
  const [settingsPreset, setSettingsPreset] =
    useState<ComposerPreset>(resolvedInitialPreset);
  const [settingsTools, setSettingsTools] =
    useState<ConversationComposerTool[]>(resolvedInitialTools);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  // Resizable split: store current and last-known parent width ratios
  const [parentWidthRatio, setParentWidthRatio] = useState(0.34);
  const lastParentWidthRatioRef = useRef<number>(0.34);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartRatioRef = useRef(0.5);
  const containerLeftRef = useRef(0);
  const containerWidthRef = useRef(0);
  const hasLoggedFirstDragRef = useRef(false);
  const showParentColumn = Boolean(parentBranch) && !isParentCollapsed;
  const parentOriginMessageId = activeBranch.createdFrom?.messageId ?? null;
  const getActiveMinWidth = useCallback((width: number) => {
    if (width <= 0) {
      return ACTIVE_MIN_WIDTH_PX;
    }
    return Math.min(ACTIVE_MIN_WIDTH_PX, width);
  }, []);
  const resizerWidth = showParentColumn ? RESIZER_WIDTH_PX : 0;
  const usableWidth = Math.max(0, containerWidth - resizerWidth);
  const effectiveActiveMinWidth = getActiveMinWidth(usableWidth);
  const hasMeasuredWidth = usableWidth > 0;
  const toggleButtonClass =
    "inline-flex h-8 w-8 items-center justify-center rounded-md border border-foreground/20 bg-background/70 text-foreground shadow-sm backdrop-blur transition hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
  const effectiveParentMinWidth =
    usableWidth > 0
      ? Math.min(
          PARENT_MIN_WIDTH_PX,
          Math.max(0, usableWidth - effectiveActiveMinWidth),
        )
      : PARENT_MIN_WIDTH_PX;
  const [creationError, setCreationError] = useState<string | null>(null);
  const [isCreatingConversation, startCreateConversation] = useTransition();
  const [bootstrapMessage, setBootstrapMessage] = useState<string | null>(null);
  const [isParentContextSheetOpen, setIsParentContextSheetOpen] =
    useState(false);

  useEffect(() => {
    setIsSidebarCollapsed(initialSidebarCollapsed);
    setIsParentCollapsed(initialParentCollapsed);

    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (url.searchParams.has("focus")) {
        url.searchParams.delete("focus");
        window.history.replaceState(null, "", url.toString());
      }
    }
  }, [conversationId, initialParentCollapsed, initialSidebarCollapsed]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const storageKey = `connexus:bootstrap:${conversationId}`;
      const pending = window.sessionStorage.getItem(storageKey);
      if (pending && pending.trim().length > 0) {
        window.sessionStorage.removeItem(storageKey);
        setBootstrapMessage(pending);
      } else {
        setBootstrapMessage(null);
      }
    } catch (storageError) {
      console.warn(
        "[ConversationLayout] unable to read bootstrap message",
        storageError,
      );
      setBootstrapMessage(null);
    }
  }, [conversationId]);

  useEffect(() => {
    if (parentBranch && isParentCollapsed) {
      return;
    }
    if (!parentBranch) {
      setIsParentContextSheetOpen(false);
    }
  }, [isParentCollapsed, parentBranch]);

  useEffect(() => {
    if (!compareModeRequested || !parentBranch) {
      return;
    }
    setIsParentCollapsed(false);
  }, [activeBranchId, compareModeRequested, parentBranch]);

  useEffect(() => {
    const nextModel = conversation.settings.model || "gpt-5-chat-latest";
    const nextEffort = supportsReasoningEffortModel(nextModel)
      ? ((conversation.settings as any).reasoningEffort ?? "low")
      : null;
    const nextTools = sanitizeComposerTools(
      conversation.settings.composerDefaults?.tools ?? [],
    );
    const nextPreset = resolvePresetFromConversation({
      model: nextModel,
      reasoningEffort: nextEffort,
      tools: nextTools,
      preset: conversation.settings.composerDefaults?.preset,
    });
    setSettingsModel(nextModel);
    setSettingsEffort(nextEffort);
    setSettingsPreset(nextPreset);
    setSettingsTools(nextTools);
  }, [conversation.settings, conversationId]);

  const handleConversationSettingsChange = useCallback(
    async (
      nextModel: string,
      nextEffort: "low" | "medium" | "high" | null,
      options?: {
        preset?: ComposerPreset;
        tools?: ConversationComposerTool[];
      },
    ): Promise<boolean> => {
      setIsSavingSettings(true);
      setSettingsError(null);
      const previousModel = settingsModel;
      const previousEffort = settingsEffort;
      const previousPreset = settingsPreset;
      const previousTools = settingsTools;
      const normalizedEffort = supportsReasoningEffortModel(nextModel)
        ? (nextEffort ?? "low")
        : null;
      const normalizedTools = sanitizeComposerTools(options?.tools ?? settingsTools);
      const normalizedPreset = resolvePresetFromConversation({
        model: nextModel,
        reasoningEffort: normalizedEffort,
        tools: normalizedTools,
        preset: options?.preset,
      });
      setSettingsModel(nextModel);
      setSettingsEffort(normalizedEffort);
      setSettingsPreset(normalizedPreset);
      setSettingsTools(normalizedTools);
      try {
        await updateConversationSettings({
          conversationId,
          model: nextModel,
          reasoningEffort: normalizedEffort,
          preset: normalizedPreset,
          tools: normalizedTools,
        });
        return true;
      } catch (error) {
        console.error(
          "[ConversationLayout] updateConversationSettings failed",
          error,
        );
        setSettingsError("Unable to save settings. Try again.");
        setSettingsModel(previousModel);
        setSettingsEffort(previousEffort);
        setSettingsPreset(previousPreset);
        setSettingsTools(previousTools);
        return false;
      } finally {
        setIsSavingSettings(false);
      }
    },
    [conversationId, settingsEffort, settingsModel, settingsPreset, settingsTools],
  );

  const clearConversationSettingsError = useCallback(() => {
    setSettingsError(null);
  }, []);

  const handleBootstrapConsumed = useCallback(() => {
    setBootstrapMessage(null);
  }, []);

  const startNewConversation = useCallback(() => {
    if (isCreatingConversation) {
      return;
    }
    setCreationError(null);
    startCreateConversation(async () => {
      try {
        const result = await createConversation();
        navigate(
          `/app?conversationId=${encodeURIComponent(result.conversationId)}`,
        );
      } catch (error) {
        console.error(
          "[ConversationLayout] createConversation failed",
          error,
        );
        setCreationError("Unable to start a new chat. Please try again.");
      }
    });
  }, [isCreatingConversation]);

  const clampRatioWithinBounds = useCallback(
    (ratio: number, widthOverride?: number) => {
      const container = containerRef.current;
      const width = widthOverride ?? container?.clientWidth ?? 0;
      const safeWidth = Math.max(width, 1);
      const activeMinWidth = getActiveMinWidth(safeWidth);
      const parentMinWidth = Math.min(
        PARENT_MIN_WIDTH_PX,
        Math.max(0, safeWidth - activeMinWidth),
      );
      const parentMinRatio = parentMinWidth / safeWidth;
      const maxRatioFromActiveMin = Math.max(
        0,
        (safeWidth - activeMinWidth) / safeWidth,
      );
      const maxRatio = Math.min(MAX_PARENT_RATIO, maxRatioFromActiveMin);
      const minRatio = Math.min(parentMinRatio, maxRatio);
      return Math.min(maxRatio, Math.max(minRatio, ratio));
    },
    [getActiveMinWidth],
  );

  const { parentWidthPx, activeWidthPx } = useMemo(() => {
    if (!hasMeasuredWidth) {
      return { parentWidthPx: 0, activeWidthPx: 0 };
    }
    const clampedParentRatio = clampRatioWithinBounds(parentWidthRatio, usableWidth);
    const parentWidthPx = Math.round(clampedParentRatio * usableWidth);
    const activeWidthPx = Math.max(0, usableWidth - parentWidthPx);
    return { parentWidthPx, activeWidthPx };
  }, [clampRatioWithinBounds, hasMeasuredWidth, parentWidthRatio, usableWidth]);

  // When collapsing/expanding the parent column, snapshot/restore the ratio
  useEffect(() => {
    if (!showParentColumn) {
      // Snapshot the current ratio for future restore
      lastParentWidthRatioRef.current = parentWidthRatio;
    } else {
      // Restore the last ratio when becoming visible
      setParentWidthRatio(
        clampRatioWithinBounds(lastParentWidthRatioRef.current, usableWidth),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clampRatioWithinBounds, showParentColumn, usableWidth]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      const width = entry?.contentRect.width ?? container.clientWidth;
      setContainerWidth(width);
      const usable = Math.max(0, width - (showParentColumn ? RESIZER_WIDTH_PX : 0));
      setParentWidthRatio((current) => clampRatioWithinBounds(current, usable));
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
    };
  }, [clampRatioWithinBounds, showParentColumn]);

  const handlePointerMove = useCallback((ev: PointerEvent) => {
    if (!isDraggingRef.current) return;
    const left = containerLeftRef.current;
    const width = Math.max(
      1,
      containerWidthRef.current - (showParentColumn ? RESIZER_WIDTH_PX : 0),
    );
    if (width <= 0) return;
    const relativeX = ev.clientX - left;
    const rawRatio = relativeX / width;
    const nextRatio = clampRatioWithinBounds(rawRatio, width);
    setParentWidthRatio(nextRatio);
  }, [clampRatioWithinBounds, showParentColumn]);

  const endDrag = useCallback(() => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    window.removeEventListener("pointermove", handlePointerMove as any);
    window.removeEventListener("pointerup", endDrag as any);
    window.removeEventListener("pointercancel", endDrag as any);
    window.removeEventListener("pointerleave", endDrag as any);
    window.removeEventListener("blur", endDrag as any);

    if (!hasLoggedFirstDragRef.current) {
      hasLoggedFirstDragRef.current = true;
      try {
        const container = containerRef.current;
        const width = container?.clientWidth ?? 0;
        const parentWidth = Math.round(parentWidthRatio * width);
        // Observability trace (first drag only per mount)
        console.debug(
          `[TRACE] resize.complete parentWidth=${parentWidth} containerWidth=${width} ratio=${parentWidthRatio.toFixed(
            3,
          )}`,
        );
      } catch {
        // no-op
      }
    }
  }, [handlePointerMove, parentWidthRatio]);

  const onSeparatorPointerDown = useCallback(
    (ev: React.PointerEvent<HTMLDivElement>) => {
      if (!showParentColumn) return;
      const container = containerRef.current;
      if (!container) return;
      ev.currentTarget.setPointerCapture?.(ev.pointerId);
      isDraggingRef.current = true;
      // Snapshot container rect for absolute calculations
      const rect = container.getBoundingClientRect();
      containerLeftRef.current = rect.left;
      containerWidthRef.current = rect.width;
      dragStartXRef.current = ev.clientX;
      dragStartRatioRef.current = parentWidthRatio;
      window.addEventListener("pointermove", handlePointerMove as any, {
        passive: true,
      });
      window.addEventListener("pointerup", endDrag as any);
      window.addEventListener("pointercancel", endDrag as any);
      window.addEventListener("pointerleave", endDrag as any);
      window.addEventListener("blur", endDrag as any);
    },
    [endDrag, handlePointerMove, parentWidthRatio, showParentColumn],
  );

  // Keyboard fallback for the separator
  const onSeparatorKeyDown = useCallback(
    (ev: React.KeyboardEvent<HTMLDivElement>) => {
      if (!showParentColumn) return;
      const step = 0.02; // ~2 percentage points
      if (ev.key === "ArrowLeft") {
        ev.preventDefault();
        setParentWidthRatio((r) => clampRatioWithinBounds(r - step));
      } else if (ev.key === "ArrowRight") {
        ev.preventDefault();
        setParentWidthRatio((r) => clampRatioWithinBounds(r + step));
      }
    },
    [clampRatioWithinBounds, showParentColumn],
  );

  return (
    <ToastProvider>
    <div className="app-shell relative flex h-screen min-h-screen w-full overflow-hidden text-foreground">
      {creationError ? (
        <p className="sr-only" role="status" aria-live="polite">
          {creationError}
        </p>
      ) : null}
      {isSidebarCollapsed ? (
        <div className="pointer-events-none absolute left-3 top-3 z-30 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setIsSidebarCollapsed(false)}
            className={cn(toggleButtonClass, "pointer-events-auto h-9 w-9")}
            aria-pressed={false}
            aria-expanded={false}
            title="Show conversation sidebar"
          >
            <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Show conversation sidebar</span>
          </button>
          <button
            type="button"
            onClick={startNewConversation}
            disabled={isCreatingConversation}
            className={cn(
              toggleButtonClass,
              "pointer-events-auto h-9 w-9",
              isCreatingConversation ? "cursor-not-allowed opacity-70" : "",
            )}
            aria-label={
              isCreatingConversation
                ? "Creating new chat"
                : "Start a new chat"
            }
            title="Start a new chat"
          >
            <SquarePen className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Start a new chat</span>
          </button>
        </div>
      ) : null}
      <div
        className={cn(
          "relative flex h-full flex-shrink-0 overflow-hidden transition-[width] duration-300",
          isSidebarCollapsed ? "w-0 border-r-0" : "w-[280px] border-r border-border",
        )}
        aria-hidden={isSidebarCollapsed}
      >
        <div
          className={cn(
            "h-full transition-opacity duration-200",
            isSidebarCollapsed ? "pointer-events-none opacity-0" : "opacity-100",
          )}
        >
          <ConversationSidebar
            conversation={conversation}
            tree={tree}
            activeBranchId={activeBranch.id}
            conversationId={conversationId}
            conversations={conversations}
            isSidebarCollapsed={isSidebarCollapsed}
            onToggleSidebar={() =>
              setIsSidebarCollapsed((value) => !value)
            }
          />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <div
          ref={containerRef}
          className="flex min-h-0 flex-1 overflow-hidden"
        >
          {showParentColumn && parentBranch ? (
            <BranchColumn
              key={parentBranch.id}
              branch={parentBranch}
              messages={parentMessages}
              conversationId={conversationId}
              isActive={false}
              className="min-h-0 bg-background"
              conversationModel={settingsModel}
              reasoningEffort={settingsEffort}
              composerPreset={settingsPreset}
              composerTools={settingsTools}
              openRouterModels={openRouterModels}
              onConversationSettingsChange={handleConversationSettingsChange}
              conversationSettingsSaving={isSavingSettings}
              conversationSettingsError={settingsError}
              onClearConversationSettingsError={clearConversationSettingsError}
              highlightedBranchId={activeBranch.id}
              // Apply a fixed flex-basis driven by ratio
              style={{
                width: hasMeasuredWidth ? parentWidthPx : undefined,
                minWidth: effectiveParentMinWidth,
                flex: hasMeasuredWidth ? "0 0 auto" : undefined,
              } as CSSProperties}
              leadingActions={
                <button
                  type="button"
                  onClick={() => setIsParentCollapsed(true)}
                  className={toggleButtonClass}
                  aria-pressed={true}
                  aria-expanded={true}
                  title="Hide parent thread"
                >
                  <PanelRightClose className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">Hide parent branch column</span>
                </button>
              }
            />
          ) : null}

          {showParentColumn ? (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(parentWidthRatio * 100)}
              tabIndex={0}
              title="Resize panels"
              onPointerDown={onSeparatorPointerDown}
              onKeyDown={onSeparatorKeyDown}
              className="pane-resizer z-10 -mx-0.5 focus:outline-none focus:ring-2 focus:ring-ring"
              style={{
                // Visually hide if collapsed (but this element isn't rendered when collapsed already)
                // Use deterministic styles only
                touchAction: "none",
              } as CSSProperties}
            >
              <span className="sr-only">Resize split view</span>
            </div>
          ) : null}

          <BranchColumn
            key={activeBranch.id}
            branch={activeBranch}
            messages={activeMessages}
            conversationId={conversationId}
            isActive
            parentBranchTitle={parentBranch?.title ?? null}
            composerBootstrapMessage={bootstrapMessage}
            onComposerBootstrapConsumed={handleBootstrapConsumed}
            className={cn(
              "min-h-0 flex-1 min-w-0",
              showParentColumn ? "" : "basis-full border-l-0",
            )}
            conversationModel={settingsModel}
            reasoningEffort={settingsEffort}
            composerPreset={settingsPreset}
            composerTools={settingsTools}
            openRouterModels={openRouterModels}
            onConversationSettingsChange={handleConversationSettingsChange}
            conversationSettingsSaving={isSavingSettings}
            conversationSettingsError={settingsError}
            onClearConversationSettingsError={clearConversationSettingsError}
            style={
              showParentColumn
                ? ({
                    // Ensure active always fits viewport; parent yields space.
                    width: hasMeasuredWidth ? activeWidthPx : undefined,
                    minWidth: 0,
                    maxWidth: "100%",
                    flex: hasMeasuredWidth ? "0 0 auto" : undefined,
                  } as CSSProperties)
                : undefined
            }
            withLeftBorder={showParentColumn}
            leadingActions={(() => {
              const parentToggleControl =
                parentBranch && isParentCollapsed ? (
                  <button
                    type="button"
                    onClick={() => {
                      setIsParentCollapsed(false);
                      // Restore previous width ratio when uncollapsing
                      setParentWidthRatio(
                        lastParentWidthRatioRef.current ?? 0.35,
                      );
                    }}
                    className={cn(toggleButtonClass, "h-9 w-9")}
                    aria-pressed={false}
                    aria-expanded={false}
                    title="Open compare mode"
                  >
                    <Columns2 className="h-4 w-4" aria-hidden="true" />
                    <span className="sr-only">
                      Open parent comparison mode
                    </span>
                  </button>
                ) : null;
              const parentContextControl = parentBranch ? (
                <button
                  type="button"
                  onClick={() => setIsParentContextSheetOpen(true)}
                  className={cn(toggleButtonClass, "h-9 w-9")}
                  aria-pressed={isParentContextSheetOpen}
                  aria-expanded={isParentContextSheetOpen}
                  title="View parent context"
                >
                  <FileSearch className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">Open parent context panel</span>
                </button>
              ) : null;

              return (
                <>
                  {parentContextControl}
                  {parentToggleControl}
                </>
              );
            })()}
          />
        </div>
      </div>
      {parentBranch ? (
        <ParentContextSheet
          open={isParentContextSheetOpen}
          parentBranch={parentBranch}
          parentMessages={parentMessages}
          originMessageId={parentOriginMessageId}
          onClose={() => setIsParentContextSheetOpen(false)}
          onOpenCompare={() => {
            setIsParentCollapsed(false);
            setParentWidthRatio(lastParentWidthRatioRef.current ?? 0.35);
            setIsParentContextSheetOpen(false);
          }}
        />
      ) : null}
    </div>
    </ToastProvider>
  );
}
