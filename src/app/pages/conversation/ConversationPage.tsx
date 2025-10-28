import {
  DEFAULT_CONVERSATION_ID,
  buildBranchTree,
  ensureConversationSnapshot,
  getBranchMessages,
} from "@/app/shared/conversation.server";
import { ConversationLayout } from "@/app/components/conversation/ConversationLayout";
import type { AppRequestInfo } from "@/worker";
import type { Branch, ConversationGraphSnapshot } from "@/lib/conversation";
import {
  listConversationDirectoryEntries,
  touchConversationDirectoryEntry,
} from "@/app/shared/conversationDirectory.server";
import type { ConversationDirectoryEntry } from "@/lib/durable-objects/ConversationDirectory";

interface ConversationPageProps extends AppRequestInfo {
  conversationId?: string;
}

export async function ConversationPage({
  ctx,
  request,
  conversationId = DEFAULT_CONVERSATION_ID,
}: ConversationPageProps) {
  const requestUrl = new URL(request.url);
  const requestedConversationId =
    requestUrl.searchParams.get("conversationId") ?? conversationId;
  const result = await ensureConversationSnapshot(ctx, requestedConversationId);
  const requestedBranchId = requestUrl.searchParams.get("branchId");
  const snapshot = result.snapshot;

  const nowIso = new Date().toISOString();
  const branchCount = Object.keys(snapshot.branches).length;
  const rootBranch = snapshot.branches[snapshot.conversation.rootBranchId];
  await touchConversationDirectoryEntry(ctx, {
    id: result.conversationId,
    branchCount,
    title: rootBranch?.title ?? result.conversationId,
    lastActiveAt: nowIso,
  });

  const directoryEntries = await listConversationDirectoryEntries(ctx);
  const summaries = mergeDirectoryEntries(directoryEntries, {
    id: result.conversationId,
    title: rootBranch?.title ?? result.conversationId,
    branchCount,
    lastActiveAt: nowIso,
    createdAt: snapshot.conversation.createdAt,
  });

  const activeBranch = determineActiveBranch(snapshot, requestedBranchId);
  const parentBranch = activeBranch.parentId
    ? snapshot.branches[activeBranch.parentId] ?? null
    : null;

  const activeMessages = getBranchMessages(snapshot, activeBranch.id);
  const parentMessages = parentBranch
    ? getBranchMessages(snapshot, parentBranch.id)
    : [];

  const tree = buildBranchTree(snapshot);
  const shouldAutoCollapse = requestUrl.searchParams.get("focus") === "child";

  return (
    <ConversationLayout
      conversation={snapshot.conversation}
      tree={tree}
      activeBranch={activeBranch}
      activeMessages={activeMessages}
      parentBranch={parentBranch}
      parentMessages={parentMessages}
      conversationId={result.conversationId}
      initialSidebarCollapsed={shouldAutoCollapse}
      initialParentCollapsed={shouldAutoCollapse}
      activeBranchId={activeBranch.id}
      conversations={summaries}
    />
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

function mergeDirectoryEntries(
  entries: ConversationDirectoryEntry[],
  active: ConversationDirectoryEntry,
): ConversationDirectoryEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry] as const));
  byId.set(active.id, {
    ...active,
    title: active.title.trim() ? active.title : "Untitled Conversation",
  });

  return [...byId.values()].sort((a, b) =>
    b.lastActiveAt.localeCompare(a.lastActiveAt) || a.id.localeCompare(b.id),
  );
}
