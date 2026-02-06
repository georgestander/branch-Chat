"use server";

import {
  ensureConversationSnapshot,
  resolveConversationId,
} from "@/app/shared/conversation.server";
import type { AppContext } from "@/app/context";
import type { PendingAttachment } from "@/lib/conversation";
import {
  isAttachmentMimeTypeAllowed,
  UPLOAD_MAX_ATTACHMENTS,
  UPLOAD_MAX_SIZE_BYTES,
} from "@/app/shared/uploads.config";
import { ingestAttachment } from "@/app/shared/uploads.ingest.server";

export const MAX_ATTACHMENTS_PER_MESSAGE = UPLOAD_MAX_ATTACHMENTS;
const PRESIGNED_EXPIRATION_SECONDS = 15 * 60; // 15 minutes

function sanitizeFileName(raw: string): string {
  const noPath = raw?.split("/").pop()?.split("\\").pop() ?? "file";
  const trimmed = noPath.trim();
  const sanitized = trimmed
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-_.]+/, "")
    .slice(0, 96);
  return sanitized || "file";
}

function buildStorageKey(options: {
  conversationId: string;
  attachmentId: string;
  fileName: string;
}): string {
  const { conversationId, attachmentId, fileName } = options;
  return `conversations/${conversationId}/attachments/${attachmentId}/${fileName}`;
}

export interface CreateAttachmentUploadInput {
  conversationId?: string;
  fileName: string;
  size: number;
  contentType: string;
}

export interface CreateAttachmentUploadResult {
  attachment: PendingAttachment;
  uploadUrl: string;
  uploadHeaders: Record<string, string>;
  expiresAt: string;
}

export async function createAttachmentUpload(
  ctx: AppContext,
  input: CreateAttachmentUploadInput,
): Promise<CreateAttachmentUploadResult> {
  const conversationId = resolveConversationId(ctx, input.conversationId);
  await ensureConversationSnapshot(ctx, conversationId);

  if (!input.fileName || typeof input.fileName !== "string") {
    throw new Error("File name is required");
  }
  if (!Number.isFinite(input.size) || input.size <= 0) {
    throw new Error("File size must be positive");
  }
  if (input.size > UPLOAD_MAX_SIZE_BYTES) {
    throw new Error("File exceeds maximum allowed size");
  }
  if (!isAttachmentMimeTypeAllowed(input.contentType)) {
    throw new Error("File type is not supported");
  }

  const uploadsBucket = ctx.getUploadsBucket();
  const store = ctx.getConversationStore(conversationId);

  const attachmentId = crypto.randomUUID();
  const safeFileName = sanitizeFileName(input.fileName);
  const storageKey = buildStorageKey({
    conversationId,
    attachmentId,
    fileName: safeFileName,
  });
  const createdAt = new Date().toISOString();

  const { attachment } = await store.stageAttachment(
    {
      id: attachmentId,
      name: safeFileName,
      contentType: input.contentType,
      size: Math.floor(input.size),
      storageKey,
      createdAt,
    },
    { maxAllowed: MAX_ATTACHMENTS_PER_MESSAGE },
  );

  const presign = (uploadsBucket as any)?.createPresignedUrl;
  if (typeof presign !== "function") {
    ctx.trace("uploads:presign:fallback", {
      conversationId,
      attachmentId,
    });
    const fallbackUrl = `/_uploads?conversationId=${encodeURIComponent(
      conversationId,
    )}&attachmentId=${encodeURIComponent(attachmentId)}`;
    const expiresAt = new Date(
      Date.now() + PRESIGNED_EXPIRATION_SECONDS * 1000,
    ).toISOString();
    return {
      attachment,
      uploadUrl: fallbackUrl,
      uploadHeaders: {
        "content-type": input.contentType,
        "x-connexus-upload-mode": "direct",
      },
      expiresAt,
    };
  }

  const signed = await presign.call(uploadsBucket, {
    key: storageKey,
    method: "PUT",
    expiration: PRESIGNED_EXPIRATION_SECONDS,
    headers: {
      "content-type": input.contentType,
      "content-length": input.size.toString(),
    },
  });

  const headers = signed?.headers instanceof Headers
    ? signed.headers
    : new Headers(signed?.headers ?? {});
  const uploadHeaders = Object.fromEntries(headers.entries());

  return {
    attachment,
    uploadUrl: signed.url.toString(),
    uploadHeaders,
    expiresAt: signed.expiration.toISOString(),
  };
}

export interface FinalizeAttachmentInput {
  conversationId?: string;
  attachmentId: string;
}

export async function finalizeAttachmentUpload(
  ctx: AppContext,
  input: FinalizeAttachmentInput,
): Promise<PendingAttachment> {
  const conversationId = resolveConversationId(ctx, input.conversationId);
  await ensureConversationSnapshot(ctx, conversationId);
  const store = ctx.getConversationStore(conversationId);
  const uploadsBucket = ctx.getUploadsBucket();

  const staged = await store.getAttachment(input.attachmentId);
  if (!staged) {
    throw new Error("Attachment not found");
  }

  const object = await uploadsBucket.head(staged.storageKey);
  if (!object) {
    throw new Error("Uploaded file not found in storage");
  }

  const uploadedAt = object.uploaded?.toISOString?.() ?? new Date().toISOString();
  let finalized = await store.finalizeAttachment(staged.id, {
    size: object.size,
    uploadedAt,
  });

  try {
    await ingestAttachment(ctx, {
      conversationId,
      attachment: finalized,
    });
    const refreshed = await store.getAttachment(finalized.id);
    if (refreshed) {
      finalized = refreshed;
    }
  } catch (error) {
    ctx.trace("attachment:ingest:dispatch-error", {
      conversationId,
      attachmentId: finalized.id,
      error: error instanceof Error ? error.message : "unknown",
    });
  }

  return finalized;
}

export interface RemoveAttachmentInput {
  conversationId?: string;
  attachmentId: string;
}

export async function removeStagedAttachment(
  ctx: AppContext,
  input: RemoveAttachmentInput,
): Promise<PendingAttachment | null> {
  const conversationId = resolveConversationId(ctx, input.conversationId);
  await ensureConversationSnapshot(ctx, conversationId);
  const store = ctx.getConversationStore(conversationId);
  const uploadsBucket = ctx.getUploadsBucket();

  const existing = await store.getAttachment(input.attachmentId);
  if (!existing) {
    return null;
  }

  const removed = await store.deleteAttachment(existing.id);
  if (removed) {
    try {
      await uploadsBucket.delete(removed.storageKey);
    } catch (error) {
      console.warn("[WARN] failed to delete staged attachment from R2", error);
    }
  }

  return removed;
}

export function getMaxAttachmentSizeBytes(): number {
  return UPLOAD_MAX_SIZE_BYTES;
}
