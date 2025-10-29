"use server";

import { DEFAULT_CONVERSATION_ID } from "@/app/shared/conversation.server";
import type { AppContext } from "@/app/context";
import { UPLOAD_MAX_SIZE_BYTES } from "@/app/shared/uploads.config";
import type { AppRequestInfo } from "@/worker";

export async function handleDirectUploadRequest(
  requestInfo: AppRequestInfo,
): Promise<Response> {
  const { request, ctx } = requestInfo;

  if (request.method !== "PUT") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { "allow": "PUT" },
    });
  }

  const appCtx = ctx as AppContext;
  const url = new URL(request.url);
  const conversationId =
    url.searchParams.get("conversationId") ?? DEFAULT_CONVERSATION_ID;
  const attachmentId = url.searchParams.get("attachmentId");

  if (!attachmentId) {
    return new Response("Missing attachmentId", { status: 400 });
  }

  const store = appCtx.getConversationStore(conversationId);
  const staged = await store.getAttachment(attachmentId);

  if (!staged) {
    return new Response("Attachment not found", { status: 404 });
  }

  if (staged.status !== "pending") {
    return new Response("Attachment already uploaded", { status: 409 });
  }

  const uploadsBucket = appCtx.getUploadsBucket();

  const declaredLengthHeader = request.headers.get("content-length");
  if (declaredLengthHeader) {
    const declaredLength = Number(declaredLengthHeader);
    if (!Number.isFinite(declaredLength) || declaredLength <= 0) {
      return new Response("Invalid content length", { status: 400 });
    }
    if (declaredLength > UPLOAD_MAX_SIZE_BYTES) {
      return new Response("Payload too large", { status: 413 });
    }
  }

  const contentType =
    request.headers.get("content-type") || staged.contentType || "application/octet-stream";

  const body = request.body;
  if (!body) {
    return new Response("Missing upload body", { status: 400 });
  }

  try {
    await uploadsBucket.put(staged.storageKey, body, {
      httpMetadata: {
        contentType,
      },
    });
    appCtx.trace("uploads:fallback:put", {
      conversationId,
      attachmentId,
      size: declaredLengthHeader
        ? Number(declaredLengthHeader)
        : staged.size,
    });
  } catch (error) {
    console.error("[Uploads] direct upload failed", error);
    return new Response("Failed to store upload", { status: 500 });
  }

  return new Response(null, {
    status: 204,
    headers: {
      "cache-control": "no-store",
    },
  });
}
