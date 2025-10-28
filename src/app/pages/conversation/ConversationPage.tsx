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

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      <ConversationSidebar
        conversation={snapshot.conversation}
        tree={tree}
        activeBranchId={activeBranch.id}
      />

      <div className="flex flex-1 flex-col">
        <div className="flex flex-1">
          {parentBranch ? (
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
