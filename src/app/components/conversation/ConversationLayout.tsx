"use client";

import { useEffect, useRef, useState, useCallback, type CSSProperties } from "react";

import { ConversationSidebar } from "@/app/pages/conversation/ConversationSidebar";
import type { BranchTreeNode } from "@/app/shared/conversation.server";
import type {
  Branch,
  Conversation,
  ConversationModelId,
} from "@/lib/conversation";
import type { RenderedMessage } from "@/lib/conversation/rendered";
import type { ConversationDirectoryEntry } from "@/lib/durable-objects/ConversationDirectory";
import { cn } from "@/lib/utils";
import { GitBranch, PanelLeftOpen } from "lucide-react";

import { BranchColumn } from "./BranchColumn";
import { ToastProvider } from "@/app/components/ui/Toast";
import { updateConversationSettings } from "@/app/pages/conversation/functions";

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
  activeBranchId: string;
  conversations: ConversationDirectoryEntry[];
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
  initialParentCollapsed = false,
  activeBranchId,
  conversations,
}: ConversationLayoutProps) {
  const resolvedInitialModel =
    conversation.settings.model || "gpt-5-chat-latest";
  const resolvedInitialEffort = resolvedInitialModel.includes("chat")
    ? null
    : ((conversation.settings as any).reasoningEffort ?? "low");
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
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  // Resizable split: store current and last-known parent width ratios
  const [parentWidthRatio, setParentWidthRatio] = useState(0.5);
  const lastParentWidthRatioRef = useRef<number>(0.5);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartRatioRef = useRef(0.5);
  const containerLeftRef = useRef(0);
  const containerWidthRef = useRef(0);
  const hasLoggedFirstDragRef = useRef(false);
  const showParentColumn = Boolean(parentBranch) && !isParentCollapsed;
  const toggleButtonClass =
    "inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-foreground shadow-sm transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

  useEffect(() => {
    if (initialSidebarCollapsed) {
      setIsSidebarCollapsed(true);
    }
    if (initialParentCollapsed) {
      setIsParentCollapsed(true);
    }

    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (url.searchParams.has("focus")) {
        url.searchParams.delete("focus");
        window.history.replaceState(null, "", url.toString());
      }
    }
  }, [activeBranchId, initialParentCollapsed, initialSidebarCollapsed]);

  useEffect(() => {
    const nextModel = conversation.settings.model || "gpt-5-chat-latest";
    const nextEffort = nextModel.includes("chat")
      ? null
      : ((conversation.settings as any).reasoningEffort ?? "low");
    setSettingsModel(nextModel);
    setSettingsEffort(nextEffort);
  }, [conversation.settings, conversationId]);

  const handleConversationSettingsChange = useCallback(
    async (
      nextModel: string,
      nextEffort: "low" | "medium" | "high" | null,
    ): Promise<boolean> => {
      setIsSavingSettings(true);
      setSettingsError(null);
      const previousModel = settingsModel;
      const previousEffort = settingsEffort;
      setSettingsModel(nextModel);
      setSettingsEffort(nextEffort);
      try {
        await updateConversationSettings({
          conversationId,
          model: nextModel,
          reasoningEffort: nextModel.includes("chat") ? null : nextEffort,
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
        return false;
      } finally {
        setIsSavingSettings(false);
      }
    },
    [conversationId, settingsEffort, settingsModel],
  );

  const clearConversationSettingsError = useCallback(() => {
    setSettingsError(null);
  }, []);

  // When collapsing/expanding the parent column, snapshot/restore the ratio
  useEffect(() => {
    if (!showParentColumn) {
      // Snapshot the current ratio for future restore
      lastParentWidthRatioRef.current = parentWidthRatio;
    } else {
      // Restore the last ratio when becoming visible
      setParentWidthRatio((r) => r ?? lastParentWidthRatioRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showParentColumn]);

  const clampRatioWithinBounds = useCallback((ratio: number) => {
    const container = containerRef.current;
    if (!container) return Math.min(0.75, Math.max(0.25, ratio));
    const width = container.clientWidth;
    const parentMin = 280; // px
    const childMin = 360; // px
    const minRatio = Math.max(parentMin / Math.max(width, 1), 0);
    const maxRatio = Math.min(1 - childMin / Math.max(width, 1), 1);
    // Ensure sensible defaults when extremely small widths
    const boundedMin = Math.min(minRatio, 0.75);
    const boundedMax = Math.max(maxRatio, 0.25);
    return Math.min(boundedMax, Math.max(boundedMin, ratio));
  }, []);

  const handlePointerMove = useCallback((ev: PointerEvent) => {
    if (!isDraggingRef.current) return;
    const left = containerLeftRef.current;
    const width = containerWidthRef.current;
    if (width <= 0) return;
    const relativeX = ev.clientX - left;
    const rawRatio = relativeX / width;
    const nextRatio = clampRatioWithinBounds(rawRatio);
    setParentWidthRatio(nextRatio);
  }, [clampRatioWithinBounds]);

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
    <div className="relative flex h-screen min-h-screen w-full overflow-hidden bg-background text-foreground">
      <div
        className={cn(
          "relative flex h-full flex-shrink-0 overflow-hidden transition-[width] duration-300",
          isSidebarCollapsed ? "w-0 border-r-0" : "w-72 border-r border-border",
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

      {isSidebarCollapsed ? (
        <button
          type="button"
          onClick={() => setIsSidebarCollapsed(false)}
          className="absolute left-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-foreground shadow-sm transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          aria-pressed={false}
          aria-expanded={false}
          title="Show conversation sidebar"
        >
          <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">Show conversation sidebar</span>
        </button>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col">
        <div ref={containerRef} className="flex min-h-0 flex-1 overflow-hidden">
          {showParentColumn && parentBranch ? (
            <BranchColumn
              key={parentBranch.id}
              branch={parentBranch}
              messages={parentMessages}
              conversationId={conversationId}
              isActive={false}
              className="min-h-0 w-full shrink-0 bg-background"
              conversationModel={settingsModel}
              reasoningEffort={settingsEffort}
              onConversationSettingsChange={handleConversationSettingsChange}
              conversationSettingsSaving={isSavingSettings}
              conversationSettingsError={settingsError}
              onClearConversationSettingsError={clearConversationSettingsError}
              // Apply a fixed flex-basis driven by ratio
              // Keep a reasonable maxWidth via inline style for determinism
              style={{
                flexBasis: `${Math.round(parentWidthRatio * 1000) / 10}%`,
                minWidth: 280,
                maxWidth: "75%",
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
                  <GitBranch className="h-4 w-4" aria-hidden="true" />
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
              className="relative z-10 -mx-0.5 w-1 cursor-col-resize select-none border-l border-border bg-border/60 focus:outline-none focus:ring-2 focus:ring-ring"
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
            className={cn(
              "min-h-0 flex-1",
              showParentColumn ? "" : "basis-full border-l-0",
            )}
            conversationModel={settingsModel}
            reasoningEffort={settingsEffort}
            onConversationSettingsChange={handleConversationSettingsChange}
            conversationSettingsSaving={isSavingSettings}
            conversationSettingsError={settingsError}
            onClearConversationSettingsError={clearConversationSettingsError}
            style={
              showParentColumn
                ? ({
                    // Let it grow to take remaining space, but enforce a min width
                    minWidth: 360,
                    flexBasis: `calc(100% - ${Math.round(parentWidthRatio * 1000) / 10}%)`,
                  } as CSSProperties)
                : undefined
            }
            withLeftBorder={showParentColumn}
            leadingActions={
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
                  className={toggleButtonClass}
                  aria-pressed={false}
                  aria-expanded={false}
                  title="Show parent thread"
                >
                  <GitBranch className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">
                    Show parent branch column
                  </span>
                </button>
              ) : null
            }
          />
        </div>
      </div>
    </div>
    </ToastProvider>
  );
}
