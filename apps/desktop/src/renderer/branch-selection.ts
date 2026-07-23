import type { Message } from "@branchy/conversation-core";

import { trimSelectionRange } from "./markdown.ts";
import type { BranchSelectionDraft } from "./types.ts";

type BranchSelectionInput = {
  branchId: string;
  messageId: string;
  role: Message["role"];
  selectedText: string;
  sourceSpan: { start: number; end: number };
};

export function createBranchSelectionDraft({
  branchId,
  messageId,
  role,
  selectedText,
  sourceSpan,
}: BranchSelectionInput): BranchSelectionDraft | null {
  if (role !== "assistant") {
    return null;
  }
  const selection = trimSelectionRange(selectedText, sourceSpan);
  if (!selection) {
    return null;
  }
  return {
    parentBranchId: branchId,
    messageId,
    excerpt: selection.excerpt,
    span: selection.span,
  };
}
