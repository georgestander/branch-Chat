"use server";

import { getRequestInfo } from "rwsdk/worker";

import type { AppContext } from "@/app/context";
import {
  DEFAULT_CONVERSATION_ID,
  applyConversationUpdates,
  ensureConversationSnapshot,
  buildResponseInputFromBranch,
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

  const openaiInput = buildResponseInputFromBranch({
    snapshot: ensured.snapshot,
    branchId,
    nextUserContent: userMessage.content,
  });

  const settings = ensured.snapshot.conversation.settings;
  const openai = ctx.getOpenAIClient();

  ctx.trace("openai:request", {
    conversationId,
    branchId,
    model: settings.model,
    temperature: settings.temperature,
    messageCount: openaiInput.length,
  });

  let assistantContent = "";
  let promptTokens = 0;
  let completionTokens = 0;

  try {
    const response = await openai.responses.create({
      model: settings.model,
      temperature: settings.temperature,
      input: openaiInput,
    });

    assistantContent = response.output_text?.trim() ?? "";
    promptTokens = response.usage?.input_tokens ?? 0;
    completionTokens = response.usage?.output_tokens ?? 0;
    ctx.trace("openai:response", {
      conversationId,
      branchId,
      promptTokens,
      completionTokens,
    });
  } catch (error) {
    ctx.trace("openai:error", {
      conversationId,
      branchId,
      error: error instanceof Error ? error.message : "unknown",
    });
    throw new Error("OpenAI completion failed");
  }

  if (!assistantContent) {
    assistantContent = "Assistant response was empty.";
  }

  const assistantMessage: Message = {
    id: crypto.randomUUID(),
    branchId,
    role: "assistant",
    content: assistantContent,
    createdAt: new Date().toISOString(),
    tokenUsage: {
      prompt: promptTokens,
      completion: completionTokens,
      cost: 0,
    },
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
