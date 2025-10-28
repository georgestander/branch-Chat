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

  const assistantMessage: Message = {
    id: crypto.randomUUID(),
    branchId,
    role: "assistant",
    content: "",
    createdAt: new Date().toISOString(),
    tokenUsage: null,
  };

  await applyConversationUpdates(ctx, conversationId, [
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

  const openaiInput = buildResponseInputFromBranch({
    snapshot: ensured.snapshot,
    branchId,
    nextUserContent: userMessage.content,
  });

  const settings = ensured.snapshot.conversation.settings;
  const openai = ctx.getOpenAIClient();

  ctx.trace("openai:stream:start", {
    conversationId,
    branchId,
    model: settings.model,
    temperature: settings.temperature,
    messageCount: openaiInput.length,
  });

  const stream = await openai.responses.stream({
    model: settings.model,
    temperature: settings.temperature,
    input: openaiInput,
  });

  let buffered = "";
  let lastPublishedLength = 0;
  let lastPublishTime = Date.now();
  const MIN_PUBLISH_CHARS = 24;
  const MIN_PUBLISH_MS = 150;

  const publishPartialUpdate = async (content: string) => {
    await applyConversationUpdates(ctx, conversationId, [
      {
        type: "message:update",
        conversationId,
        message: {
          ...assistantMessage,
          content,
        },
      },
    ]);
  };

  try {
    for await (const event of stream) {
      if (event.type === "response.output_text.delta") {
        const delta = typeof event.delta === "string" ? event.delta : "";
        if (!delta) {
          continue;
        }
        buffered += delta;
        const nowTs = Date.now();
        if (
          buffered.length - lastPublishedLength >= MIN_PUBLISH_CHARS ||
          nowTs - lastPublishTime >= MIN_PUBLISH_MS
        ) {
          lastPublishedLength = buffered.length;
          lastPublishTime = nowTs;
          await publishPartialUpdate(buffered);
        }
      }
    }
  } catch (error) {
    ctx.trace("openai:stream:error", {
      conversationId,
      branchId,
      error: error instanceof Error ? error.message : "unknown",
    });
  }

  let finalContent = buffered;
  let promptTokens = 0;
  let completionTokens = 0;

  try {
    const finalResponse = await stream.finalResponse();
    finalContent =
      finalResponse.output_text?.trim() ??
      finalResponse.output?.map((item: any) => item.content?.map?.((part: any) => part.text ?? "")?.join("") ?? "")?.join("").trim() ??
      buffered.trim();
    promptTokens = finalResponse.usage?.input_tokens ?? 0;
    completionTokens = finalResponse.usage?.output_tokens ?? 0;
    ctx.trace("openai:stream:complete", {
      conversationId,
      branchId,
      promptTokens,
      completionTokens,
      characters: finalContent.length,
    });
  } catch (error) {
    ctx.trace("openai:stream:finalize-error", {
      conversationId,
      branchId,
      error: error instanceof Error ? error.message : "unknown",
    });
    if (!finalContent.trim()) {
      finalContent = "Assistant response interrupted. Please try again.";
    }
  }

  const finalAssistantMessage: Message = {
    ...assistantMessage,
    content: finalContent,
    tokenUsage: {
      prompt: promptTokens,
      completion: completionTokens,
      cost: 0,
    },
  };

  const applied = await applyConversationUpdates(ctx, conversationId, [
    {
      type: "message:update",
      conversationId,
      message: finalAssistantMessage,
    },
  ]);

  return {
    conversationId,
    snapshot: applied.snapshot,
    version: applied.version,
    appendedMessages: [userMessage, finalAssistantMessage],
  };
}
