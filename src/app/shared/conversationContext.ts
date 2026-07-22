import type {
  Branch,
  BranchId,
  ConversationGraphSnapshot,
  Message,
} from "../../lib/conversation/model.ts";

function getBranchChain(
  snapshot: ConversationGraphSnapshot,
  branchId: BranchId,
): Branch[] {
  const chain: Branch[] = [];
  let current = snapshot.branches[branchId];

  while (current) {
    chain.push(current);
    if (!current.parentId) {
      break;
    }
    current = snapshot.branches[current.parentId];
  }

  return chain.reverse();
}

function getBranchMessages(
  snapshot: ConversationGraphSnapshot,
  branchId: BranchId,
): Message[] {
  const branch = snapshot.branches[branchId];
  if (!branch) {
    return [];
  }

  return branch.messageIds
    .map((messageId) => snapshot.messages[messageId])
    .filter((message): message is Message => Boolean(message));
}

/**
 * Returns the canonical message lineage visible to a branch.
 *
 * Every ancestor contributes messages only through the source message used to
 * create its child. The target branch contributes all of its own messages.
 */
export function getEffectiveBranchMessages(
  snapshot: ConversationGraphSnapshot,
  branchId: BranchId,
): Message[] {
  const chain = getBranchChain(snapshot, branchId);
  const orderedMessages: Message[] = [];

  for (let index = 0; index < chain.length; index++) {
    const branchNode = chain[index];
    const branchMessages = getBranchMessages(snapshot, branchNode.id);

    const isTargetBranch = index === chain.length - 1;
    if (isTargetBranch) {
      orderedMessages.push(...branchMessages);
      continue;
    }

    const childBranch = chain[index + 1];
    const cutOffId = childBranch.createdFrom?.messageId;
    if (!cutOffId) {
      orderedMessages.push(...branchMessages);
      continue;
    }

    const cutOffIndex = branchMessages.findIndex(
      (message) => message.id === cutOffId,
    );
    const sliceEnd = cutOffIndex >= 0 ? cutOffIndex + 1 : branchMessages.length;
    orderedMessages.push(...branchMessages.slice(0, sliceEnd));
  }

  return orderedMessages;
}

/**
 * Returns attachment identifiers inherited by a branch in first-seen order.
 * This deliberately uses the exact same cutoff-aware lineage as model context.
 */
export function getEffectiveBranchAttachmentIds(
  snapshot: ConversationGraphSnapshot,
  branchId: BranchId,
): string[] {
  const attachmentIds: string[] = [];
  const seen = new Set<string>();

  for (const message of getEffectiveBranchMessages(snapshot, branchId)) {
    for (const attachment of message.attachments ?? []) {
      if (!attachment.id || seen.has(attachment.id)) {
        continue;
      }
      seen.add(attachment.id);
      attachmentIds.push(attachment.id);
    }
  }

  return attachmentIds;
}

const DEFAULT_RECOVERY_MESSAGE_LIMIT = 40;
const DEFAULT_RECOVERY_CHARACTER_LIMIT = 80_000;

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value === undefined) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}

function truncateMessageContent(content: string, limit: number): string {
  if (content.length <= limit) {
    return content;
  }
  if (limit <= 0) {
    return "";
  }
  if (limit === 1) {
    return "…";
  }
  return `${content.slice(0, limit - 1)}…`;
}

/**
 * Builds a strictly bounded recovery payload from the newest canonical lineage
 * messages. Full messages are retained when possible; at most one oldest
 * retained message is clipped to fill the remaining character budget.
 */
export function getBoundedBranchRecoveryMessages(options: {
  snapshot: ConversationGraphSnapshot;
  branchId: BranchId;
  maxMessages?: number;
  maxCharacters?: number;
}): Message[] {
  const maxMessages = normalizePositiveInteger(
    options.maxMessages,
    DEFAULT_RECOVERY_MESSAGE_LIMIT,
  );
  const maxCharacters = normalizePositiveInteger(
    options.maxCharacters,
    DEFAULT_RECOVERY_CHARACTER_LIMIT,
  );
  if (maxMessages === 0 || maxCharacters === 0) {
    return [];
  }

  const lineage = getEffectiveBranchMessages(options.snapshot, options.branchId);
  const retainedNewestFirst: Message[] = [];
  let remainingCharacters = maxCharacters;

  for (
    let index = lineage.length - 1;
    index >= 0 && retainedNewestFirst.length < maxMessages;
    index--
  ) {
    const message = lineage[index];
    if (message.content.length <= remainingCharacters) {
      retainedNewestFirst.push(message);
      remainingCharacters -= message.content.length;
      continue;
    }

    retainedNewestFirst.push({
      ...message,
      content: truncateMessageContent(message.content, remainingCharacters),
    });
    break;
  }

  return retainedNewestFirst.reverse();
}
