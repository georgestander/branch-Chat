import type {
  Branch,
  ConversationGraphSnapshot,
  Message,
  MessageId,
} from "./model.ts";
import type { BranchToneKey } from "./branchTone.ts";

export interface RenderedBranchAnchor {
  branchId: string;
  marker: number;
  title: string;
  excerpt: string | null;
  range: { start: number; end: number } | null;
  tone?: BranchToneKey;
}

export interface RenderedMessage extends Message {
  renderedHtml: string;
  hasBranchHighlight: boolean;
  branchAnchors: RenderedBranchAnchor[];
}

export function branchSourceMarkers(
  snapshot: Pick<ConversationGraphSnapshot, "branches">,
): Map<string, number> {
  const branchesByMessage = new Map<MessageId, Branch[]>();
  for (const branch of Object.values(snapshot.branches)) {
    if (!branch.parentId) continue;
    const siblings = branchesByMessage.get(branch.createdFrom.messageId) ?? [];
    siblings.push(branch);
    branchesByMessage.set(branch.createdFrom.messageId, siblings);
  }

  const markers = new Map<string, number>();
  for (const branches of branchesByMessage.values()) {
    branches
      .sort((left, right) => {
        const leftSpan = left.createdFrom.span;
        const rightSpan = right.createdFrom.span;
        const leftStart = leftSpan?.start ?? Number.MAX_SAFE_INTEGER;
        const rightStart = rightSpan?.start ?? Number.MAX_SAFE_INTEGER;
        const leftEnd = leftSpan?.end ?? Number.MAX_SAFE_INTEGER;
        const rightEnd = rightSpan?.end ?? Number.MAX_SAFE_INTEGER;
        return (
          leftStart - rightStart ||
          leftEnd - rightEnd ||
          left.createdAt.localeCompare(right.createdAt) ||
          left.id.localeCompare(right.id)
        );
      })
      .forEach((branch, index) => markers.set(branch.id, index + 1));
  }
  return markers;
}

export function hasSameCanonicalRenderedMessageState(
  left: RenderedMessage,
  right: RenderedMessage,
): boolean {
  return (
    left.role === right.role &&
    left.content === right.content &&
    JSON.stringify(left.tokenUsage ?? null) ===
      JSON.stringify(right.tokenUsage ?? null) &&
    JSON.stringify(left.toolInvocations ?? null) ===
      JSON.stringify(right.toolInvocations ?? null) &&
    JSON.stringify(left.attachments ?? null) ===
      JSON.stringify(right.attachments ?? null)
  );
}
