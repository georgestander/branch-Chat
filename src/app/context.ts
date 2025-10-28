import type { ConversationModelId } from "@/lib/conversation";
import type { ConversationStoreClient } from "@/lib/durable-objects/ConversationStore";
import type { OpenAIClient } from "@/lib/openai/client";

export interface AppContext {
  env: Env;
  locals: Record<PropertyKey, unknown>;
  requestId: string;
  trace: (event: string, data?: Record<string, unknown>) => void;
  getConversationStore: (
    conversationId: ConversationModelId,
  ) => ConversationStoreClient;
  getOpenAIClient: () => OpenAIClient;
}
