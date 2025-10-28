"use client";

import { useEffect, useState } from "react";
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";

import { ConversationSidebar } from "@/app/pages/conversation/ConversationSidebar";
import type { BranchTreeNode } from "@/app/shared/conversation.server";
import { BranchColumn } from "@/app/components/conversation/BranchColumn";
import type {
  Branch,
  BranchSpan,
  Conversation,
  ConversationModelId,
  Message,
} from "@/lib/conversation";

interface ConversationLayoutProps {
  conversation: Conversation;
  tree: BranchTreeNode;
  activeBranch: Branch;
  parentBranch: Branch | null;
  activeMessages: Message[];
  parentMessages: Message[];
  parentHighlight?: {
    messageId: string;
    span?: BranchSpan | null;
  };
  conversationId: ConversationModelId;
}

export function ConversationLayout({
  conversation,
  tree,
  activeBranch,
  parentBranch,
  activeMessages,
  parentMessages,
  parentHighlight,
  conversationId,
}: ConversationLayoutProps) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isParentCollapsed, setIsParentCollapsed] = useState(() =>
    parentBranch ? true : false,
  );

  useEffect(() => {
    if (parentBranch) {
      setIsParentCollapsed(true);
    } else {
      setIsParentCollapsed(false);
    }
  }, [parentBranch?.id]);

  const toggleSidebar = () => {
    setIsSidebarCollapsed((value) => !value);
  };

  const toggleParent = () => {
    setIsParentCollapsed((value) => !value);
  };

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      {!isSidebarCollapsed ? (
        <ConversationSidebar
          conversation={conversation}
          tree={tree}
          activeBranchId={activeBranch.id}
          onCollapse={() => setIsSidebarCollapsed(true)}
        />
      ) : null}

      <div className="flex flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-border bg-background/80 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={toggleSidebar}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground transition hover:bg-muted/80 hover:text-foreground"
              aria-pressed={!isSidebarCollapsed}
            >
              {isSidebarCollapsed ? (
                <PanelLeftOpen className="h-4 w-4" aria-hidden />
              ) : (
                <PanelLeftClose className="h-4 w-4" aria-hidden />
              )}
              <span>
                {isSidebarCollapsed ? "Show Sidebar" : "Hide Sidebar"}
              </span>
            </button>

            {parentBranch ? (
              <button
                type="button"
                onClick={toggleParent}
                className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground transition hover:bg-muted/80 hover:text-foreground"
                aria-pressed={!isParentCollapsed}
              >
                {isParentCollapsed ? (
                  <PanelRightOpen className="h-4 w-4" aria-hidden />
                ) : (
                  <PanelRightClose className="h-4 w-4" aria-hidden />
                )}
                <span>
                  {isParentCollapsed ? "Show Parent" : "Hide Parent"}
                </span>
              </button>
            ) : null}
          </div>
        </div>

        <div className="flex flex-1">
          {parentBranch && !isParentCollapsed ? (
            <BranchColumn
              key={parentBranch.id}
              branch={parentBranch}
              messages={parentMessages}
              conversationId={conversationId}
              isActive={false}
              highlight={parentHighlight}
              headerActions={
                <button
                  type="button"
                  onClick={toggleParent}
                  className="inline-flex items-center gap-1 rounded-md border border-border/80 bg-background px-2 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground transition hover:bg-muted/80 hover:text-foreground"
                >
                  <PanelRightClose className="h-3.5 w-3.5" aria-hidden />
                  Hide
                </button>
              }
            />
          ) : null}

          <BranchColumn
            key={activeBranch.id}
            branch={activeBranch}
            messages={activeMessages}
            conversationId={conversationId}
            isActive
          />
        </div>
      </div>
    </div>
  );
}
