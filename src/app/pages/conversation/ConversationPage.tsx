import {
  DEFAULT_CONVERSATION_ID,
  buildBranchTree,
  ensureConversationSnapshot,
  getBranchMessages,
} from "@/app/shared/conversation.server";
import { enrichMessagesWithHtml } from "@/app/shared/markdown.server";
import { ConversationLayout } from "@/app/components/conversation/ConversationLayout";
import type { AppRequestInfo } from "@/worker";
import type { Branch, ConversationGraphSnapshot, Message } from "@/lib/conversation";
import {
  listConversationDirectoryEntries,
  touchConversationDirectoryEntry,
} from "@/app/shared/conversationDirectory.server";
import type { ConversationDirectoryEntry } from "@/lib/durable-objects/ConversationDirectory";
import { ConversationEmptyLayout } from "@/app/components/conversation/ConversationEmptyLayout";

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
  const requestedBranchId = requestUrl.searchParams.get("branchId");

  const directoryEntries = await listConversationDirectoryEntries(ctx);

  const directoryById = new Map(directoryEntries.map((entry) => [entry.id, entry] as const));
  let targetConversationId: string | null = null;

  if (requestedConversationId && directoryById.has(requestedConversationId)) {
    targetConversationId = requestedConversationId;
  } else if (!requestedConversationId && directoryEntries.length > 0) {
    targetConversationId = directoryEntries[0]!.id;
  }

  if (!targetConversationId) {
    return (
      <ConversationEmptyLayout
        conversations={directoryEntries}
        missingConversationId={
          requestedConversationId && !directoryById.has(requestedConversationId)
            ? requestedConversationId
            : null
        }
      />
    );
  }

  const result = await ensureConversationSnapshot(ctx, targetConversationId);
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

  const summaries = mergeDirectoryEntries(directoryEntries, {
    id: result.conversationId,
    title: rootBranch?.title ?? result.conversationId,
    branchCount,
    lastActiveAt: nowIso,
    archivedAt: null,
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

  const activeRenderedMessages = await enrichMessagesWithHtmlForBranch(
    activeMessages,
    {
      isActiveBranch: true,
    },
  );

  const parentHighlight = activeBranch.createdFrom?.messageId
    ? {
        messageId: activeBranch.createdFrom.messageId,
        range: activeBranch.createdFrom.span ?? null,
        branchId: activeBranch.id,
      }
    : null;

  const parentRenderedMessages = await enrichMessagesWithHtmlForBranch(
    parentMessages,
    {
      isActiveBranch: false,
      highlight: parentHighlight,
    },
  );

  const tree = buildBranchTree(snapshot);
  const shouldAutoCollapse = requestUrl.searchParams.get("focus") === "child";

  return (
    <ConversationLayout
      conversation={snapshot.conversation}
      tree={tree}
      activeBranch={activeBranch}
      activeMessages={activeRenderedMessages}
      parentBranch={parentBranch}
      parentMessages={parentRenderedMessages}
      conversationId={result.conversationId}
      initialSidebarCollapsed={shouldAutoCollapse}
      initialParentCollapsed={shouldAutoCollapse}
      activeBranchId={activeBranch.id}
      conversations={summaries}
    />
  );
}

async function enrichMessagesWithHtmlForBranch(
  messages: Message[],
  options: {
    isActiveBranch: boolean;
    highlight?: { messageId: string; range: { start: number; end: number } | null } | null;
  },
) {
  const streamingAssistant = options.isActiveBranch
    ? determineStreamingAssistantMessageId(messages)
    : null;

  return enrichMessagesWithHtml(messages, {
    highlight: options.highlight ?? null,
    streamingMessageId: streamingAssistant,
  });
}

function determineStreamingAssistantMessageId(messages: Message[]) {
  if (messages.length === 0) return null;
  const last = messages[messages.length - 1];
  if (last.role === "assistant" && !last.tokenUsage) {
    return last.id;
  }
  return null;
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
    archivedAt: active.archivedAt ?? null,
  });

  return [...byId.values()].sort((a, b) =>
    b.lastActiveAt.localeCompare(a.lastActiveAt) || a.id.localeCompare(b.id),
  );
}
