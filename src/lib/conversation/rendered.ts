import type { Message } from "./model";
import type { BranchToneKey } from "./branchTone";

export interface RenderedBranchAnchor {
  branchId: string;
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
