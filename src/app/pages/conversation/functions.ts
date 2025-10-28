"use server";

import { getRequestInfo } from "rwsdk/worker";

import type { AppContext } from "@/app/context";
import {
  DEFAULT_CONVERSATION_ID,
  applyConversationUpdates,
  ensureConversationSnapshot,
} from "@/app/shared/conversation.server";
import type {
  BranchId,
  ConversationGraphSnapshot,
  ConversationModelId,
  Message,
} from "@/lib/conversation";
import type { AppRequestInfo } from "@/worker";

export interface ConversationPayload {
  conversationId?: ConversationModelId;
}

export interface LoadConversationResponse {
  conversationId: ConversationModelId;
  snapshot: ConversationGraphSnapshot;
  version: number;
}

export interface SendMessageInput extends ConversationPayload {
  branchId?: BranchId;
  content: string;
}

export interface SendMessageResponse extends LoadConversationResponse {
  appendedMessages: Message[];
}

export async function loadConversation(
  input: ConversationPayload = {},
): Promise<LoadConversationResponse> {
  const requestInfo = getRequestInfo() as AppRequestInfo;
  const ctx = requestInfo.ctx as AppContext;
  const conversationId = input.conversationId ?? DEFAULT_CONVERSATION_ID;

  const result = await ensureConversationSnapshot(ctx, conversationId);
  return result;
}

export async function sendMessage(
  input: SendMessageInput,
): Promise<SendMessageResponse> {
  const requestInfo = getRequestInfo() as AppRequestInfo;
  const ctx = requestInfo.ctx as AppContext;
  const conversationId = input.conversationId ?? DEFAULT_CONVERSATION_ID;

  if (!input.content || input.content.trim().length === 0) {
    throw new Error("Message content is required");
  }

  const ensured = await ensureConversationSnapshot(ctx, conversationId);
  const branchId =
    input.branchId ?? ensured.snapshot.conversation.rootBranchId;
  const branch = ensured.snapshot.branches[branchId];

  if (!branch) {
    throw new Error(`Branch ${branchId} not found for conversation`);
  }

  const now = new Date().toISOString();
  const userMessage: Message = {
    id: crypto.randomUUID(),
    branchId,
    role: "user",
    content: input.content.trim(),
    createdAt: now,
    tokenUsage: null,
  };

  // TODO: Replace placeholder generation with OpenAI streaming pipeline.
  const assistantMessage: Message = {
    id: crypto.randomUUID(),
    branchId,
    role: "assistant",
    content: generateAssistantPlaceholder(input.content),
    createdAt: new Date().toISOString(),
    tokenUsage: null,
  };

  const applied = await applyConversationUpdates(ctx, conversationId, [
    {
      type: "message:append",
      conversationId,
      message: userMessage,
    },
    {
      type: "message:append",
      conversationId,
      message: assistantMessage,
    },
  ]);

  return {
    conversationId,
    snapshot: applied.snapshot,
    version: applied.version,
    appendedMessages: [userMessage, assistantMessage],
  };
}

function generateAssistantPlaceholder(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) {
    return "I'm ready when you are.";
  }

  return [
    "Echoing until OpenAI streaming is wired:",
    "",
    `> ${trimmed}`,
    "",
    "Streaming integration TBD.",
  ].join("\n");
}
