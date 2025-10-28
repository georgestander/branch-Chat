import {
  cloneConversationSnapshot,
  type ConversationGraphSnapshot,
  type ConversationGraphUpdate,
  type ConversationModelId,
  type Message,
} from "@/lib/conversation";
import { validateConversationGraphSnapshot } from "@/lib/conversation";

type StoredState = {
  snapshot: ConversationGraphSnapshot | null;
  version: number;
  updatedAt: string;
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
      this.cache =
        stored ??
        ({
          snapshot: null,
          version: 0,
          updatedAt: new Date().toISOString(),
        } satisfies StoredState);
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

      const nextState = await this.updateState(() => ({
        snapshot: cloneConversationSnapshot(validated),
        version: this.cache ? this.cache.version + 1 : 1,
        updatedAt: new Date().toISOString(),
      }));

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
        };
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

  private async handleReset(): Promise<Response> {
    const nextState = await this.updateState(() => ({
      snapshot: null,
      version: 0,
      updatedAt: new Date().toISOString(),
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
    this.cache =
      stored ??
      ({
        snapshot: null,
        version: 0,
        updatedAt: new Date().toISOString(),
      } satisfies StoredState);
    return this.cache;
  }

  private async updateState(
    mutator: (current: StoredState) => StoredState,
  ): Promise<StoredState> {
    return this.state.blockConcurrencyWhile(async () => {
      const current = await this.getState();
      const next = mutator(current);
      this.cache = next;
      await this.state.storage.put(STORAGE_STATE_KEY, next);
      return next;
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
}

export function conversationIdToDurableId(
  namespace: DurableObjectNamespace,
  conversationId: ConversationModelId,
): DurableObjectStub {
  const durableId = namespace.idFromName(conversationId);
  return namespace.get(durableId);
}
