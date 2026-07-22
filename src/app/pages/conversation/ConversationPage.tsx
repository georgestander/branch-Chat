import {
  ensureConversationSnapshot,
  getBranchMessages,
  resolveConversationId,
} from "@/app/shared/conversation.server";
import { enrichMessagesWithHtml } from "@/app/shared/markdown.server";
import type { MessageBranchHighlight } from "@/app/shared/markdown.server";
import { CanvasConversationLayout } from "@/app/components/conversation/CanvasConversationLayout";
import type { AppRequestInfo } from "@/worker";
import type { Branch, ConversationGraphSnapshot, Message } from "@/lib/conversation";
import { branchToneForBranch } from "@/lib/conversation/branchTone";
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
  conversationId,
}: ConversationPageProps) {
  const requestUrl = new URL(request.url);
  const requestedConversationIdParam =
    requestUrl.searchParams.get("conversationId") ?? conversationId ?? null;
  const requestedConversationId = requestedConversationIdParam
    ? resolveConversationId(ctx, requestedConversationIdParam)
    : null;
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
            ? requestedConversationIdParam
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
  const expandedBranchIds = new Set(
    Object.values(snapshot.canvas.nodes)
      .filter((node) => node.expanded)
      .map((node) => node.branchId),
  );
  expandedBranchIds.add(activeBranch.id);
  const renderedEntries = await Promise.all(
    [...expandedBranchIds].map(async (branchId) => {
      const messages = getBranchMessages(snapshot, branchId);
      return [
        branchId,
        await enrichMessagesWithHtmlForBranch(messages, {
          isActiveBranch: branchId === activeBranch.id,
          highlights: getBranchHighlights(snapshot, branchId),
        }),
      ] as const;
    }),
  );

  return (
    <CanvasConversationLayout
      key={result.conversationId}
      snapshot={snapshot}
      conversation={snapshot.conversation}
      initialActiveBranchId={activeBranch.id}
      initialMessagesByBranch={Object.fromEntries(renderedEntries)}
      conversationId={result.conversationId}
      conversations={summaries}
      openRouterModels={[]}
    />
  );
}

async function enrichMessagesWithHtmlForBranch(
  messages: Message[],
  options: {
    isActiveBranch: boolean;
    highlights?: MessageBranchHighlight[];
  },
) {
  const streamingAssistant = options.isActiveBranch
    ? determineStreamingAssistantMessageId(messages)
    : null;

  return enrichMessagesWithHtml(messages, {
    highlights: options.highlights ?? [],
    streamingMessageId: streamingAssistant,
  });
}

function getBranchHighlights(
  snapshot: ConversationGraphSnapshot,
  sourceBranchId: string,
): MessageBranchHighlight[] {
  return Object.values(snapshot.branches)
    .filter(
      (branch) =>
        branch.parentId === sourceBranchId &&
        typeof branch.createdFrom?.messageId === "string",
    )
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .map((branch) => {
      const tone = branchToneForBranch(snapshot, branch.id);
      return {
        branchId: branch.id,
        messageId: branch.createdFrom.messageId,
        title: branch.title?.trim() || "Child branch",
        excerpt: branch.createdFrom.excerpt?.trim() || null,
        range: branch.createdFrom.span ?? null,
        ...(tone ? { tone: tone.key } : {}),
      };
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
