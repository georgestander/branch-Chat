import {
  branchToneForBranch,
  type BranchId,
  type ConversationGraphSnapshot,
  type Message,
} from "@branchy/conversation-core";
import type { ActiveConversationStream } from "../../shared/contracts.ts";
import type {
  RenderedBranchAnchor,
  RenderedMessage,
} from "@branchy/conversation-core/presentation";

function anchorsByMessage(
  snapshot: ConversationGraphSnapshot,
): Map<string, RenderedBranchAnchor[]> {
  const result = new Map<string, RenderedBranchAnchor[]>();
  for (const branch of Object.values(snapshot.branches)) {
    if (!branch.parentId) {
      continue;
    }
    const messageId = branch.createdFrom.messageId;
    const anchors = result.get(messageId) ?? [];
    const tone = branchToneForBranch(snapshot, branch.id);
    anchors.push({
      branchId: branch.id,
      title: branch.title,
      excerpt: branch.createdFrom.excerpt ?? null,
      range: branch.createdFrom.span ?? null,
      ...(tone ? { tone: tone.key } : {}),
    });
    result.set(messageId, anchors);
  }
  for (const anchors of result.values()) {
    anchors.sort((left, right) => left.branchId.localeCompare(right.branchId));
  }
  return result;
}

export function renderMessage(
  message: Message,
  anchors: readonly RenderedBranchAnchor[] = [],
): RenderedMessage {
  return {
    ...message,
    renderedHtml: "",
    hasBranchHighlight: anchors.length > 0,
    branchAnchors: anchors.map((anchor) => ({ ...anchor })),
  };
}

export function renderMessagesByBranch(
  snapshot: ConversationGraphSnapshot,
  options: {
    activeStreams?: readonly ActiveConversationStream[];
  } = {},
): Record<BranchId, RenderedMessage[]> {
  const anchors = anchorsByMessage(snapshot);
  const suppressedAssistantMessageIds = new Set(
    (options.activeStreams ?? [])
      .map((stream) => snapshot.messages[stream.assistantMessageId])
      .filter(
        (message): message is Message =>
          Boolean(
            message &&
              message.role === "assistant" &&
              message.content.trim().length === 0,
          ),
      )
      .map((message) => message.id),
  );
  return Object.fromEntries(
    Object.values(snapshot.branches).map((branch) => [
      branch.id,
      branch.messageIds
        .map((messageId) => snapshot.messages[messageId])
        .filter((message): message is Message => Boolean(message))
        .filter((message) => !suppressedAssistantMessageIds.has(message.id))
        .map((message) => renderMessage(message, anchors.get(message.id))),
    ]),
  ) as Record<BranchId, RenderedMessage[]>;
}

export function renderBranchMessages(
  snapshot: ConversationGraphSnapshot,
  branchId: BranchId,
): RenderedMessage[] {
  return renderMessagesByBranch(snapshot)[branchId] ?? [];
}
