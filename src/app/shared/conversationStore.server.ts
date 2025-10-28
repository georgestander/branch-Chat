import { ConversationStoreClient, conversationIdToDurableId } from "@/lib/durable-objects/ConversationStore";
import type { ConversationModelId } from "@/lib/conversation";
import type { AppContext } from "@/app/context";

const CLIENT_CACHE_SYMBOL = Symbol.for("connexus.conversation-store-clients");

type ConversationStoreCache = Map<ConversationModelId, ConversationStoreClient>;

function getClientCache(ctx: AppContext): ConversationStoreCache {
  const existing = ctx.locals[CLIENT_CACHE_SYMBOL] as ConversationStoreCache | undefined;
  if (existing) {
    return existing;
  }

  const next = new Map<ConversationModelId, ConversationStoreClient>();
  ctx.locals[CLIENT_CACHE_SYMBOL] = next;
  return next;
}

export function getConversationStoreClient(
  ctx: AppContext,
  conversationId: ConversationModelId,
): ConversationStoreClient {
  const cache = getClientCache(ctx);
  const cached = cache.get(conversationId);
  if (cached) {
    return cached;
  }

  const stub = conversationIdToDurableId(
    ctx.env.ConversationGraphDO,
    conversationId,
  );

  const client = new ConversationStoreClient(stub);
  cache.set(conversationId, client);
  return client;
}
