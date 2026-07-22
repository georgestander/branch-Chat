"use server";

import type { AppContext } from "@/app/context";
import {
  ensureConversationSnapshot,
  resolveConversationId,
} from "@/app/shared/conversation.server";
import type { AppRequestInfo } from "@/worker";

export async function handleGeneratedImageRequest(
  requestInfo: AppRequestInfo,
): Promise<Response> {
  if (requestInfo.request.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET" } });
  }
  const ctx = requestInfo.ctx as AppContext;
  const url = new URL(requestInfo.request.url);
  const conversationId = resolveConversationId(
    ctx,
    url.searchParams.get("conversationId"),
  );
  const messageId = url.searchParams.get("messageId");
  const imageId = url.searchParams.get("imageId");
  if (!messageId || !imageId) return new Response("Missing image identity", { status: 400 });

  const { snapshot } = await ensureConversationSnapshot(ctx, conversationId);
  const message = snapshot.messages[messageId];
  const invocation = message?.toolInvocations?.find(
    (item) => item.id === imageId && item.toolType === "image_generation",
  );
  const output = invocation?.output;
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return new Response("Generated image not found", { status: 404 });
  }
  const storageKey = (output as Record<string, unknown>).storageKey;
  if (typeof storageKey !== "string" || !storageKey.startsWith("generated/")) {
    return new Response("Generated image not found", { status: 404 });
  }
  const object = await ctx.getUploadsBucket().get(storageKey);
  if (!object) return new Response("Generated image not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("cache-control", "private, max-age=31536000, immutable");
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { headers });
}
