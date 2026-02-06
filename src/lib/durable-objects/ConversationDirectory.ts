import { type ConversationModelId } from "@/lib/conversation";

export interface ConversationDirectoryEntry {
  id: ConversationModelId;
  ownerId?: string | null;
  title: string;
  createdAt: string;
  lastActiveAt: string;
  branchCount: number;
  archivedAt: string | null;
}

interface DirectoryState {
  conversations: Record<ConversationModelId, ConversationDirectoryEntry>;
}

const STORAGE_KEY = "conversation.directory.state.v1";

function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init.headers,
    },
  });
}

function sortEntries(entries: ConversationDirectoryEntry[]): ConversationDirectoryEntry[] {
  return [...entries].sort((a, b) =>
    b.lastActiveAt.localeCompare(a.lastActiveAt) || a.id.localeCompare(b.id),
  );
}

function normalizeEntry(entry: ConversationDirectoryEntry): ConversationDirectoryEntry {
  return {
    ...entry,
    ownerId:
      typeof entry.ownerId === "string" && entry.ownerId.trim().length > 0
        ? entry.ownerId.trim()
        : null,
    archivedAt: entry.archivedAt ?? null,
  };
}

function normalizeState(stored: DirectoryState | null): {
  state: DirectoryState;
  dirty: boolean;
} {
  if (!stored) {
    return { state: { conversations: {} }, dirty: false };
  }

  let dirty = false;
  const normalizedEntries = Object.fromEntries(
    Object.entries(stored.conversations).map(([id, entry]) => {
      const normalized = normalizeEntry(entry);
      if (
        normalized.archivedAt !== entry.archivedAt ||
        normalized.ownerId !== (entry.ownerId ?? null)
      ) {
        dirty = true;
      }
      return [id, normalized] as const;
    }),
  );

  return {
    state: { conversations: normalizedEntries },
    dirty,
  };
}

function sanitizeOwnerId(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("ownerId is required");
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new TypeError("ownerId is required");
  }
  return normalized;
}

export class ConversationDirectoryDO implements DurableObject {
  private readonly state: DurableObjectState;
  private cache: DirectoryState | null = null;
  private readonly ready: Promise<void>;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.ready = this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<DirectoryState>(STORAGE_KEY);
      const { state: normalized, dirty } = normalizeState(stored ?? null);
      this.cache = normalized;
      if (dirty) {
        await this.state.storage.put(STORAGE_KEY, normalized);
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/entries") {
      const ownerIdParam = url.searchParams.get("ownerId");
      const ownerId =
        ownerIdParam && ownerIdParam.trim().length > 0
          ? ownerIdParam.trim()
          : null;
      return this.handleList(ownerId);
    }

    if (request.method === "POST" && url.pathname === "/entries") {
      const payload = await request.json().catch(() => null);
      return this.handleCreate(payload);
    }

    if (request.method === "POST" && url.pathname === "/entries/touch") {
      const payload = await request.json().catch(() => null);
      return this.handleTouch(payload);
    }

    if (request.method === "POST" && url.pathname === "/entries/archive") {
      const payload = await request.json().catch(() => null);
      return this.handleArchive(payload);
    }

    if (request.method === "POST" && url.pathname === "/entries/unarchive") {
      const payload = await request.json().catch(() => null);
      return this.handleUnarchive(payload);
    }

    if (request.method === "DELETE" && url.pathname === "/entries") {
      const payload = await request.json().catch(() => null);
      return this.handleDelete(payload);
    }

    return new Response("Not found", { status: 404 });
  }

  private async getState(): Promise<DirectoryState> {
    if (this.cache) {
      return this.cache;
    }

    const stored =
      (await this.state.storage.get<DirectoryState>(STORAGE_KEY)) ?? null;
    const { state: normalized, dirty } = normalizeState(stored);
    this.cache = normalized;
    if (dirty) {
      await this.state.storage.put(STORAGE_KEY, normalized);
    }
    return this.cache;
  }

  private async updateState(
    mutator: (state: DirectoryState) => DirectoryState,
  ): Promise<DirectoryState> {
    const current = await this.getState();
    const next = mutator({
      conversations: { ...current.conversations },
    });
    this.cache = next;
    await this.state.storage.put(STORAGE_KEY, next);
    return next;
  }

  private async handleList(ownerId: string | null): Promise<Response> {
    const state = await this.getState();
    const entries = sortEntries(
      Object.values(state.conversations).filter((entry) => {
        if (!ownerId) {
          return false;
        }
        return entry.ownerId === ownerId;
      }),
    );
    return jsonResponse({ entries });
  }

  private async handleCreate(payload: unknown): Promise<Response> {
    try {
      if (!payload || typeof payload !== "object") {
        throw new TypeError("Payload must be an object");
      }

      const { id, title, branchCount, lastActiveAt, ownerId } = payload as Record<
        string,
        unknown
      >;

      if (!id || typeof id !== "string") {
        throw new TypeError("Conversation id is required");
      }
      const normalizedOwnerId = sanitizeOwnerId(ownerId);

      const normalizedTitle =
        typeof title === "string" && title.trim().length > 0 ? title.trim() : "Untitled Conversation";
      const normalizedBranchCount =
        typeof branchCount === "number" && Number.isFinite(branchCount) && branchCount >= 0
          ? Math.floor(branchCount)
          : 0;
      const timestamp =
        typeof lastActiveAt === "string" && lastActiveAt.trim().length > 0
          ? lastActiveAt
          : new Date().toISOString();

      const createdAt = new Date().toISOString();

      const nextState = await this.updateState((state) => {
        const existing = state.conversations[id as ConversationModelId];
        if (
          existing?.ownerId &&
          existing.ownerId !== normalizedOwnerId
        ) {
          throw new Error(`Conversation ${id as string} is owned by another user`);
        }
        const entry: ConversationDirectoryEntry = {
          id: id as ConversationModelId,
          ownerId: existing?.ownerId ?? normalizedOwnerId,
          title: existing?.title ?? normalizedTitle,
          createdAt: existing?.createdAt ?? createdAt,
          lastActiveAt: timestamp,
          branchCount: normalizedBranchCount,
          archivedAt: existing?.archivedAt ?? null,
        };
        return {
          conversations: {
            ...state.conversations,
            [entry.id]: entry,
          },
        };
      });

      return jsonResponse({
        entry: nextState.conversations[id as ConversationModelId],
      });
    } catch (error) {
      console.error("[ERROR] directory:create failed", error);
      return jsonResponse(
        { error: "Invalid directory create payload" },
        { status: 400 },
      );
    }
  }

  private async handleTouch(payload: unknown): Promise<Response> {
    try {
      if (!payload || typeof payload !== "object") {
        throw new TypeError("Payload must be an object");
      }

      const { id, title, branchCount, lastActiveAt, ownerId } = payload as Record<
        string,
        unknown
      >;

      if (!id || typeof id !== "string") {
        throw new TypeError("Conversation id is required");
      }
      const normalizedOwnerId = sanitizeOwnerId(ownerId);

      const timestamp =
        typeof lastActiveAt === "string" && lastActiveAt.trim().length > 0
          ? lastActiveAt
          : new Date().toISOString();

      const normalizedTitle =
        typeof title === "string" && title.trim().length > 0 ? title.trim() : undefined;

      const normalizedBranchCount =
        typeof branchCount === "number" && Number.isFinite(branchCount) && branchCount >= 0
          ? Math.floor(branchCount)
          : undefined;

      const nextState = await this.updateState((state) => {
        const existing = state.conversations[id as ConversationModelId];
        if (existing?.ownerId && existing.ownerId !== normalizedOwnerId) {
          throw new Error(`Conversation ${id as string} is owned by another user`);
        }
        const entry: ConversationDirectoryEntry = existing
          ? {
              ...existing,
              ownerId: existing.ownerId ?? normalizedOwnerId,
              title: normalizedTitle ?? existing.title,
              lastActiveAt: timestamp,
              branchCount: normalizedBranchCount ?? existing.branchCount,
            }
          : {
              id: id as ConversationModelId,
              ownerId: normalizedOwnerId,
              title: normalizedTitle ?? "Untitled Conversation",
              createdAt: timestamp,
              lastActiveAt: timestamp,
              branchCount: normalizedBranchCount ?? 0,
              archivedAt: null,
            };

        return {
          conversations: {
            ...state.conversations,
            [entry.id]: entry,
          },
        };
      });

      return jsonResponse({
        entry: nextState.conversations[id as ConversationModelId],
      });
    } catch (error) {
      console.error("[ERROR] directory:touch failed", error);
      return jsonResponse(
        { error: "Invalid directory touch payload" },
        { status: 400 },
      );
    }
  }

  private async handleArchive(payload: unknown): Promise<Response> {
    try {
      if (!payload || typeof payload !== "object") {
        throw new TypeError("Payload must be an object");
      }

      const { id, archivedAt, ownerId } = payload as Record<string, unknown>;

      if (!id || typeof id !== "string") {
        throw new TypeError("Conversation id is required");
      }
      const normalizedOwnerId = sanitizeOwnerId(ownerId);

      const timestamp =
        typeof archivedAt === "string" && archivedAt.trim().length > 0
          ? archivedAt
          : new Date().toISOString();

      const nextState = await this.updateState((state) => {
        const existing = state.conversations[id as ConversationModelId];
        if (!existing) {
          throw new Error(`Conversation ${id as string} not found`);
        }
        if (existing.ownerId && existing.ownerId !== normalizedOwnerId) {
          throw new Error(`Conversation ${id as string} is owned by another user`);
        }

        const entry: ConversationDirectoryEntry = {
          ...existing,
          ownerId: existing.ownerId ?? normalizedOwnerId,
          archivedAt: timestamp,
        };

        return {
          conversations: {
            ...state.conversations,
            [entry.id]: entry,
          },
        };
      });

      return jsonResponse({
        entry: nextState.conversations[id as ConversationModelId],
      });
    } catch (error) {
      console.error("[ERROR] directory:archive failed", error);
      return jsonResponse(
        { error: "Invalid directory archive payload" },
        { status: 400 },
      );
    }
  }

  private async handleUnarchive(payload: unknown): Promise<Response> {
    try {
      if (!payload || typeof payload !== "object") {
        throw new TypeError("Payload must be an object");
      }

      const { id, ownerId } = payload as Record<string, unknown>;

      if (!id || typeof id !== "string") {
        throw new TypeError("Conversation id is required");
      }
      const normalizedOwnerId = sanitizeOwnerId(ownerId);

      const nextState = await this.updateState((state) => {
        const existing = state.conversations[id as ConversationModelId];
        if (!existing) {
          throw new Error(`Conversation ${id as string} not found`);
        }
        if (existing.ownerId && existing.ownerId !== normalizedOwnerId) {
          throw new Error(`Conversation ${id as string} is owned by another user`);
        }

        const entry: ConversationDirectoryEntry = {
          ...existing,
          ownerId: existing.ownerId ?? normalizedOwnerId,
          archivedAt: null,
        };

        return {
          conversations: {
            ...state.conversations,
            [entry.id]: entry,
          },
        };
      });

      return jsonResponse({
        entry: nextState.conversations[id as ConversationModelId],
      });
    } catch (error) {
      console.error("[ERROR] directory:unarchive failed", error);
      return jsonResponse(
        { error: "Invalid directory unarchive payload" },
        { status: 400 },
      );
    }
  }

  private async handleDelete(payload: unknown): Promise<Response> {
    try {
      if (!payload || typeof payload !== "object") {
        throw new TypeError("Payload must be an object");
      }

      const { id, ownerId } = payload as Record<string, unknown>;

      if (!id || typeof id !== "string") {
        throw new TypeError("Conversation id is required");
      }
      const normalizedOwnerId = sanitizeOwnerId(ownerId);

      const nextState = await this.updateState((state) => {
        const existing = state.conversations[id as ConversationModelId];
        if (!existing) {
          return state;
        }
        if (existing.ownerId && existing.ownerId !== normalizedOwnerId) {
          throw new Error(`Conversation ${id as string} is owned by another user`);
        }

        const next = { ...state.conversations };
        delete next[id as ConversationModelId];
        return {
          conversations: next,
        } satisfies DirectoryState;
      });

      return jsonResponse({
        ok: true,
        count: Object.keys(nextState.conversations).length,
      });
    } catch (error) {
      console.error("[ERROR] directory:delete failed", error);
      return jsonResponse(
        { error: "Invalid directory delete payload" },
        { status: 400 },
      );
    }
  }
}

export class ConversationDirectoryClient {
  constructor(private readonly stub: DurableObjectStub) {}

  async list(options: { ownerId: string }): Promise<ConversationDirectoryEntry[]> {
    const params = new URLSearchParams({
      ownerId: options.ownerId,
    });
    const response = await this.stub.fetch(
      `https://conversation-directory/entries?${params.toString()}`,
    );
    if (!response.ok) {
      throw new Error(`Failed to list conversations: ${response.status}`);
    }
    const data = (await response.json()) as { entries: ConversationDirectoryEntry[] };
    return sortEntries(data.entries ?? []);
  }

  async create(entry: {
    id: ConversationModelId;
    ownerId: string;
    title?: string;
    branchCount?: number;
    lastActiveAt?: string;
  }): Promise<ConversationDirectoryEntry> {
    const response = await this.stub.fetch("https://conversation-directory/entries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(entry),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Failed to create conversation entry: ${response.status} ${text}`);
    }
    const data = (await response.json()) as { entry: ConversationDirectoryEntry };
    return data.entry;
  }

  async touch(entry: {
    id: ConversationModelId;
    ownerId: string;
    title?: string;
    branchCount?: number;
    lastActiveAt?: string;
  }): Promise<ConversationDirectoryEntry> {
    const response = await this.stub.fetch("https://conversation-directory/entries/touch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(entry),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Failed to touch conversation entry: ${response.status} ${text}`);
    }
    const data = (await response.json()) as { entry: ConversationDirectoryEntry };
    return data.entry;
  }

  async archive(entry: {
    id: ConversationModelId;
    ownerId: string;
    archivedAt?: string;
  }): Promise<ConversationDirectoryEntry> {
    const response = await this.stub.fetch("https://conversation-directory/entries/archive", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(entry),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Failed to archive conversation entry: ${response.status} ${text}`);
    }
    const data = (await response.json()) as { entry: ConversationDirectoryEntry };
    return data.entry;
  }

  async unarchive(entry: {
    id: ConversationModelId;
    ownerId: string;
  }): Promise<ConversationDirectoryEntry> {
    const response = await this.stub.fetch("https://conversation-directory/entries/unarchive", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(entry),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Failed to unarchive conversation entry: ${response.status} ${text}`);
    }
    const data = (await response.json()) as { entry: ConversationDirectoryEntry };
    return data.entry;
  }

  async delete(entry: { id: ConversationModelId; ownerId: string }): Promise<void> {
    const response = await this.stub.fetch("https://conversation-directory/entries", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(entry),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Failed to delete conversation entry: ${response.status} ${text}`);
    }
  }
}

export function getConversationDirectoryStub(
  namespace: DurableObjectNamespace,
): DurableObjectStub {
  const durableId = namespace.idFromName("conversation-directory");
  return namespace.get(durableId);
}
