import {
  DEFAULT_CONVERSATION_ID,
  buildBranchTree,
  ensureConversationSnapshot,
  getBranchMessages,
} from "@/app/shared/conversation.server";
import { ConversationLayout } from "@/app/components/conversation/ConversationLayout";
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
