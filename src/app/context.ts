import type { ConversationModelId } from "@/lib/conversation";
import type { ConversationStoreClient } from "@/lib/durable-objects/ConversationStore";
import type { ConversationDirectoryClient } from "@/lib/durable-objects/ConversationDirectory";
import type { AccountClient } from "@/lib/durable-objects/Account";
import type { OpenAIClient } from "@/lib/openai/client";
import type { AppAuth } from "@/app/shared/auth.server";

export interface AppContext {
  env: Env;
  locals: Record<PropertyKey, unknown>;
  requestId: string;
  auth: AppAuth;
  trace: (event: string, data?: Record<string, unknown>) => void;
  getConversationStore: (
    conversationId: ConversationModelId,
  ) => ConversationStoreClient;
  getOpenAIClient: () => OpenAIClient;
  getConversationDirectory: () => ConversationDirectoryClient;
  getAccount: () => AccountClient;
  getUploadsBucket: () => R2Bucket;
}
