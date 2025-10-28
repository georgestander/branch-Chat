import type { AppContext } from "@/app/context";
import {
  createConversationSnapshot,
  type Branch,
  type BranchId,
  type BranchSpan,
  type ConversationGraphSnapshot,
  type ConversationGraphUpdate,
  type ConversationModelId,
  type ConversationSettings,
  type Message,
} from "@/lib/conversation";

import { getConversationStoreClient } from "./conversationStore.server";

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_TEMPERATURE = 0.2;

export const DEFAULT_CONVERSATION_ID: ConversationModelId = "default-dev";

type SnapshotCacheEntry = {
  version: number;
  snapshot: ConversationGraphSnapshot;
};

const SNAPSHOT_CACHE: Map<ConversationModelId, SnapshotCacheEntry> = new Map();

function getCachedSnapshot(
  conversationId: ConversationModelId,
): SnapshotCacheEntry | undefined {
  return SNAPSHOT_CACHE.get(conversationId);
}

function setCachedSnapshot(
  conversationId: ConversationModelId,
  entry: SnapshotCacheEntry,
): void {
  SNAPSHOT_CACHE.set(conversationId, entry);
}

export interface ConversationLoadResult {
  conversationId: ConversationModelId;
  snapshot: ConversationGraphSnapshot;
  version: number;
}

export interface BranchTreeNode {
  branch: Branch;
  children: BranchTreeNode[];
  depth: number;
}

export async function ensureConversationSnapshot(
  ctx: AppContext,
  conversationId: ConversationModelId = DEFAULT_CONVERSATION_ID,
): Promise<ConversationLoadResult> {
  const cached = getCachedSnapshot(conversationId);
  if (cached) {
    ctx.trace("conversation:cache:hit", {
      conversationId,
      version: cached.version,
    });
    return {
      conversationId,
      snapshot: cached.snapshot,
      version: cached.version,
    };
  }

  const client = getConversationStoreClient(ctx, conversationId);
  const result = await client.read();

  if (result.snapshot) {
    ctx.trace("conversation:load", {
      conversationId,
      version: result.version,
      payloadBytes: JSON.stringify(result.snapshot).length,
    });

    setCachedSnapshot(conversationId, {
      snapshot: result.snapshot,
      version: result.version,
    });

    return {
      conversationId,
      snapshot: result.snapshot,
      version: result.version,
    };
  }

  const initialized = await initializeConversation(ctx, client, conversationId);
  return initialized;
}

export function getBranchMessages(
  snapshot: ConversationGraphSnapshot,
  branchId: BranchId,
): Message[] {
  const branch = snapshot.branches[branchId];
  if (!branch) {
    return [];
  }

  return branch.messageIds
    .map((id) => snapshot.messages[id])
    .filter((msg): msg is Message => Boolean(msg));
}

export function getBranchAncestors(
  snapshot: ConversationGraphSnapshot,
  branchId: BranchId,
): Branch[] {
  const result: Branch[] = [];
  let current: Branch | undefined | null = snapshot.branches[branchId];

  while (current) {
    result.push(current);
    if (!current.parentId) {
      break;
    }
    current = snapshot.branches[current.parentId] ?? null;
  }

  return result.reverse();
}

export function buildBranchTree(
  snapshot: ConversationGraphSnapshot,
): BranchTreeNode {
  const childrenMap = new Map<BranchId, Branch[]>();

  for (const branch of Object.values(snapshot.branches)) {
    if (!branch.parentId) {
      continue;
    }
    const siblings = childrenMap.get(branch.parentId) ?? [];
    siblings.push(branch);
    childrenMap.set(branch.parentId, siblings);
  }

  const buildNode = (branch: Branch, depth: number): BranchTreeNode => {
    const children = (childrenMap.get(branch.id) ?? [])
      .sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      )
      .map((child) => buildNode(child, depth + 1));
    return { branch, children, depth };
  };

  const rootBranch = snapshot.branches[snapshot.conversation.rootBranchId];
  if (!rootBranch) {
    throw new Error("Root branch missing from snapshot");
  }

  return buildNode(rootBranch, 0);
}

export function draftBranchFromSelection(options: {
  snapshot: ConversationGraphSnapshot;
  parentBranchId: BranchId;
  messageId: string;
  span?: BranchSpan | null;
  title?: string;
  excerpt?: string | null;
}): Branch {
  const { snapshot, parentBranchId, messageId, span, title, excerpt } = options;
  const parentBranch = snapshot.branches[parentBranchId];
  if (!parentBranch) {
    throw new Error(`Parent branch ${parentBranchId} not found`);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  return {
    id,
    parentId: parentBranchId,
    title: title ?? `Branch ${id.slice(0, 6)}`,
    createdFrom: {
      messageId,
      span: span ?? undefined,
      excerpt: excerpt ?? undefined,
    },
    messageIds: [],
    createdAt: now,
    archivedAt: undefined,
  };
}

export async function applyConversationUpdates(
  ctx: AppContext,
  conversationId: ConversationModelId,
  updates: ConversationGraphUpdate[],
): Promise<ConversationLoadResult> {
  const client = getConversationStoreClient(ctx, conversationId);
  const applied = await client.apply(updates);

  if (!applied.snapshot) {
    throw new Error("Conversation snapshot missing after apply");
  }

  ctx.trace("conversation:apply", {
    conversationId,
    version: applied.version,
    updateCount: updates.length,
  });

  setCachedSnapshot(conversationId, {
    version: applied.version,
    snapshot: applied.snapshot,
  });

  return {
    conversationId,
    snapshot: applied.snapshot,
    version: applied.version,
  };
}

export function buildResponseInputFromBranch(options: {
  snapshot: ConversationGraphSnapshot;
  branchId: BranchId;
  nextUserContent: string;
}): Array<{
  role: "system" | "user" | "assistant";
  content: string;
}> {
  const { snapshot, branchId, nextUserContent } = options;
  const chain = getBranchChain(snapshot, branchId);

  const orderedMessages: Message[] = [];
  for (let index = 0; index < chain.length; index++) {
    const branch = chain[index];
    const branchMessages = getBranchMessages(snapshot, branch.id);

    const isTargetBranch = index === chain.length - 1;
    if (isTargetBranch) {
      orderedMessages.push(...branchMessages.filter((message) => message.content.trim().length > 0));
      continue;
    }

    const childBranch = chain[index + 1];
    const cutOffId = childBranch.createdFrom?.messageId;
    if (!cutOffId) {
      orderedMessages.push(...branchMessages.filter((message) => message.content.trim().length > 0));
      continue;
    }

    const cutOffIndex = branchMessages.findIndex((message) => message.id === cutOffId);
    const sliceEnd = cutOffIndex >= 0 ? cutOffIndex + 1 : branchMessages.length;
    orderedMessages.push(
      ...branchMessages
        .slice(0, sliceEnd)
        .filter((message) => message.content.trim().length > 0),
    );
  }

  const inputs: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [];

  const systemPrompt = snapshot.conversation.settings.systemPrompt;
  if (systemPrompt?.trim()) {
    inputs.push({
      role: "system",
      content: systemPrompt,
    });
  }

  if (orderedMessages.length > 0) {
    const lastMessage = orderedMessages[orderedMessages.length - 1];
    if (
      lastMessage.role === "user" &&
      lastMessage.content.trim() === nextUserContent.trim()
    ) {
      orderedMessages.pop();
    }
  }

  for (const message of orderedMessages) {
    inputs.push({
      role: message.role,
      content: message.content,
    });
  }

  const branch = snapshot.branches[branchId];
  const excerpt = branch?.createdFrom?.excerpt?.trim();
  if (excerpt) {
    inputs.push({
      role: "user",
      content: `For reference, this question refers to the highlighted portion of the parent response: "${excerpt}"`,
    });
  }

  inputs.push({
    role: "user",
    content: nextUserContent,
  });

  return inputs;
}

export function getBranchChain(
  snapshot: ConversationGraphSnapshot,
  branchId: BranchId,
): Branch[] {
  const chain: Branch[] = [];
  let current: Branch | undefined = snapshot.branches[branchId];

  while (current) {
    chain.push(current);
    if (!current.parentId) {
      break;
    }
    current = snapshot.branches[current.parentId];
  }

  return chain.reverse();
}

function getDefaultConversationSettings(): ConversationSettings {
  return {
    model: DEFAULT_MODEL,
    temperature: DEFAULT_TEMPERATURE,
    systemPrompt:
      "You are Connexus, a branching conversation assistant. Provide concise, structured replies to help users explore alternatives.",
  };
}

async function initializeConversation(
  ctx: AppContext,
  client: ReturnType<typeof getConversationStoreClient>,
  conversationId: ConversationModelId,
): Promise<ConversationLoadResult> {
  const now = new Date().toISOString();
  const rootBranchId: BranchId = `${conversationId}:root`;
  const systemMessageId = `${rootBranchId}:system`;

  const systemMessage: Message = {
    id: systemMessageId,
    branchId: rootBranchId,
    role: "system",
    content:
      "Connexus is ready. Start the conversation or branch from existing messages.",
    createdAt: now,
    tokenUsage: null,
  };

  const snapshot = createConversationSnapshot({
    id: conversationId,
    createdAt: now,
    settings: getDefaultConversationSettings(),
    rootBranch: {
      id: rootBranchId,
      title: "Main Branch",
      createdFrom: { messageId: systemMessageId },
      createdAt: now,
    },
    initialMessages: [systemMessage],
  });

  const replaced = await client.replace(snapshot);

  if (!replaced.snapshot) {
    throw new Error("Failed to initialize conversation snapshot");
  }

  ctx.trace("conversation:init", {
    conversationId,
    version: replaced.version,
  });

  setCachedSnapshot(conversationId, {
    version: replaced.version,
    snapshot: replaced.snapshot,
  });

  return {
    conversationId,
    snapshot: replaced.snapshot,
    version: replaced.version,
  };
}
