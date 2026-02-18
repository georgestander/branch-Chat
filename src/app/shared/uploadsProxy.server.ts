"use server";

import {
  ensureConversationSnapshot,
  resolveConversationId,
} from "@/app/shared/conversation.server";
import type { AppContext } from "@/app/context";
import { UPLOAD_MAX_SIZE_BYTES } from "@/app/shared/uploads.config";
import type { AppRequestInfo } from "@/worker";

class UploadLimitExceededError extends Error {
  constructor() {
    super("upload-limit-exceeded");
    this.name = "UploadLimitExceededError";
  }
}

function createSizeLimitedBodyStream(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): ReadableStream<Uint8Array> {
  let totalBytes = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        totalBytes += chunk.byteLength;
        if (totalBytes > maxBytes) {
          throw new UploadLimitExceededError();
        }
        controller.enqueue(chunk);
      },
    }),
  );
}

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
  const conversationId = resolveConversationId(
    appCtx,
    url.searchParams.get("conversationId"),
  );
  const attachmentId = url.searchParams.get("attachmentId");

  if (!attachmentId) {
    return new Response("Missing attachmentId", { status: 400 });
  }

  await ensureConversationSnapshot(appCtx, conversationId);

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
  const limitedBody = createSizeLimitedBodyStream(body, UPLOAD_MAX_SIZE_BYTES);

  try {
    await uploadsBucket.put(staged.storageKey, limitedBody, {
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
    if (error instanceof UploadLimitExceededError) {
      appCtx.trace("uploads:fallback:payload-too-large", {
        conversationId,
        attachmentId,
      });
      try {
        await uploadsBucket.delete(staged.storageKey);
      } catch {
        // Best effort cleanup only.
      }
      return new Response("Payload too large", { status: 413 });
    }
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
