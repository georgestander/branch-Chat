import type {
  Branch,
  BranchId,
  ConversationCanvasViewport,
  ConversationGraphSnapshot,
  Message,
} from "@branchy/conversation-core";
import type { RenderedMessage } from "@branchy/conversation-core/presentation";

import type {
  BranchSelectionDraft,
  RendererStreamEvent,
  StreamState,
} from "./types.ts";

export function retainBranchRecords<T>(
  current: Record<BranchId, T>,
  branches: Pick<ConversationGraphSnapshot, "branches">["branches"],
): Record<BranchId, T> {
  return Object.fromEntries(
    Object.entries(current).filter(([branchId]) => branchId in branches),
  );
}

export function clearTransientImageUrls(
  current: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(current).filter(
      ([, url]) => url !== "__loading__" && url !== "__unavailable__",
    ),
  );
}

export function retainBranchSelectionDraft(
  draft: BranchSelectionDraft | null,
  previousConversationId: string | null,
  nextConversationId: string | null,
): BranchSelectionDraft | null {
  return previousConversationId !== null &&
    previousConversationId === nextConversationId
    ? draft
    : null;
}

export interface BranchDraftViewportSession {
  focusedBranchId: BranchId | null;
  returnViewport: ConversationCanvasViewport;
  pairedViewport: ConversationCanvasViewport;
}

export function resolveBranchDraftViewport(
  session: BranchDraftViewportSession,
  focusedBranchId: BranchId | null,
): {
  createdChildId: BranchId | null;
  viewport: ConversationCanvasViewport;
} {
  const createdChildId =
    focusedBranchId && focusedBranchId !== session.focusedBranchId
      ? focusedBranchId
      : null;
  return {
    createdChildId,
    viewport: createdChildId
      ? session.pairedViewport
      : session.returnViewport,
  };
}

export function branchChildren(
  snapshot: Pick<ConversationGraphSnapshot, "branches">,
): Map<BranchId, Branch[]> {
  const children = new Map<BranchId, Branch[]>();
  for (const branch of Object.values(snapshot.branches)) {
    if (!branch.parentId) continue;
    const siblings = children.get(branch.parentId) ?? [];
    siblings.push(branch);
    children.set(branch.parentId, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    );
  }
  return children;
}

export function visibleBranchIds(
  snapshot: ConversationGraphSnapshot,
): Set<BranchId> {
  const visible = new Set<BranchId>();
  const children = branchChildren(snapshot);
  const visit = (branchId: BranchId): void => {
    const branch = snapshot.branches[branchId];
    if (!branch || visible.has(branchId)) return;
    visible.add(branchId);
    if (snapshot.canvas.nodes[branchId]?.folded) return;
    for (const child of children.get(branchId) ?? []) visit(child.id);
  };
  visit(snapshot.conversation.rootBranchId);
  return visible;
}

export function descendantCount(
  snapshot: Pick<ConversationGraphSnapshot, "branches">,
  branchId: BranchId,
): number {
  const children = branchChildren(snapshot);
  const queue = [...(children.get(branchId) ?? [])];
  const visited = new Set<BranchId>();
  while (queue.length > 0) {
    const next = queue.shift();
    if (!next || visited.has(next.id)) continue;
    visited.add(next.id);
    queue.push(...(children.get(next.id) ?? []));
  }
  return visited.size;
}

export function isBranchDescendant(
  snapshot: Pick<ConversationGraphSnapshot, "branches">,
  ancestorBranchId: BranchId,
  candidateBranchId: BranchId,
): boolean {
  if (
    ancestorBranchId === candidateBranchId ||
    !snapshot.branches[ancestorBranchId] ||
    !snapshot.branches[candidateBranchId]
  ) {
    return false;
  }

  const visited = new Set<BranchId>();
  let current = snapshot.branches[candidateBranchId];
  while (current?.parentId && !visited.has(current.id)) {
    visited.add(current.id);
    if (current.parentId === ancestorBranchId) return true;
    current = snapshot.branches[current.parentId];
  }
  return false;
}

export type BranchConnectorEmphasis =
  | "default"
  | "muted"
  | "ancestry"
  | "immediate";

export function branchConnectorEmphasis(
  snapshot: Pick<ConversationGraphSnapshot, "branches">,
  selectedBranchId: BranchId,
  childBranchId: BranchId,
): BranchConnectorEmphasis {
  const selected = snapshot.branches[selectedBranchId];
  const child = snapshot.branches[childBranchId];
  if (!selected?.parentId || !child?.parentId) return "default";
  if (childBranchId === selectedBranchId) return "immediate";
  return isBranchDescendant(snapshot, childBranchId, selectedBranchId)
    ? "ancestry"
    : "muted";
}

/**
 * Returns the branch that must become active before a fold hides the current
 * branch. A null result means the fold/unfold can proceed without navigation.
 */
export function branchToFocusBeforeFold(
  snapshot: ConversationGraphSnapshot,
  foldingBranchId: BranchId,
  activeBranchId: BranchId,
): BranchId | null {
  if (snapshot.canvas.nodes[foldingBranchId]?.folded === true) return null;
  return isBranchDescendant(snapshot, foldingBranchId, activeBranchId)
    ? foldingBranchId
    : null;
}

export function messagesForBranch(
  snapshot: ConversationGraphSnapshot,
  messagesByBranch: Record<BranchId, RenderedMessage[]>,
  branchId: BranchId,
): RenderedMessage[] {
  const loaded = messagesByBranch[branchId];
  if (loaded) return loaded;
  return (snapshot.branches[branchId]?.messageIds ?? [])
    .map((messageId) => snapshot.messages[messageId])
    .filter((message): message is Message => Boolean(message))
    .map(toRenderedMessage);
}

export function hasLoadedBranchMessages(
  messagesByBranch: Record<BranchId, RenderedMessage[]>,
  branchId: BranchId,
): boolean {
  return Object.hasOwn(messagesByBranch, branchId);
}

export function latestUserPrompt(
  messages: ReadonlyArray<Pick<Message, "role" | "content">>,
): string {
  return (
    [...messages]
      .reverse()
      .find(
        (message) =>
          message.role === "user" && message.content.trim().length > 0,
      )
      ?.content.trim() ?? ""
  );
}

export type ParentBranchComparison = {
  parent: {
    branch: Branch;
    messages: RenderedMessage[];
  };
  child: {
    branch: Branch;
    messages: RenderedMessage[];
  };
  sourceMessage: RenderedMessage | null;
};

export function parentComparisonForBranch(
  snapshot: ConversationGraphSnapshot,
  messagesByBranch: Record<BranchId, RenderedMessage[]>,
  childBranchId: BranchId,
): ParentBranchComparison | null {
  const child = snapshot.branches[childBranchId];
  if (!child?.parentId) return null;
  const parent = snapshot.branches[child.parentId];
  if (!parent) return null;

  const parentMessages = messagesForBranch(
    snapshot,
    messagesByBranch,
    parent.id,
  );
  const canonicalSourceMessage =
    snapshot.messages[child.createdFrom.messageId];
  return {
    parent: { branch: parent, messages: parentMessages },
    child: {
      branch: child,
      messages: messagesForBranch(snapshot, messagesByBranch, child.id),
    },
    sourceMessage:
      parentMessages.find(
        (message) => message.id === child.createdFrom.messageId,
      ) ??
      (canonicalSourceMessage
        ? toRenderedMessage(canonicalSourceMessage)
        : null),
  };
}

export function toRenderedMessage(message: Message): RenderedMessage {
  return {
    ...message,
    renderedHtml: "",
    hasBranchHighlight: false,
    branchAnchors: [],
  };
}

export function mergeRenderedMessage(
  messages: RenderedMessage[],
  message: Message | RenderedMessage,
): RenderedMessage[] {
  const rendered =
    "renderedHtml" in message ? message : toRenderedMessage(message);
  const index = messages.findIndex((candidate) => candidate.id === message.id);
  if (index < 0) return [...messages, rendered];
  const next = [...messages];
  next[index] = rendered;
  return next;
}

export function initialStreamState(
  streamId: string,
  branchId: BranchId,
  assistantMessageId?: string | null,
): StreamState {
  return {
    streamId,
    branchId,
    assistantMessageId: assistantMessageId ?? null,
    status: "starting",
    text: "",
    reasoningSummary: null,
    toolProgress: null,
    imageId: null,
    imageUrl: null,
    error: null,
  };
}

export function isStreamActive(
  stream: StreamState | null | undefined,
): boolean {
  return Boolean(
    stream &&
      stream.status !== "complete" &&
      stream.status !== "cancelled" &&
      stream.status !== "error",
  );
}

export function isEmptyCanvasRoot(
  branchId: BranchId,
  rootBranchId: BranchId,
  messageCount: number,
  stream: StreamState | null | undefined,
): boolean {
  return (
    branchId === rootBranchId &&
    messageCount === 0 &&
    !isStreamActive(stream)
  );
}

export function isSupersededByActiveStream(
  message: Pick<Message, "id" | "role" | "content">,
  stream: StreamState | null | undefined,
): boolean {
  return Boolean(
    stream &&
      isStreamActive(stream) &&
      stream.assistantMessageId &&
      message.id === stream.assistantMessageId &&
      message.role === "assistant" &&
      message.content.trim().length === 0,
  );
}

export function removeStreamStateIfMatching(
  current: Record<BranchId, StreamState | undefined>,
  branchId: BranchId,
  streamId: string,
): Record<BranchId, StreamState | undefined> {
  if (current[branchId]?.streamId !== streamId) {
    return current;
  }
  const next = { ...current };
  delete next[branchId];
  return next;
}

export function reduceStreamState(
  current: StreamState,
  event: RendererStreamEvent,
): StreamState {
  switch (event.type) {
    case "opened":
    case "start":
      return { ...current, status: "streaming", error: null };
    case "delta":
      return {
        ...current,
        status: "streaming",
        text: `${current.text}${event.delta ?? event.text ?? ""}`,
      };
    case "reasoning_summary":
      return {
        ...current,
        status: "streaming",
        reasoningSummary: event.summary ?? event.text ?? null,
      };
    case "tool_progress": {
      const label = event.label ?? event.message ?? null;
      const isImage = event.toolType === "image_generation";
      const isSaving =
        isImage &&
        (event.status === "saving" ||
          label?.toLowerCase().includes("saving") === true);
      return {
        ...current,
        status: isImage
          ? isSaving
            ? "saving_image"
            : "generating_image"
          : "streaming",
        toolProgress: label,
      };
    }
    case "image_ready":
      return {
        ...current,
        status: "saving_image",
        imageId: event.imageId ?? null,
        imageUrl: event.url ?? event.imageUrl ?? null,
      };
    case "complete":
      return { ...current, status: "complete", error: null };
    case "cancelled":
      return { ...current, status: "cancelled", error: null };
    case "error":
      return {
        ...current,
        status: "error",
        error: event.message ?? event.error ?? "The response stopped unexpectedly.",
      };
  }
}

export function sourceSelectionOffsets(
  root: Node,
  range: Range,
): { start: number; end: number } {
  const before = range.cloneRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const selection = range.cloneRange();
  selection.selectNodeContents(root);
  selection.setEnd(range.endContainer, range.endOffset);
  return {
    start: before.toString().length,
    end: selection.toString().length,
  };
}
