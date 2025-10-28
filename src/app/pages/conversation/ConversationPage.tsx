import {
  DEFAULT_CONVERSATION_ID,
  buildBranchTree,
  ensureConversationSnapshot,
  getBranchMessages,
} from "@/app/shared/conversation.server";
import { ConversationSidebar } from "@/app/pages/conversation/ConversationSidebar";
import { BranchColumn } from "@/app/components/conversation/BranchColumn";
import type { AppRequestInfo } from "@/worker";
import type { Branch, ConversationGraphSnapshot } from "@/lib/conversation";

interface ConversationPageProps extends AppRequestInfo {
  conversationId?: string;
}

export async function ConversationPage({
  ctx,
  request,
  conversationId = DEFAULT_CONVERSATION_ID,
}: ConversationPageProps) {
  const result = await ensureConversationSnapshot(ctx, conversationId);
  const requestUrl = new URL(request.url);
  const requestedBranchId = requestUrl.searchParams.get("branchId");
  const snapshot = result.snapshot;

  const activeBranch = determineActiveBranch(snapshot, requestedBranchId);
  const parentBranch = activeBranch.parentId
    ? snapshot.branches[activeBranch.parentId] ?? null
    : null;

  const activeMessages = getBranchMessages(snapshot, activeBranch.id);
  const parentMessages = parentBranch
    ? getBranchMessages(snapshot, parentBranch.id)
    : [];

  const tree = buildBranchTree(snapshot);
  const sidebarCollapsed =
    requestUrl.searchParams.get("sidebar") === "collapsed";
  const parentCollapsed = parentBranch
    ? requestUrl.searchParams.get("parent") === "collapsed"
    : false;

  const toggleSidebarHref = buildToggleHref(
    requestUrl,
    "sidebar",
    sidebarCollapsed ? null : "collapsed",
  );

  const toggleParentHref = parentBranch
    ? buildToggleHref(
        requestUrl,
        "parent",
        parentCollapsed ? null : "collapsed",
      )
    : null;

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      {!sidebarCollapsed ? (
        <ConversationSidebar
          conversation={snapshot.conversation}
          tree={tree}
          activeBranchId={activeBranch.id}
        />
      ) : null}

      <div className="flex flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-3">
          <a
            href={toggleSidebarHref}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1 text-xs font-medium text-foreground shadow-sm transition hover:bg-muted"
          >
            {sidebarCollapsed ? "Show Sidebar" : "Hide Sidebar"}
          </a>

          {parentBranch && toggleParentHref ? (
            <a
              href={toggleParentHref}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1 text-xs font-medium text-foreground shadow-sm transition hover:bg-muted"
            >
              {parentCollapsed ? "Show Parent Branch" : "Hide Parent Branch"}
            </a>
          ) : null}
        </div>

        <div className="flex flex-1">
          {parentBranch && !parentCollapsed ? (
            <BranchColumn
              key={parentBranch.id}
              branch={parentBranch}
              messages={parentMessages}
              conversationId={result.conversationId}
              isActive={false}
              highlight={
                activeBranch.createdFrom?.messageId
                  ? {
                      messageId: activeBranch.createdFrom.messageId,
                      span: activeBranch.createdFrom.span ?? null,
                    }
                  : undefined
              }
            />
          ) : null}

          <BranchColumn
            key={activeBranch.id}
            branch={activeBranch}
            messages={activeMessages}
            conversationId={result.conversationId}
            isActive
            className={
              parentBranch && !parentCollapsed ? undefined : "basis-full"
            }
          />
        </div>
      </div>
    </div>
  );
}

function determineActiveBranch(
  snapshot: ConversationGraphSnapshot,
  branchIdParam: string | null,
): Branch {
  const fallbackBranch =
    (branchIdParam ? snapshot.branches[branchIdParam] : undefined) ??
    snapshot.branches[snapshot.conversation.rootBranchId];

  if (!branchIdParam || !snapshot.branches[branchIdParam]) {
    return fallbackBranch;
  }

  const branch = snapshot.branches[branchIdParam];
  return branch ?? fallbackBranch;
}

function buildToggleHref(
  url: URL,
  key: string,
  value: string | null,
): string {
  const next = new URL(url.toString());
  if (value === null) {
    next.searchParams.delete(key);
  } else {
    next.searchParams.set(key, value);
  }

  const search = next.searchParams.toString();
  return `${next.pathname}${search ? `?${search}` : ""}`;
}
