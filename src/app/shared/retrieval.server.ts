"use server";

import type { AppContext } from "@/app/context";
import {
  type AttachmentChunk,
  type AttachmentChunkMatch,
  type AttachmentIngestionRecord,
  type RetrievedContextChunk,
  type WebSearchSnippet,
  type WebSearchSnippetMatch,
} from "@/lib/conversation";
import type { WebSearchResultSummary } from "@/lib/conversation/tools";

const EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_MIN_SIMILARITY = 0.15;
const MAX_CONTEXT_CHARS = 1_200;

async function embedQuery(
  ctx: AppContext,
  text: string,
): Promise<number[]> {
  const openai = ctx.getOpenAIClient() as any;
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: [text],
  });
  const embedding = response.data[0]?.embedding as number[] | undefined;
  if (!embedding) {
    throw new Error("Embedding response missing data");
  }
  return embedding;
}

async function embedSnippets(
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

function truncateContent(content: string): string {
  if (content.length <= MAX_CONTEXT_CHARS) {
    return content;
  }
  return `${content.slice(0, MAX_CONTEXT_CHARS)}…`;
}

function attachmentChunkToContext(
  match: AttachmentChunkMatch & { ingestion: AttachmentIngestionRecord | null },
): RetrievedContextChunk {
  const { chunk, similarity, ingestion } = match;
  const metadata = (chunk.metadata ?? {}) as Record<string, unknown>;
  const fileName =
    typeof metadata.fileName === "string" && metadata.fileName.length > 0
      ? metadata.fileName
      : ingestion?.attachmentId ?? "Attachment";
  const title = fileName;

  return {
    id: chunk.id,
    type: "attachment",
    attachmentId: chunk.attachmentId,
    title,
    content: truncateContent(chunk.content),
    relevance: Number.isFinite(similarity) ? similarity : 0,
    metadata: {
      fileName,
    },
  };
}

function webSnippetToContext(match: WebSearchSnippetMatch): RetrievedContextChunk {
  const { snippet, similarity } = match;
  const title = snippet.title || snippet.url || "Web result";
  return {
    id: snippet.id,
    type: "web",
    title,
    content: truncateContent(snippet.snippet || title),
    relevance: Number.isFinite(similarity) ? similarity : 0,
    metadata: {
      url: snippet.url,
      provider: snippet.provider ?? null,
      createdAt: snippet.createdAt,
    },
  };
}

export interface RetrievalContextResult {
  blocks: RetrievedContextChunk[];
  attachments: Array<AttachmentChunkMatch & { ingestion: AttachmentIngestionRecord | null }>;
  webSnippets: WebSearchSnippetMatch[];
}

export async function buildRetrievalContext(
  ctx: AppContext,
  options: {
    conversationId: string;
    query: string;
    maxAttachmentChunks?: number;
    maxWebSnippets?: number;
    allowedAttachmentIds?: string[] | null;
    minScore?: number;
  },
): Promise<RetrievalContextResult> {
  const normalizedQuery = options.query.trim();
  if (!normalizedQuery) {
    return { blocks: [], attachments: [], webSnippets: [] };
  }

  const embedding = await embedQuery(ctx, normalizedQuery);
  const store = ctx.getConversationStore(options.conversationId);
  const result = await store.queryRetrieval({
    embedding,
    maxAttachmentChunks: options.maxAttachmentChunks ?? 6,
    maxWebSnippets: options.maxWebSnippets ?? 4,
    allowedAttachmentIds: options.allowedAttachmentIds ?? undefined,
    minScore: options.minScore ?? DEFAULT_MIN_SIMILARITY,
  });

  const attachmentMatches = result.attachments ?? [];
  const webMatches = result.webSnippets ?? [];

  const blocks: RetrievedContextChunk[] = [];
  for (const match of attachmentMatches) {
    blocks.push(
      attachmentChunkToContext({
        chunk: match.chunk as AttachmentChunk,
        similarity: match.similarity,
        ingestion: match.ingestion ?? null,
      }),
    );
  }

  for (const match of webMatches) {
    blocks.push(webSnippetToContext(match));
  }

  return {
    blocks,
    attachments: attachmentMatches.map((match) => ({
      ...match,
      ingestion: match.ingestion ?? null,
    })),
    webSnippets: webMatches,
  };
}

export function formatRetrievedContextForPrompt(
  blocks: RetrievedContextChunk[],
): string | null {
  if (blocks.length === 0) {
    return null;
  }

  const lines = blocks.map((block, index) => {
    const label = block.type === "attachment" ? "Attachment" : "Web";
    return `Context ${index + 1} (${label} – ${block.title}):\n${block.content}`;
  });

  return lines.join("\n\n");
}

export async function persistWebSearchSnippets(
  ctx: AppContext,
  options: {
    conversationId: string;
    snippets: WebSearchResultSummary[];
    provider?: string | null;
  },
): Promise<void> {
  if (options.snippets.length === 0) {
    return;
  }

  const texts = options.snippets.map((snippet) =>
    [snippet.title, snippet.snippet, snippet.url].filter(Boolean).join("\n"),
  );
  const embeddings = await embedSnippets(ctx, texts);

  const records: WebSearchSnippet[] = options.snippets.map((snippet, index) => ({
    id: snippet.id,
    conversationId: options.conversationId,
    title: snippet.title,
    url: snippet.url,
    snippet: snippet.snippet,
    embedding: embeddings[index] ?? [],
    provider: options.provider ?? null,
    createdAt: new Date().toISOString(),
  }));

  const store = ctx.getConversationStore(options.conversationId);
  await store.upsertWebSearchSnippets(records);
}
