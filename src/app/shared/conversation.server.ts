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
  const client = getConversationStoreClient(ctx, conversationId);
  const result = await client.read();

  if (result.snapshot) {
    ctx.trace("conversation:load", {
      conversationId,
      version: result.version,
      payloadBytes: JSON.stringify(result.snapshot).length,
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
}): Branch {
  const { snapshot, parentBranchId, messageId, span, title } = options;
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
  const branchMessages = getBranchMessages(snapshot, branchId);

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

  for (const message of branchMessages) {
    if (!message.content.trim()) {
      continue;
    }
    inputs.push({
      role: message.role,
      content: message.content,
    });
  }

  inputs.push({
    role: "user",
    content: nextUserContent,
  });

  return inputs;
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

  return {
    conversationId,
    snapshot: replaced.snapshot,
    version: replaced.version,
  };
}
