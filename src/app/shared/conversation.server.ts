import type { AppContext } from "@/app/context";
import {
  createConversationSnapshot,
  type BranchId,
  type ConversationGraphSnapshot,
  type ConversationGraphUpdate,
  type ConversationModelId,
  type ConversationSettings,
  type Message,
} from "@/lib/conversation";

import { getConversationStoreClient } from "./conversationStore.server";

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_TEMPERATURE = 0.2;

export const DEFAULT_CONVERSATION_ID: ConversationModelId = "default";

export interface ConversationLoadResult {
  conversationId: ConversationModelId;
  snapshot: ConversationGraphSnapshot;
  version: number;
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
