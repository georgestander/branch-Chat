"use server";

import type { AppContext } from "@/app/context";
import {
  buildAttachmentChunkId,
  chunkAttachmentSections,
  DOCX_MIME_TYPE,
  extractAttachmentSections,
  imageExtractionUnavailableText,
  LEGACY_WORD_MIME_TYPE,
  PDF_MIME_TYPE,
  summarizeExtractedChunks,
} from "@/app/shared/attachment-extraction";
import { createLexicalEmbedding } from "@/app/shared/retrieval.lexical";
import {
  type AttachmentChunk,
  type PendingAttachment,
} from "@/lib/conversation";

function isPlainTextType(contentType: string): boolean {
  return contentType.startsWith("text/");
}

function isLocallyReadableDocumentType(contentType: string): boolean {
  return [PDF_MIME_TYPE, DOCX_MIME_TYPE, LEGACY_WORD_MIME_TYPE].includes(
    contentType,
  );
}

function approximateTokenCount(text: string): number {
  return Math.max(1, Math.round(text.trim().length / 4));
}

function buildTextChunks(options: {
  conversationId: string;
  attachment: PendingAttachment;
  sections: Awaited<ReturnType<typeof extractAttachmentSections>>;
  createdAt: string;
}): AttachmentChunk[] {
  const { conversationId, attachment, sections, createdAt } = options;
  return chunkAttachmentSections(sections).map((chunk) => ({
    id: buildAttachmentChunkId({
      attachmentId: attachment.id,
      pageNumber: chunk.pageNumber,
      sectionIndex: chunk.sectionIndex,
      chunkIndex: chunk.chunkIndex,
    }),
    attachmentId: attachment.id,
    conversationId,
    kind: "text",
    content: chunk.text,
    tokenCount: approximateTokenCount(chunk.text),
    embedding: createLexicalEmbedding(chunk.text),
    createdAt,
    metadata: {
      fileName: attachment.name,
      contentType: attachment.contentType,
      size: attachment.size,
      pageNumber: chunk.pageNumber,
    },
  }));
}

function buildImageGuardChunk(options: {
  conversationId: string;
  attachment: PendingAttachment;
  createdAt: string;
}): { chunk: AttachmentChunk; summary: string } {
  const { conversationId, attachment, createdAt } = options;
  const summary = imageExtractionUnavailableText(attachment.name);
  return {
    chunk: {
      id: `${attachment.id}:image-unavailable`,
      attachmentId: attachment.id,
      conversationId,
      kind: "image",
      content: summary,
      tokenCount: approximateTokenCount(summary),
      embedding: createLexicalEmbedding(
        `${attachment.name} ${attachment.contentType} ${summary}`,
      ),
      createdAt,
      metadata: {
        fileName: attachment.name,
        contentType: attachment.contentType,
        size: attachment.size,
        pageNumber: null,
        summary: "Image content unavailable; OCR is not enabled.",
      },
    },
    summary,
  };
}

export async function ingestAttachment(
  ctx: AppContext,
  input: { conversationId: string; attachment: PendingAttachment },
): Promise<void> {
  const { conversationId, attachment } = input;
  const store = ctx.getConversationStore(conversationId);
  const uploads = ctx.getUploadsBucket();

  ctx.trace("attachment:ingest:start", {
    conversationId,
    attachmentId: attachment.id,
    contentType: attachment.contentType,
    size: attachment.size,
    parser: "local",
  });

  await store.upsertAttachmentIngestion({
    attachment: {
      attachmentId: attachment.id,
      conversationId,
      status: "pending",
      summary: null,
      error: null,
      openAIFileId: null,
    },
    chunks: [],
  });

  try {
    const object = await uploads.get(attachment.storageKey);
    if (!object) {
      throw new Error("Uploaded file not found in storage");
    }

    const arrayBuffer = await object.arrayBuffer();
    const mimeType =
      attachment.contentType && attachment.contentType.length > 0
        ? attachment.contentType
        : object.httpMetadata?.contentType ?? "application/octet-stream";
    const createdAt = new Date().toISOString();

    let chunks: AttachmentChunk[];
    let summary: string | null;
    if (mimeType.startsWith("image/")) {
      const image = buildImageGuardChunk({
        conversationId,
        attachment,
        createdAt,
      });
      chunks = [image.chunk];
      summary = image.summary;
    } else if (
      isPlainTextType(mimeType) ||
      isLocallyReadableDocumentType(mimeType)
    ) {
      const sections = await extractAttachmentSections({
        data: new Uint8Array(arrayBuffer),
        contentType: mimeType,
      });
      chunks = buildTextChunks({
        conversationId,
        attachment,
        sections,
        createdAt,
      });
      if (chunks.length === 0) {
        const noTextMessage =
          mimeType === PDF_MIME_TYPE
            ? "PDF contains no extractable text. OCR is not enabled, so its contents will not be inferred."
            : "Attachment contains no extractable text.";
        throw new Error(noTextMessage);
      }
      summary = summarizeExtractedChunks(chunkAttachmentSections(sections));
    } else {
      throw new Error(`Unsupported attachment type: ${mimeType}`);
    }

    await store.upsertAttachmentIngestion({
      attachment: {
        attachmentId: attachment.id,
        conversationId,
        status: "ready",
        summary,
        error: null,
        openAIFileId: null,
      },
      chunks,
    });

    ctx.trace("attachment:ingest:success", {
      conversationId,
      attachmentId: attachment.id,
      chunkCount: chunks.length,
      firstChunkTokenCount: chunks[0]?.tokenCount ?? null,
      parser: "local",
    });
  } catch (cause) {
    const error =
      cause instanceof Error ? cause.message : "Unknown ingestion failure";
    ctx.trace("attachment:ingest:error", {
      conversationId,
      attachmentId: attachment.id,
      error,
      parser: "local",
    });
    await store.upsertAttachmentIngestion({
      attachment: {
        attachmentId: attachment.id,
        conversationId,
        status: "failed",
        summary: null,
        error,
        openAIFileId: null,
      },
      chunks: [],
    });
    throw cause instanceof Error ? cause : new Error(error);
  }
}
