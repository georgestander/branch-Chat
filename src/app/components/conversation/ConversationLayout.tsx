"use client";

import { useEffect, useState } from "react";

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
import {
  PanelLeftClose,
  PanelLeftOpen,
  SquareSplitVertical,
} from "lucide-react";

import { BranchColumn } from "./BranchColumn";

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
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(
    initialSidebarCollapsed,
  );
  const [isParentCollapsed, setIsParentCollapsed] = useState(
    initialParentCollapsed,
  );
  const showParentColumn = Boolean(parentBranch) && !isParentCollapsed;

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

  const toggleButtonClass =
    "inline-flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-foreground shadow-sm transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

  return (
    <div className="flex h-screen min-h-screen w-full overflow-hidden bg-background text-foreground">
      <div
        className={cn(
          "relative flex h-full flex-shrink-0 overflow-hidden transition-[width] duration-300",
          isSidebarCollapsed
            ? "w-0 border-r-0"
            : "w-72 border-r border-border",
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
            className="w-72"
            conversationId={conversationId}
            conversations={conversations}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-border/60 bg-background/95 px-4 py-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsSidebarCollapsed((value) => !value)}
              className={toggleButtonClass}
              aria-pressed={!isSidebarCollapsed}
              aria-expanded={!isSidebarCollapsed}
            >
              {isSidebarCollapsed ? (
                <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
              ) : (
                <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
              )}
              <span className="hidden sm:inline">Sidebar</span>
              <span className="sr-only">Toggle conversation sidebar</span>
            </button>

            {parentBranch ? (
              <button
                type="button"
                onClick={() => setIsParentCollapsed((value) => !value)}
                className={toggleButtonClass}
                aria-pressed={showParentColumn}
                aria-expanded={showParentColumn}
              >
                <SquareSplitVertical className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Parent Thread</span>
                <span className="sr-only">Toggle parent branch column</span>
              </button>
            ) : null}
          </div>

          {parentBranch ? (
            <span className="text-xs text-muted-foreground">
              {showParentColumn
                ? `Parent: ${parentBranch.title || "Untitled Branch"}`
                : "Parent hidden"}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              {conversation.settings.model}
            </span>
          )}
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          {showParentColumn && parentBranch ? (
            <BranchColumn
              key={parentBranch.id}
              branch={parentBranch}
              messages={parentMessages}
              conversationId={conversationId}
              isActive={false}
              className="min-h-0 w-full max-w-xl shrink-0 basis-[32%] bg-background"
            />
          ) : null}

          <BranchColumn
            key={activeBranch.id}
            branch={activeBranch}
            messages={activeMessages}
            conversationId={conversationId}
            isActive
            className={cn(
              "min-h-0 flex-1",
              showParentColumn ? "md:basis-[68%]" : "basis-full border-l-0",
            )}
            withLeftBorder={showParentColumn}
          />
        </div>
      </div>
    </div>
  );
}
