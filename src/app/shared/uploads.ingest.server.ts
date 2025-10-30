"use server";

import type { AppContext } from "@/app/context";
import {
  type AttachmentChunk,
  type PendingAttachment,
} from "@/lib/conversation";

const EMBEDDING_MODEL = "text-embedding-3-small";
const DOCUMENT_PARSER_MODEL = "gpt-4.1-mini";
const IMAGE_DESCRIPTION_MODEL = "gpt-4.1-mini";

const MAX_TEXT_CHARS = 120_000;
const CHUNK_CHAR_LIMIT = 2_400;
const CHUNK_OVERLAP = 240;

function isPlainTextType(contentType: string): boolean {
  return (
    contentType.startsWith("text/") ||
    contentType === "application/json" ||
    contentType === "application/javascript" ||
    contentType === "application/x-yaml" ||
    contentType === "application/xml" ||
    contentType === "application/sql" ||
    contentType === "application/csv" ||
    contentType === "text/csv"
  );
}

function isDocumentType(contentType: string): boolean {
  return [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ].includes(contentType);
}

function approximateTokenCount(text: string): number {
  const normalizedLength = text.trim().length;
  return Math.max(1, Math.round(normalizedLength / 4));
}

function toBase64(data: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(data);
  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

function chunkPlainText(text: string): string[] {
  const sanitized = text.replace(/\r\n/g, "\n").trim();
  if (sanitized.length === 0) {
    return [];
  }

  const chunks: string[] = [];
  let pointer = 0;

  while (pointer < sanitized.length) {
    let end = Math.min(pointer + CHUNK_CHAR_LIMIT, sanitized.length);
    let slice = sanitized.slice(pointer, end);

    if (end < sanitized.length) {
      const lastParagraphBreak = slice.lastIndexOf("\n\n");
      const lastSentenceBreak = slice.lastIndexOf(". ");
      const fallbackBreak = slice.lastIndexOf("\n");
      const bestBreak = Math.max(lastParagraphBreak, lastSentenceBreak, fallbackBreak);
      if (bestBreak > CHUNK_CHAR_LIMIT * 0.4) {
        end = pointer + bestBreak + 1;
        slice = sanitized.slice(pointer, end);
      }
    }

    chunks.push(slice.trim());
    pointer = end;
    if (pointer < sanitized.length) {
      pointer = Math.max(0, pointer - CHUNK_OVERLAP);
    }
  }

  return chunks.filter((chunk) => chunk.length > 0);
}

async function embedTexts(
  ctx: AppContext,
  texts: string[],
): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  const openai = ctx.getOpenAIClient() as any;
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  });

  return response.data.map((item: any) => item.embedding as number[]);
}

async function summarizeText(
  ctx: AppContext,
  text: string,
): Promise<string | null> {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }

  try {
    const openai = ctx.getOpenAIClient() as any;
    const response = await openai.responses.create({
      model: DOCUMENT_PARSER_MODEL,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "You summarize user-provided study documents into short, high-signal blurbs. Keep summaries under 120 words.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Summarize this document excerpt as bullet points:\n\n${trimmed.slice(
                0,
                10_000,
              )}`,
            },
          ],
        },
      ],
    });

    return response.output_text?.trim() ?? null;
  } catch (error) {
    console.warn("[WARN] summarizeText failed", error);
    return null;
  }
}

async function parseDocumentWithOpenAI(
  ctx: AppContext,
  file: File,
): Promise<{
  chunks: Array<{ title?: string | null; text: string; pageNumber?: number | null }>;
  summary?: string | null;
  fileId: string;
}> {
  const openai = ctx.getOpenAIClient() as any;
  const uploaded = await openai.files.create({
    file,
    purpose: "assistants",
  });

  try {
    const response = await openai.responses.create({
      model: DOCUMENT_PARSER_MODEL,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "You convert documents into structured JSON chunks optimized for retrieval. Keep each chunk under 400 words and preserve headings when possible.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "Read the attached document and respond ONLY with valid JSON using this structure: {\"summary\": string|null, \"chunks\": [{\"title\": string|null, \"text\": string, \"pageNumber\": number|null}]}. Ensure the JSON is strictly valid.",
            },
            {
              type: "input_file",
              file_id: uploaded.id,
            },
          ],
        },
      ],
    });

    const output = response.output_text?.trim() ?? "";
    let parsed:
      | {
          summary?: string | null;
          chunks: Array<{
            title?: string | null;
            text: string;
            pageNumber?: number | null;
          }>;
        }
      | null = null;

    try {
      parsed = JSON.parse(output) as {
        summary?: string | null;
        chunks: Array<{
          title?: string | null;
          text: string;
          pageNumber?: number | null;
        }>;
      };
    } catch (parseError) {
      console.warn("[WARN] parseDocumentWithOpenAI JSON parse failed", parseError, {
        output: output.slice(0, 2400),
      });
    }

    const chunks = parsed?.chunks ?? [];

    if (chunks.length === 0) {
      return {
        chunks: [
          {
            title: file.name,
            text: output || "",
            pageNumber: null,
          },
        ],
        summary: parsed?.summary ?? null,
        fileId: uploaded.id,
      };
    }

    return {
      chunks,
      summary: parsed?.summary ?? null,
      fileId: uploaded.id,
    };
  } catch (error) {
    console.error("[ERROR] parseDocumentWithOpenAI failed", error);
    throw error instanceof Error
      ? error
      : new Error("Failed to parse document with OpenAI");
  }
}

async function describeImageWithOpenAI(
  ctx: AppContext,
  base64: string,
  mimeType: string,
): Promise<string> {
  const openai = ctx.getOpenAIClient() as any;
  const response = await openai.responses.create({
    model: IMAGE_DESCRIPTION_MODEL,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              "Provide a detailed, study-friendly description of this image. Mention key objects, relationships, text, and any data shown.",
          },
          {
            type: "input_image",
            b64_json: base64,
            mime_type: mimeType,
          },
        ],
      },
    ],
  });

  const description = response.output_text?.trim();
  if (!description) {
    throw new Error("Image description missing from OpenAI response");
  }
  return description;
}

async function ingestPlainText(
  ctx: AppContext,
  options: {
    conversationId: string;
    attachment: PendingAttachment;
    text: string;
  },
): Promise<{
  chunks: AttachmentChunk[];
  summary: string | null;
  openAIFileId: string | null;
}> {
  const { conversationId, attachment, text } = options;
  const cappedText = text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;
  const chunks = chunkPlainText(cappedText);
  const embeddings = await embedTexts(ctx, chunks);

  const attachmentChunks: AttachmentChunk[] = chunks.map((chunk, index) => ({
    id: `${attachment.id}:chunk-${index}`,
    attachmentId: attachment.id,
    conversationId,
    kind: "text",
    content: chunk,
    tokenCount: approximateTokenCount(chunk),
    embedding: embeddings[index] ?? [],
    createdAt: new Date().toISOString(),
    metadata: {
      fileName: attachment.name,
      contentType: attachment.contentType,
      size: attachment.size,
      pageNumber: null,
    },
  }));

  const summary = await summarizeText(ctx, cappedText);
  return { chunks: attachmentChunks, summary, openAIFileId: null };
}

async function ingestDocument(
  ctx: AppContext,
  options: {
    conversationId: string;
    attachment: PendingAttachment;
    file: File;
  },
): Promise<{
  chunks: AttachmentChunk[];
  summary: string | null;
  openAIFileId: string | null;
}> {
  const { conversationId, attachment, file } = options;
  const parsed = await parseDocumentWithOpenAI(ctx, file);
  const texts = parsed.chunks.map((chunk) => chunk.text);
  const embeddings = await embedTexts(ctx, texts);

  const attachmentChunks: AttachmentChunk[] = parsed.chunks.map((chunk, index) => ({
    id: `${attachment.id}:chunk-${index}`,
    attachmentId: attachment.id,
    conversationId,
    kind: "text",
    content: chunk.text,
    tokenCount: approximateTokenCount(chunk.text),
    embedding: embeddings[index] ?? [],
    createdAt: new Date().toISOString(),
    metadata: {
      fileName: attachment.name,
      contentType: attachment.contentType,
      size: attachment.size,
      pageNumber:
        typeof chunk.pageNumber === "number" && Number.isFinite(chunk.pageNumber)
          ? chunk.pageNumber
          : null,
      summary: chunk.title ?? null,
    },
  }));

  return {
    chunks: attachmentChunks,
    summary: parsed.summary ?? null,
    openAIFileId: parsed.fileId,
  };
}

async function ingestImage(
  ctx: AppContext,
  options: {
    conversationId: string;
    attachment: PendingAttachment;
    base64: string;
  },
): Promise<{
  chunks: AttachmentChunk[];
  summary: string | null;
  openAIFileId: string | null;
}> {
  const { conversationId, attachment, base64 } = options;
  const description = await describeImageWithOpenAI(
    ctx,
    base64,
    attachment.contentType,
  );
  const [embedding] = await embedTexts(ctx, [description]);

  const chunk: AttachmentChunk = {
    id: `${attachment.id}:image`,
    attachmentId: attachment.id,
    conversationId,
    kind: "image",
    content: description,
    tokenCount: approximateTokenCount(description),
    embedding: embedding ?? [],
    createdAt: new Date().toISOString(),
    metadata: {
      fileName: attachment.name,
      contentType: attachment.contentType,
      size: attachment.size,
    },
  };

  return {
    chunks: [chunk],
    summary: description.slice(0, 400),
    openAIFileId: null,
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

    let ingestionResult:
      | {
          chunks: AttachmentChunk[];
          summary: string | null;
          openAIFileId: string | null;
        }
      | null = null;

    if (isPlainTextType(mimeType)) {
      const text =
        typeof object.text === "function"
          ? await object.text()
          : new TextDecoder().decode(arrayBuffer);
      ingestionResult = await ingestPlainText(ctx, {
        conversationId,
        attachment,
        text,
      });
    } else if (isDocumentType(mimeType)) {
      const file = new File([arrayBuffer], attachment.name || "document", {
        type: mimeType,
      });
      ingestionResult = await ingestDocument(ctx, {
        conversationId,
        attachment,
        file,
      });
    } else if (mimeType.startsWith("image/")) {
      ingestionResult = await ingestImage(ctx, {
        conversationId,
        attachment,
        base64: toBase64(arrayBuffer),
      });
    } else {
      throw new Error(`Unsupported attachment type: ${mimeType}`);
    }

    if (!ingestionResult) {
      throw new Error("Attachment ingestion produced no result");
    }

    await store.upsertAttachmentIngestion({
      attachment: {
        attachmentId: attachment.id,
        conversationId,
        status: "ready",
        summary: ingestionResult.summary ?? null,
        error: null,
        openAIFileId: ingestionResult.openAIFileId ?? null,
      },
      chunks: ingestionResult.chunks,
    });

    ctx.trace("attachment:ingest:success", {
      conversationId,
      attachmentId: attachment.id,
      chunkCount: ingestionResult.chunks.length,
      preview:
        ingestionResult.chunks[0]?.content?.slice(0, 160) ?? null,
    });
  } catch (cause) {
    const error =
      cause instanceof Error ? cause.message : "Unknown ingestion failure";
    ctx.trace("attachment:ingest:error", {
      conversationId,
      attachmentId: attachment.id,
      error,
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
