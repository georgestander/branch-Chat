import {
  cloneConversationSnapshot,
  type ConversationGraphSnapshot,
  type ConversationGraphUpdate,
  type ConversationModelId,
  type AttachmentChunk,
  type AttachmentIngestionRecord,
  type Message,
  type PendingAttachment,
  type WebSearchSnippet,
} from "@/lib/conversation";
import { validateConversationGraphSnapshot } from "@/lib/conversation";

type StoredState = {
  snapshot: ConversationGraphSnapshot | null;
  version: number;
  updatedAt: string;
  pendingAttachments: Record<string, PendingAttachment>;
  attachmentChunks: Record<string, AttachmentChunk>;
  attachmentIngestions: Record<string, AttachmentIngestionRecord>;
  webSearchSnippets: Record<string, WebSearchSnippet>;
};

type ReadResult =
  | { snapshot: ConversationGraphSnapshot; version: number }
  | { snapshot: null; version: number };

type ApplyPayload =
  | {
      op: "replace";
      snapshot: ConversationGraphSnapshot;
    }
  | {
      op: "append-messages";
      updates: ConversationGraphUpdate[];
      allowMissing?: boolean;
    };

const STORAGE_STATE_KEY = "conversation.store.state.v1";
const DEFAULT_ATTACHMENT_LIMIT = 32;

type StageAttachmentInput = {
  id: string;
  name: string;
  contentType: string;
  size: number;
  storageKey: string;
  createdAt: string;
};

function sanitizeAttachmentId(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("attachment id must be a string");
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new TypeError("attachment id is required");
  }
  return trimmed;
}

function sanitizeNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new TypeError(`${label} is required`);
  }
  return trimmed;
}

function createPendingAttachmentFromPayload(
  payload: Record<string, unknown>,
): PendingAttachment {
  const id = sanitizeAttachmentId(payload.id);
  const name = sanitizeNonEmptyString(payload.name, "attachment name");
  const contentType = sanitizeNonEmptyString(
    payload.contentType,
    "attachment content type",
  );
  const storageKey = sanitizeNonEmptyString(
    payload.storageKey,
    "attachment storage key",
  );

  const sizeValue = Number(payload.size);
  if (!Number.isFinite(sizeValue) || sizeValue <= 0) {
    throw new TypeError("attachment size must be a positive number");
  }

  const createdAt =
    typeof payload.createdAt === "string" && payload.createdAt.trim().length > 0
      ? payload.createdAt
      : new Date().toISOString();

  return {
    id,
    name,
    contentType,
    size: Math.floor(sizeValue),
    storageKey,
    status: "pending",
    createdAt,
    uploadedAt: null,
  } satisfies PendingAttachment;
}

function sanitizeEmbeddingArray(value: unknown, label: string): number[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array of numbers`);
  }
  const result: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const numeric = Number(value[index]);
    if (!Number.isFinite(numeric)) {
      throw new TypeError(`${label}[${index}] must be a finite number`);
    }
    result.push(numeric);
  }
  if (result.length === 0) {
    throw new TypeError(`${label} must not be empty`);
  }
  return result;
}

function sanitizeAttachmentChunkPayload(
  payload: Record<string, unknown>,
): AttachmentChunk {
  const id = sanitizeNonEmptyString(payload.id, "chunk id");
  const attachmentId = sanitizeAttachmentId(payload.attachmentId);
  const conversationId = sanitizeNonEmptyString(
    payload.conversationId,
    "chunk conversation id",
  );
  const kind = payload.kind === "image" ? "image" : "text";
  const content = sanitizeNonEmptyString(payload.content, "chunk content");
  const tokenCountValue = Number(payload.tokenCount);
  if (!Number.isFinite(tokenCountValue) || tokenCountValue <= 0) {
    throw new TypeError("chunk tokenCount must be a positive number");
  }
  const embedding = sanitizeEmbeddingArray(payload.embedding, "chunk embedding");
  const metadataPayload =
    payload.metadata && typeof payload.metadata === "object"
      ? (payload.metadata as Record<string, unknown>)
      : null;
  const fallbackName =
    typeof (payload as Record<string, unknown>).name === "string"
      ? ((payload as Record<string, unknown>).name as string)
      : `${attachmentId}-chunk`;
  let metadata: AttachmentChunk["metadata"] = null;
  if (metadataPayload) {
    const metaSizeValue = Number(
      metadataPayload.size ?? (payload as Record<string, unknown>).size ?? 0,
    );
    metadata = {
      fileName: sanitizeNonEmptyString(
        metadataPayload.fileName ?? fallbackName,
        "chunk metadata fileName",
      ),
      contentType: sanitizeNonEmptyString(
        metadataPayload.contentType ?? "application/octet-stream",
        "chunk metadata content type",
      ),
      size:
        Number.isFinite(metaSizeValue) && metaSizeValue >= 0
          ? Math.floor(metaSizeValue)
          : 0,
      pageNumber:
        typeof metadataPayload.pageNumber === "number" &&
        Number.isFinite(metadataPayload.pageNumber)
          ? metadataPayload.pageNumber
          : null,
      language:
        typeof metadataPayload.language === "string"
          ? metadataPayload.language
          : null,
      summary:
        typeof metadataPayload.summary === "string"
          ? metadataPayload.summary
          : null,
    };
  } else {
    metadata = {
      fileName: sanitizeNonEmptyString(fallbackName, "chunk metadata file name"),
      contentType: "application/octet-stream",
      size: 0,
      pageNumber: null,
      language: null,
      summary: null,
    };
  }
  const createdAt =
    typeof payload.createdAt === "string" && payload.createdAt.trim().length > 0
      ? payload.createdAt
      : new Date().toISOString();

  return {
    id,
    attachmentId,
    conversationId,
    kind,
    content,
    tokenCount: Math.floor(tokenCountValue),
    embedding,
    metadata,
    createdAt,
  };
}

function sanitizeAttachmentIngestionPayload(
  payload: Record<string, unknown>,
  chunkIds: string[],
): AttachmentIngestionRecord {
  const attachmentId = sanitizeAttachmentId(payload.attachmentId ?? payload.id);
  const conversationId = sanitizeNonEmptyString(
    payload.conversationId,
    "ingestion conversation id",
  );
  const status =
    payload.status === "failed"
      ? "failed"
      : payload.status === "pending"
        ? "pending"
        : "ready";
  const summary =
    typeof payload.summary === "string" ? payload.summary.trim() || null : null;
  const error =
    typeof payload.error === "string" ? payload.error.trim() || null : null;
  const updatedAt =
    typeof payload.updatedAt === "string" && payload.updatedAt.trim().length > 0
      ? payload.updatedAt
      : new Date().toISOString();
  const openAIFileId =
    typeof payload.openAIFileId === "string" && payload.openAIFileId.trim().length > 0
      ? payload.openAIFileId.trim()
      : null;

  return {
    attachmentId,
    conversationId,
    status,
    chunkIds,
    summary,
    error: status === "failed" ? error : null,
    updatedAt,
    openAIFileId,
  };
}

function sanitizeWebSearchSnippetPayload(
  payload: Record<string, unknown>,
): WebSearchSnippet {
  const id = sanitizeNonEmptyString(payload.id, "snippet id");
  const conversationId = sanitizeNonEmptyString(
    payload.conversationId,
    "snippet conversation id",
  );
  const title =
    typeof payload.title === "string" && payload.title.trim().length > 0
      ? payload.title.trim()
      : "Untitled source";
  const url =
    typeof payload.url === "string" && payload.url.trim().length > 0
      ? payload.url.trim()
      : "";
  const snippet =
    typeof payload.snippet === "string" ? payload.snippet : "";
  const embedding = sanitizeEmbeddingArray(payload.embedding, "snippet embedding");
  const provider =
    typeof payload.provider === "string" ? payload.provider : null;
  const createdAt =
    typeof payload.createdAt === "string" && payload.createdAt.trim().length > 0
      ? payload.createdAt
      : new Date().toISOString();

  return {
    id,
    conversationId,
    title,
    url,
    snippet,
    embedding,
    provider,
    createdAt,
  };
}

function dotProduct(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let total = 0;
  for (let index = 0; index < length; index += 1) {
    total += a[index] * b[index];
  }
  return total;
}

function vectorNorm(vector: number[]): number {
  let sumSquares = 0;
  for (const value of vector) {
    sumSquares += value * value;
  }
  return Math.sqrt(sumSquares);
}

function cosineSimilarity(a: number[], b: number[]): number {
  const denominator = vectorNorm(a) * vectorNorm(b);
  if (denominator === 0) {
    return 0;
  }
  return dotProduct(a, b) / denominator;
}

function normalizeStoredState(value: StoredState | null): StoredState {
  const base = (value ?? {}) as Partial<StoredState>;
  return {
    snapshot: base.snapshot ?? null,
    version: typeof base.version === "number" ? base.version : 0,
    updatedAt: base.updatedAt ?? new Date().toISOString(),
    pendingAttachments: base.pendingAttachments ?? {},
    attachmentChunks: base.attachmentChunks ?? {},
    attachmentIngestions: base.attachmentIngestions ?? {},
    webSearchSnippets: base.webSearchSnippets ?? {},
  } satisfies StoredState;
}

function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init.headers,
    },
  });
}

function computePayloadSize(snapshot: ConversationGraphSnapshot | null): number {
  if (!snapshot) {
    return 0;
  }

  const encoded = new TextEncoder().encode(JSON.stringify(snapshot));
  return encoded.byteLength;
}

export class ConversationStoreDO implements DurableObject {
  private readonly state: DurableObjectState;
  private readonly env: Env;
  private cache: StoredState | null = null;
  private readonly ready: Promise<void>;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.ready = this.state.blockConcurrencyWhile(async () => {
      const stored =
        (await this.state.storage.get<StoredState>(STORAGE_STATE_KEY)) ?? null;
      this.cache = normalizeStoredState(stored);
    });
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/snapshot") {
      return this.handleReadSnapshot();
    }

    if (request.method === "PUT" && url.pathname === "/snapshot") {
      const payload = await request.json().catch(() => null);
      return this.handleReplaceSnapshot(payload);
    }

    if (request.method === "POST" && url.pathname === "/apply") {
      const payload = await request.json().catch(() => null);
      return this.handleApplyUpdates(payload);
    }

    if (request.method === "POST" && url.pathname === "/attachments/stage") {
      const payload = await request.json().catch(() => null);
      return this.handleStageAttachment(payload);
    }

    if (request.method === "POST" && url.pathname === "/attachments/finalize") {
      const payload = await request.json().catch(() => null);
      return this.handleFinalizeAttachment(payload);
    }

    if (request.method === "POST" && url.pathname === "/attachments/consume") {
      const payload = await request.json().catch(() => null);
      return this.handleConsumeAttachments(payload);
    }

    if (request.method === "GET" && url.pathname === "/attachments/pending") {
      return this.handleListAttachments();
    }

    if (url.pathname.startsWith("/attachments/")) {
      const id = decodeURIComponent(url.pathname.replace("/attachments/", ""));
      if (!id) {
        return jsonResponse({ error: "attachment-id-required" }, { status: 400 });
      }

      if (request.method === "GET") {
        return this.handleGetAttachment(id);
      }

      if (request.method === "DELETE") {
        return this.handleDeleteAttachment(id);
      }
    }

    if (
      request.method === "POST" &&
      url.pathname === "/retrieval/attachments/ingest"
    ) {
      const payload = await request.json().catch(() => null);
      return this.handleUpsertAttachmentIngestion(payload);
    }

    if (
      request.method === "GET" &&
      url.pathname === "/retrieval/attachments"
    ) {
      return this.handleListAttachmentIngestions();
    }

    if (
      request.method === "POST" &&
      url.pathname === "/retrieval/web/upsert"
    ) {
      const payload = await request.json().catch(() => null);
      return this.handleUpsertWebSearchSnippets(payload);
    }

    if (request.method === "POST" && url.pathname === "/retrieval/query") {
      const payload = await request.json().catch(() => null);
      return this.handleQueryRetrieval(payload);
    }

    if (request.method === "DELETE" && url.pathname === "/snapshot") {
      return this.handleReset();
    }

    return new Response("Not found", { status: 404 });
  }

  private async handleReadSnapshot(): Promise<Response> {
    const state = await this.getState();
    const payloadBytes = computePayloadSize(state.snapshot);
    console.log(
      `[TRACE] conversation-store read`,
      JSON.stringify({
        id: this.state.id.toString(),
        version: state.version,
        payloadBytes,
        hasSnapshot: Boolean(state.snapshot),
      }),
    );

    if (!state.snapshot) {
      return jsonResponse({ snapshot: null, version: state.version }, { status: 200 });
    }

    return jsonResponse(
      {
        snapshot: state.snapshot,
        version: state.version,
      },
      { status: 200 },
    );
  }

  private async handleReplaceSnapshot(payload: unknown): Promise<Response> {
    try {
      if (!payload || typeof payload !== "object") {
        throw new TypeError("Payload must be an object");
      }

      const { snapshot } = payload as Record<string, unknown>;
      if (!snapshot) {
        throw new TypeError("Missing snapshot property");
      }

      const validated = validateConversationGraphSnapshot(snapshot);

      const nextState = await this.updateState((current) => ({
        snapshot: cloneConversationSnapshot(validated),
        version: current.version + 1,
        updatedAt: new Date().toISOString(),
        pendingAttachments: current.pendingAttachments,
        attachmentChunks: current.attachmentChunks,
        attachmentIngestions: current.attachmentIngestions,
        webSearchSnippets: current.webSearchSnippets,
      } satisfies StoredState));

      const payloadBytes = computePayloadSize(nextState.snapshot);
      console.log(
        `[TRACE] conversation-store replace`,
        JSON.stringify({
          id: this.state.id.toString(),
          version: nextState.version,
          payloadBytes,
        }),
      );

      return jsonResponse(
        { snapshot: nextState.snapshot, version: nextState.version },
        { status: 200 },
      );
    } catch (error) {
      console.error(
        `[ERROR] conversation-store replace failed`,
        this.state.id.toString(),
        error,
      );
      return jsonResponse(
        { error: "Invalid snapshot payload" },
        { status: 400 },
      );
    }
  }

  private async handleApplyUpdates(payload: unknown): Promise<Response> {
    try {
      const parsed = this.validateApplyPayload(payload);
      const nextState = await this.updateState((current) => {
        let snapshot = current.snapshot
          ? cloneConversationSnapshot(current.snapshot)
          : null;
        if (parsed.op === "replace") {
          snapshot = cloneConversationSnapshot(parsed.snapshot);
        } else {
          snapshot = this.applyUpdates(snapshot, parsed.updates, parsed.allowMissing);
        }
        return {
          snapshot,
          version: current.version + 1,
          updatedAt: new Date().toISOString(),
          pendingAttachments: current.pendingAttachments,
          attachmentChunks: current.attachmentChunks,
          attachmentIngestions: current.attachmentIngestions,
          webSearchSnippets: current.webSearchSnippets,
        } satisfies StoredState;
      });

      const payloadBytes = computePayloadSize(nextState.snapshot);
      console.log(
        `[TRACE] conversation-store apply`,
        JSON.stringify({
          id: this.state.id.toString(),
          version: nextState.version,
          payloadBytes,
          updateCount:
            parsed.op === "replace" ? "replace" : parsed.updates.length,
        }),
      );

      return jsonResponse(
        { snapshot: nextState.snapshot, version: nextState.version },
        { status: 200 },
      );
    } catch (error) {
      console.error(
        `[ERROR] conversation-store apply failed`,
        this.state.id.toString(),
        error,
      );
      return jsonResponse({ error: "Failed to apply updates" }, { status: 400 });
    }
  }

  private async handleStageAttachment(payload: unknown): Promise<Response> {
    try {
      if (!payload || typeof payload !== "object") {
        throw new TypeError("Payload must be an object");
      }
      const { attachment, maxAllowed } = payload as Record<string, unknown>;
      if (!attachment || typeof attachment !== "object") {
        throw new TypeError("Attachment metadata is required");
      }

      const limitCandidate = Number(maxAllowed);
      const limit = Number.isFinite(limitCandidate) && limitCandidate > 0
        ? Math.floor(limitCandidate)
        : DEFAULT_ATTACHMENT_LIMIT;

      const record = createPendingAttachmentFromPayload(
        attachment as Record<string, unknown>,
      );

      const stagedAttachment = await this.updateState((current) => {
        const count = Object.keys(current.pendingAttachments).length;
        if (count >= limit) {
          throw new Error("attachment-limit-exceeded");
        }
        if (current.pendingAttachments[record.id]) {
          throw new Error("attachment-duplicate");
        }
        return {
          ...current,
          pendingAttachments: {
            ...current.pendingAttachments,
            [record.id]: record,
          },
          updatedAt: new Date().toISOString(),
        } satisfies StoredState;
      });

      const pendingCount = Object.keys(stagedAttachment.pendingAttachments).length;
      return jsonResponse(
        {
          attachment: stagedAttachment.pendingAttachments[record.id],
          pendingCount,
        },
        { status: 200 },
      );
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === "attachment-limit-exceeded") {
          return jsonResponse({ error: error.message }, { status: 409 });
        }
        if (error.message === "attachment-duplicate") {
          return jsonResponse({ error: error.message }, { status: 409 });
        }
      }
      console.error("[ERROR] attachments:stage failed", error);
      return jsonResponse({ error: "invalid-attachment-stage" }, { status: 400 });
    }
  }

  private async handleFinalizeAttachment(payload: unknown): Promise<Response> {
    try {
      if (!payload || typeof payload !== "object") {
        throw new TypeError("Payload must be an object");
      }
      const { id, size, uploadedAt } = payload as Record<string, unknown>;
      const attachmentId = sanitizeAttachmentId(id);
      const sizeValue = Number(size);
      const resolvedSize = Number.isFinite(sizeValue) && sizeValue > 0 ? Math.floor(sizeValue) : undefined;
      const uploadedAtValue =
        typeof uploadedAt === "string" && uploadedAt.trim().length > 0
          ? uploadedAt
          : new Date().toISOString();

      let updated: PendingAttachment | undefined;
      const state = await this.updateState((current) => {
        const existing = current.pendingAttachments[attachmentId];
        if (!existing) {
          throw new Error("attachment-not-found");
        }
        if (existing.status === "ready" && existing.uploadedAt) {
          updated = existing;
          return current;
        }

        const nextAttachment: PendingAttachment = {
          ...existing,
          status: "ready",
          uploadedAt: uploadedAtValue,
          size: resolvedSize ?? existing.size,
        };

        updated = nextAttachment;
        return {
          ...current,
          pendingAttachments: {
            ...current.pendingAttachments,
            [attachmentId]: nextAttachment,
          },
          updatedAt: new Date().toISOString(),
        } satisfies StoredState;
      });

      const attachment = updated ?? state.pendingAttachments[attachmentId];
      return jsonResponse({ attachment }, { status: 200 });
    } catch (error) {
      if (error instanceof Error && error.message === "attachment-not-found") {
        return jsonResponse({ error: error.message }, { status: 404 });
      }
      console.error("[ERROR] attachments:finalize failed", error);
      return jsonResponse({ error: "invalid-attachment-finalize" }, { status: 400 });
    }
  }

  private async handleConsumeAttachments(payload: unknown): Promise<Response> {
    try {
      if (!payload || typeof payload !== "object") {
        throw new TypeError("Payload must be an object");
      }
      const { ids } = payload as Record<string, unknown>;
      if (!Array.isArray(ids) || ids.length === 0) {
        throw new TypeError("ids must be a non-empty array");
      }

      const attachmentIds = ids.map((value) => sanitizeAttachmentId(value));
      const consumed: PendingAttachment[] = [];

      await this.updateState((current) => {
        const pendingEntries = { ...current.pendingAttachments };
        for (const id of attachmentIds) {
          const existing = pendingEntries[id];
          if (!existing) {
            throw new Error("attachment-not-found");
          }
          if (existing.status !== "ready") {
            throw new Error("attachment-not-ready");
          }
          consumed.push(existing);
          delete pendingEntries[id];
        }

        return {
          ...current,
          pendingAttachments: pendingEntries,
          updatedAt: new Date().toISOString(),
        } satisfies StoredState;
      });

      return jsonResponse({ attachments: consumed }, { status: 200 });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === "attachment-not-found") {
          return jsonResponse({ error: error.message }, { status: 404 });
        }
        if (error.message === "attachment-not-ready") {
          return jsonResponse({ error: error.message }, { status: 409 });
        }
      }
      console.error("[ERROR] attachments:consume failed", error);
      return jsonResponse({ error: "invalid-attachment-consume" }, { status: 400 });
    }
  }

  private async handleListAttachments(): Promise<Response> {
    const state = await this.getState();
    return jsonResponse({ attachments: Object.values(state.pendingAttachments) }, { status: 200 });
  }

  private async handleGetAttachment(id: string): Promise<Response> {
    const state = await this.getState();
    const attachment = state.pendingAttachments[id];
    if (!attachment) {
      return jsonResponse({ error: "attachment-not-found" }, { status: 404 });
    }
    return jsonResponse({ attachment }, { status: 200 });
  }

  private async handleDeleteAttachment(id: string): Promise<Response> {
    let removed: PendingAttachment | undefined;
    await this.updateState((current) => {
      const existing = current.pendingAttachments[id];
      if (!existing) {
        return current;
      }
      removed = existing;
      const { [id]: _removed, ...rest } = current.pendingAttachments;
      return {
        ...current,
        pendingAttachments: rest,
        updatedAt: new Date().toISOString(),
      } satisfies StoredState;
    });

    if (!removed) {
      return jsonResponse({ error: "attachment-not-found" }, { status: 404 });
    }

    return jsonResponse({ attachment: removed }, { status: 200 });
  }

  private async handleUpsertAttachmentIngestion(payload: unknown): Promise<Response> {
    try {
      if (!payload || typeof payload !== "object") {
        throw new TypeError("Payload must be an object");
      }
      const { attachment, chunks } = payload as Record<string, unknown>;
      if (!attachment || typeof attachment !== "object") {
        throw new TypeError("Attachment ingestion payload is required");
      }

      const chunkPayloads = Array.isArray(chunks)
        ? (chunks as Record<string, unknown>[]).map((item) =>
            sanitizeAttachmentChunkPayload(item),
          )
        : [];
      const chunkIds = chunkPayloads.map((chunk) => chunk.id);
      const record = sanitizeAttachmentIngestionPayload(
        attachment as Record<string, unknown>,
        chunkIds,
      );

      const nextState = await this.updateState((current) => {
        const nextChunks = { ...current.attachmentChunks };
        const existingRecord = current.attachmentIngestions[record.attachmentId];
        if (existingRecord) {
          for (const id of existingRecord.chunkIds) {
            delete nextChunks[id];
          }
        }
        for (const chunk of chunkPayloads) {
          nextChunks[chunk.id] = chunk;
        }

        let nextPendingAttachments = current.pendingAttachments;
        const pending = current.pendingAttachments[record.attachmentId];
        if (pending) {
          nextPendingAttachments = {
            ...current.pendingAttachments,
            [record.attachmentId]: {
              ...pending,
              openAIFileStatus: record.status,
              openAIFileId: record.openAIFileId ?? pending.openAIFileId ?? null,
              openAIFileError: record.error ?? null,
            },
          };
        }

        return {
          ...current,
          attachmentChunks: nextChunks,
          attachmentIngestions: {
            ...current.attachmentIngestions,
            [record.attachmentId]: {
              ...record,
              chunkIds,
            },
          },
          pendingAttachments: nextPendingAttachments,
          updatedAt: new Date().toISOString(),
        } satisfies StoredState;
      });

      return jsonResponse(
        {
          ingestion: nextState.attachmentIngestions[record.attachmentId],
          chunkCount: chunkPayloads.length,
        },
        { status: 200 },
      );
    } catch (error) {
      console.error("[ERROR] attachments:ingest failed", error);
      return jsonResponse({ error: "invalid-attachment-ingestion" }, { status: 400 });
    }
  }

  private async handleUpsertWebSearchSnippets(payload: unknown): Promise<Response> {
    try {
      if (!payload || typeof payload !== "object") {
        throw new TypeError("Payload must be an object");
      }
      const { snippets } = payload as Record<string, unknown>;
      if (!Array.isArray(snippets) || snippets.length === 0) {
        return jsonResponse({ count: 0 }, { status: 200 });
      }

      const normalized = (snippets as Record<string, unknown>[]).map((item) =>
        sanitizeWebSearchSnippetPayload(item),
      );

      const nextState = await this.updateState((current) => {
        const nextSnippets = { ...current.webSearchSnippets };
        for (const snippet of normalized) {
          nextSnippets[snippet.id] = snippet;
        }
        return {
          ...current,
          webSearchSnippets: nextSnippets,
          updatedAt: new Date().toISOString(),
        } satisfies StoredState;
      });

      return jsonResponse(
        {
          count: normalized.length,
          total: Object.keys(nextState.webSearchSnippets).length,
        },
        { status: 200 },
      );
    } catch (error) {
      console.error("[ERROR] web-search:upsert failed", error);
      return jsonResponse({ error: "invalid-web-search-upsert" }, { status: 400 });
    }
  }

  private async handleListAttachmentIngestions(): Promise<Response> {
    const state = await this.getState();
    const items = Object.values(state.attachmentIngestions).map((ingestion) => ({
      ...ingestion,
      summary: ingestion.summary ?? null,
      error: ingestion.error ?? null,
    }));
    return jsonResponse({ ingestions: items }, { status: 200 });
  }

  private async handleQueryRetrieval(payload: unknown): Promise<Response> {
    try {
      if (!payload || typeof payload !== "object") {
        throw new TypeError("Payload must be an object");
      }
      const {
        embedding,
        maxAttachmentChunks,
        maxWebSnippets,
        allowedAttachmentIds,
        minScore,
      } = payload as Record<string, unknown>;

      const queryEmbedding = sanitizeEmbeddingArray(embedding, "query embedding");
      const attachmentLimitValue = Number(maxAttachmentChunks);
      const webLimitValue = Number(maxWebSnippets);
      const attachmentLimit =
        Number.isFinite(attachmentLimitValue) && attachmentLimitValue > 0
          ? Math.floor(attachmentLimitValue)
          : 6;
      const webLimit =
        Number.isFinite(webLimitValue) && webLimitValue > 0
          ? Math.floor(webLimitValue)
          : 6;
      const allowedIds =
        Array.isArray(allowedAttachmentIds) && allowedAttachmentIds.length > 0
          ? allowedAttachmentIds.map((id) => sanitizeAttachmentId(id))
          : null;
      const minSimilarity =
        typeof minScore === "number" && Number.isFinite(minScore)
          ? minScore
          : -1;

      const state = await this.getState();
      const allAttachmentMatches: Array<{
        chunk: AttachmentChunk;
        similarity: number;
        ingestion: AttachmentIngestionRecord | null;
      }> = [];
      const attachmentMatches: Array<{
        chunk: AttachmentChunk;
        similarity: number;
        ingestion: AttachmentIngestionRecord | null;
      }> = [];

      for (const chunk of Object.values(state.attachmentChunks)) {
        if (allowedIds && !allowedIds.includes(chunk.attachmentId)) {
          continue;
        }
        if (chunk.embedding.length !== queryEmbedding.length) {
          continue;
        }
        const similarity = cosineSimilarity(queryEmbedding, chunk.embedding);
        if (!Number.isFinite(similarity)) {
          continue;
        }
        const matchRecord = {
          chunk,
          similarity,
          ingestion: state.attachmentIngestions[chunk.attachmentId] ?? null,
        };
        allAttachmentMatches.push(matchRecord);
        if (similarity < minSimilarity) {
          continue;
        }
        attachmentMatches.push(matchRecord);
      }

      attachmentMatches.sort((a, b) => b.similarity - a.similarity);
      allAttachmentMatches.sort((a, b) => b.similarity - a.similarity);
      const topAttachmentMatches = attachmentMatches.slice(0, attachmentLimit);
      const fallbackAttachmentMatches =
        topAttachmentMatches.length > 0
          ? []
          : allAttachmentMatches.slice(0, Math.min(attachmentLimit, 4));

      const allWebMatches: Array<{ snippet: WebSearchSnippet; similarity: number }> = [];
      const webMatches: Array<{ snippet: WebSearchSnippet; similarity: number }> = [];
      for (const snippet of Object.values(state.webSearchSnippets)) {
        if (snippet.embedding.length !== queryEmbedding.length) {
          continue;
        }
        const similarity = cosineSimilarity(queryEmbedding, snippet.embedding);
        if (!Number.isFinite(similarity)) {
          continue;
        }
        const matchRecord = { snippet, similarity };
        allWebMatches.push(matchRecord);
        if (similarity < minSimilarity) {
          continue;
        }
        webMatches.push(matchRecord);
      }

      webMatches.sort((a, b) => b.similarity - a.similarity);
      allWebMatches.sort((a, b) => b.similarity - a.similarity);
      const topWebMatches = webMatches.slice(0, webLimit);
      const fallbackWebMatches =
        topWebMatches.length > 0
          ? []
          : allWebMatches.slice(0, Math.min(webLimit, 4));

      return jsonResponse(
        {
          attachments: topAttachmentMatches,
          webSnippets: topWebMatches,
          fallbackAttachments: fallbackAttachmentMatches,
          fallbackWebSnippets: fallbackWebMatches,
        },
        { status: 200 },
      );
    } catch (error) {
      console.error("[ERROR] retrieval:query failed", error);
      return jsonResponse({ error: "invalid-retrieval-query" }, { status: 400 });
    }
  }

  private async handleReset(): Promise<Response> {
    const nextState = await this.updateState(() => ({
      snapshot: null,
      version: 0,
      updatedAt: new Date().toISOString(),
      pendingAttachments: {},
      attachmentChunks: {},
      attachmentIngestions: {},
      webSearchSnippets: {},
    }));

    console.log(
      `[TRACE] conversation-store reset`,
      JSON.stringify({
        id: this.state.id.toString(),
        version: nextState.version,
      }),
    );

    return jsonResponse({ ok: true });
  }

  private async getState(): Promise<StoredState> {
    if (this.cache) {
      return this.cache;
    }

    const stored =
      (await this.state.storage.get<StoredState>(STORAGE_STATE_KEY)) ?? null;
    this.cache = normalizeStoredState(stored);
    return this.cache;
  }

  private async updateState(
    mutator: (current: StoredState) => StoredState,
  ): Promise<StoredState> {
    return this.state.blockConcurrencyWhile(async () => {
      const current = await this.getState();
      const next = mutator(current);
      const normalized = normalizeStoredState(next);
      this.cache = normalized;
      await this.state.storage.put(STORAGE_STATE_KEY, normalized);
      return normalized;
    });
  }

  private validateApplyPayload(payload: unknown): ApplyPayload {
    if (!payload || typeof payload !== "object") {
      throw new TypeError("Payload must be an object");
    }

    const { op } = payload as Record<string, unknown>;
    if (op === "replace") {
      const { snapshot } = payload as Record<string, unknown>;
      if (!snapshot) {
        throw new TypeError("Missing snapshot");
      }
      const validated = validateConversationGraphSnapshot(snapshot);
      return { op, snapshot: validated };
    }

    if (op === "append-messages") {
      const { updates, allowMissing } = payload as Record<string, unknown>;
      if (!Array.isArray(updates)) {
        throw new TypeError("updates must be an array");
      }
      updates.forEach((item, index) => {
        if (!item || typeof item !== "object") {
          throw new TypeError(`Update at index ${index} must be an object`);
        }
      });
      return {
        op,
        updates: updates as ConversationGraphUpdate[],
        allowMissing: Boolean(allowMissing),
      };
    }

    throw new TypeError("Unsupported op");
  }

  private applyUpdates(
    snapshot: ConversationGraphSnapshot | null,
    updates: ConversationGraphUpdate[],
    allowMissing?: boolean,
  ): ConversationGraphSnapshot {
    if (!snapshot) {
      if (!allowMissing) {
        throw new Error("Snapshot not initialized");
      }

      return {
        conversation: updates.find(
          (update) => update.type === "conversation:update",
        )?.conversation ?? (() => {
          throw new Error("Missing conversation data for initialization");
        })(),
        branches: {},
        messages: {},
      };
    }

    const next = cloneConversationSnapshot(snapshot);

    for (const update of updates) {
      switch (update.type) {
        case "conversation:update": {
          next.conversation = update.conversation;
          break;
        }
        case "branch:create":
        case "branch:update": {
          next.branches[update.branch.id] = update.branch;
          break;
        }
        case "message:append": {
          this.appendMessage(next, update.message);
          break;
        }
        case "message:update": {
          this.updateMessage(next, update.message);
          break;
        }
        default: {
          const exhaustiveCheck: never = update;
          throw new Error(`Unsupported update type ${(exhaustiveCheck as any).type}`);
        }
      }
    }

    return next;
  }

  private appendMessage(
    snapshot: ConversationGraphSnapshot,
    message: Message,
  ): void {
    snapshot.messages[message.id] = message;
    const branch = snapshot.branches[message.branchId];
    if (!branch) {
      throw new Error(
        `Branch ${message.branchId} missing for message ${message.id}`,
      );
    }
    if (!branch.messageIds.includes(message.id)) {
      branch.messageIds.push(message.id);
    }
  }

  private updateMessage(
    snapshot: ConversationGraphSnapshot,
    message: Message,
  ): void {
    const existing = snapshot.messages[message.id];
    if (!existing) {
      throw new Error(`Cannot update missing message ${message.id}`);
    }

    snapshot.messages[message.id] = {
      ...existing,
      ...message,
      tokenUsage: message.tokenUsage ?? existing.tokenUsage,
    };

    const branch = snapshot.branches[message.branchId];
    if (branch && !branch.messageIds.includes(message.id)) {
      branch.messageIds.push(message.id);
    }
  }
}

export class ConversationStoreClient {
  constructor(private readonly stub: DurableObjectStub) {}

  async read(): Promise<ReadResult> {
    const response = await this.stub.fetch("https://conversation/snapshot");
    if (!response.ok) {
      throw new Error(
        `Failed to read snapshot: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as {
      snapshot: unknown;
      version: number;
    };

    if (data.snapshot === null) {
      return { snapshot: null, version: data.version ?? 0 };
    }

    const snapshot = validateConversationGraphSnapshot(data.snapshot);
    return { snapshot, version: data.version ?? 0 };
  }

  async replace(snapshot: ConversationGraphSnapshot): Promise<ReadResult> {
    const response = await this.stub.fetch("https://conversation/snapshot", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ snapshot }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `Failed to replace snapshot: ${response.status} ${errorText}`,
      );
    }

    const data = (await response.json()) as {
      snapshot: unknown;
      version: number;
    };

    const validated =
      data.snapshot === null
        ? null
        : validateConversationGraphSnapshot(data.snapshot);

    return {
      snapshot: validated,
      version: data.version ?? 0,
    };
  }

  async apply(updates: ConversationGraphUpdate[]): Promise<ReadResult> {
    const response = await this.stub.fetch("https://conversation/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "append-messages", updates }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `Failed to apply updates: ${response.status} ${errorText}`,
      );
    }

    const data = (await response.json()) as {
      snapshot: unknown;
      version: number;
    };

    const validated =
      data.snapshot === null
        ? null
        : validateConversationGraphSnapshot(data.snapshot);

    return {
      snapshot: validated,
      version: data.version ?? 0,
    };
  }

  async stageAttachment(
    input: StageAttachmentInput,
    options: { maxAllowed?: number } = {},
  ): Promise<{ attachment: PendingAttachment; pendingCount: number }> {
    const response = await this.stub.fetch("https://conversation/attachments/stage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ attachment: input, maxAllowed: options.maxAllowed }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Failed to stage attachment: ${response.status} ${text}`,
      );
    }

    const data = (await response.json()) as {
      attachment: PendingAttachment;
      pendingCount: number;
    };

    return data;
  }

  async finalizeAttachment(
    id: string,
    options: { size?: number; uploadedAt?: string } = {},
  ): Promise<PendingAttachment> {
    const response = await this.stub.fetch("https://conversation/attachments/finalize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, size: options.size, uploadedAt: options.uploadedAt }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Failed to finalize attachment: ${response.status} ${text}`,
      );
    }

    const data = (await response.json()) as { attachment: PendingAttachment };
    return data.attachment;
  }

  async consumeAttachments(ids: string[]): Promise<PendingAttachment[]> {
    const response = await this.stub.fetch("https://conversation/attachments/consume", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Failed to consume attachments: ${response.status} ${text}`,
      );
    }

    const data = (await response.json()) as {
      attachments: PendingAttachment[];
    };
    return data.attachments ?? [];
  }

  async getAttachment(id: string): Promise<PendingAttachment | null> {
    const response = await this.stub.fetch(
      `https://conversation/attachments/${encodeURIComponent(id)}`,
      {
        method: "GET",
      },
    );

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Failed to load attachment: ${response.status} ${text}`);
    }

    const data = (await response.json()) as { attachment: PendingAttachment };
    return data.attachment ?? null;
  }

  async listAttachments(): Promise<PendingAttachment[]> {
    const response = await this.stub.fetch("https://conversation/attachments/pending", {
      method: "GET",
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Failed to list attachments: ${response.status} ${text}`);
    }

    const data = (await response.json()) as {
      attachments: PendingAttachment[];
    };

    return data.attachments ?? [];
  }

  async deleteAttachment(id: string): Promise<PendingAttachment | null> {
    const response = await this.stub.fetch(
      `https://conversation/attachments/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
      },
    );

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Failed to delete attachment: ${response.status} ${text}`,
      );
    }

    const data = (await response.json()) as { attachment: PendingAttachment };
    return data.attachment ?? null;
  }

  async upsertAttachmentIngestion(input: {
    attachment: {
      attachmentId: string;
      conversationId: ConversationModelId;
      status: "pending" | "ready" | "failed";
      summary?: string | null;
      error?: string | null;
      updatedAt?: string;
      openAIFileId?: string | null;
    };
    chunks: AttachmentChunk[];
  }): Promise<{
    ingestion: AttachmentIngestionRecord;
    chunkCount: number;
  }> {
    const response = await this.stub.fetch(
      "https://conversation/retrieval/attachments/ingest",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Failed to upsert attachment ingestion: ${response.status} ${text}`,
      );
    }

    const data = (await response.json()) as {
      ingestion: AttachmentIngestionRecord;
      chunkCount: number;
    };
    return data;
  }

  async listAttachmentIngestions(): Promise<AttachmentIngestionRecord[]> {
    const response = await this.stub.fetch(
      "https://conversation/retrieval/attachments",
      {
        method: "GET",
      },
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Failed to list attachment ingestions: ${response.status} ${text}`,
      );
    }

    const data = (await response.json()) as {
      ingestions: AttachmentIngestionRecord[];
    };
    return data.ingestions ?? [];
  }

  async upsertWebSearchSnippets(
    snippets: WebSearchSnippet[],
  ): Promise<{ count: number; total: number }> {
    if (snippets.length === 0) {
      return { count: 0, total: 0 };
    }

    const response = await this.stub.fetch(
      "https://conversation/retrieval/web/upsert",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ snippets }),
      },
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Failed to upsert web search snippets: ${response.status} ${text}`,
      );
    }

    const data = (await response.json()) as { count: number; total: number };
    return data;
  }

  async queryRetrieval(input: {
    embedding: number[];
    maxAttachmentChunks?: number;
    maxWebSnippets?: number;
    allowedAttachmentIds?: string[];
    minScore?: number;
  }): Promise<{
    attachments: Array<{
      chunk: AttachmentChunk;
      similarity: number;
      ingestion: AttachmentIngestionRecord | null;
    }>;
    webSnippets: Array<{
      snippet: WebSearchSnippet;
      similarity: number;
    }>;
    fallbackAttachments: Array<{
      chunk: AttachmentChunk;
      similarity: number;
      ingestion: AttachmentIngestionRecord | null;
    }>;
    fallbackWebSnippets: Array<{
      snippet: WebSearchSnippet;
      similarity: number;
    }>;
  }> {
    const response = await this.stub.fetch(
      "https://conversation/retrieval/query",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Failed to query retrieval context: ${response.status} ${text}`,
      );
    }

    const data = (await response.json()) as {
      attachments: Array<{
        chunk: AttachmentChunk;
        similarity: number;
        ingestion: AttachmentIngestionRecord | null;
      }>;
      webSnippets: Array<{
        snippet: WebSearchSnippet;
        similarity: number;
      }>;
      fallbackAttachments: Array<{
        chunk: AttachmentChunk;
        similarity: number;
        ingestion: AttachmentIngestionRecord | null;
      }>;
      fallbackWebSnippets: Array<{
        snippet: WebSearchSnippet;
        similarity: number;
      }>;
    };
    return data;
  }

  async reset(): Promise<void> {
    const response = await this.stub.fetch("https://conversation/snapshot", {
      method: "DELETE",
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Failed to reset snapshot: ${response.status} ${text}`,
      );
    }
  }
}

export function conversationIdToDurableId(
  namespace: DurableObjectNamespace,
  conversationId: ConversationModelId,
): DurableObjectStub {
  const durableId = namespace.idFromName(conversationId);
  return namespace.get(durableId);
}
