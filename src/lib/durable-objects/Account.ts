import type { ComposerPreset } from "@/lib/conversation";
import type { ConversationComposerTool } from "@/lib/conversation/tools";

const STORAGE_KEY = "account.state.v1";
const DEFAULT_DEMO_TOTAL_PASSES = 3;
const ALLOWED_COMPOSER_PRESETS = new Set<ComposerPreset>([
  "fast",
  "reasoning",
  "study",
  "custom",
]);
const ALLOWED_COMPOSER_TOOLS = new Set<ConversationComposerTool>([
  "study-and-learn",
  "web-search",
  "file-upload",
]);

type ReservationStatus = "reserved" | "committed" | "released";

interface PassReservation {
  id: string;
  count: number;
  createdAt: string;
  conversationId?: string | null;
  branchId?: string | null;
  status: ReservationStatus;
}

export interface AccountByokCredential {
  provider: string;
  ciphertext: string;
  iv: string;
  version: string;
  createdAt: string;
  updatedAt: string;
}

export interface AccountComposerPreference {
  model: string;
  reasoningEffort: "low" | "medium" | "high" | null;
  preset: ComposerPreset;
  tools: ConversationComposerTool[];
  updatedAt: string;
}

interface AccountState {
  ownerId: string;
  demo: {
    total: number;
    used: number;
    reserved: number;
  };
  byok: AccountByokCredential | null;
  composerPreference: AccountComposerPreference | null;
  reservations: Record<string, PassReservation>;
  updatedAt: string;
}

export interface AccountQuotaSnapshot {
  ownerId: string;
  total: number;
  used: number;
  reserved: number;
  remaining: number;
}

export interface PassReservationResult {
  reservationId: string;
  snapshot: AccountQuotaSnapshot;
}

export class AccountClientError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(options: { message: string; status: number; body: string }) {
    super(options.message);
    this.name = "AccountClientError";
    this.status = options.status;
    this.body = options.body;
  }
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

function sanitizeReservationId(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("reservationId is required");
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new TypeError("reservationId is required");
  }
  return normalized;
}

function sanitizeCount(value: unknown): number {
  if (value === undefined) {
    return 1;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new TypeError("count must be a positive integer");
  }
  return Math.floor(numeric);
}

function sanitizeByokProvider(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("provider is required");
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new TypeError("provider is required");
  }
  return normalized;
}

function sanitizeByokField(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} is required`);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new TypeError(`${label} is required`);
  }
  return normalized;
}

function normalizeComposerPreset(
  value: unknown,
  fallback: ComposerPreset = "custom",
): ComposerPreset {
  return typeof value === "string" && ALLOWED_COMPOSER_PRESETS.has(value as ComposerPreset)
    ? (value as ComposerPreset)
    : fallback;
}

function normalizeComposerTools(value: unknown): ConversationComposerTool[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const tools: ConversationComposerTool[] = [];
  for (const entry of value) {
    if (
      typeof entry === "string" &&
      ALLOWED_COMPOSER_TOOLS.has(entry as ConversationComposerTool) &&
      !tools.includes(entry as ConversationComposerTool)
    ) {
      tools.push(entry as ConversationComposerTool);
    }
  }
  return tools;
}

function normalizeComposerReasoningEffort(
  value: unknown,
): "low" | "medium" | "high" | null {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }
  return null;
}

function normalizeComposerPreference(
  value: unknown,
  now: string,
): AccountComposerPreference | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const model =
    typeof record.model === "string" && record.model.trim().length > 0
      ? record.model.trim()
      : null;
  if (!model) {
    return null;
  }
  const updatedAt =
    typeof record.updatedAt === "string" && record.updatedAt.trim().length > 0
      ? record.updatedAt
      : now;
  return {
    model,
    reasoningEffort: normalizeComposerReasoningEffort(record.reasoningEffort),
    preset: normalizeComposerPreset(record.preset),
    tools: normalizeComposerTools(record.tools),
    updatedAt,
  };
}

function normalizeByokCredential(
  value: unknown,
  now: string,
): AccountByokCredential | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const provider =
    typeof record.provider === "string" && record.provider.trim().length > 0
      ? record.provider.trim()
      : null;
  const ciphertext =
    typeof record.ciphertext === "string" && record.ciphertext.trim().length > 0
      ? record.ciphertext.trim()
      : null;
  const iv =
    typeof record.iv === "string" && record.iv.trim().length > 0
      ? record.iv.trim()
      : null;
  const version =
    typeof record.version === "string" && record.version.trim().length > 0
      ? record.version.trim()
      : null;
  if (!provider || !ciphertext || !iv || !version) {
    return null;
  }
  const createdAt =
    typeof record.createdAt === "string" && record.createdAt.trim().length > 0
      ? record.createdAt
      : now;
  const updatedAt =
    typeof record.updatedAt === "string" && record.updatedAt.trim().length > 0
      ? record.updatedAt
      : createdAt;
  return {
    provider,
    ciphertext,
    iv,
    version,
    createdAt,
    updatedAt,
  };
}

function normalizeState(stored: AccountState | null, ownerId: string): AccountState {
  const now = new Date().toISOString();
  if (!stored) {
    return {
      ownerId,
      demo: {
        total: DEFAULT_DEMO_TOTAL_PASSES,
        used: 0,
        reserved: 0,
      },
      byok: null,
      composerPreference: null,
      reservations: {},
      updatedAt: now,
    };
  }

  const normalizedOwnerId =
    typeof stored.ownerId === "string" && stored.ownerId.trim().length > 0
      ? stored.ownerId.trim()
      : ownerId;

  if (normalizedOwnerId !== ownerId) {
    throw new Error("owner mismatch");
  }

  const reservations: Record<string, PassReservation> = {};
  let recalculatedReserved = 0;
  for (const [id, reservation] of Object.entries(stored.reservations ?? {})) {
    if (!reservation || typeof reservation !== "object") {
      continue;
    }
    const normalizedId = sanitizeReservationId(id);
    const count = sanitizeCount((reservation as PassReservation).count);
    const status =
      (reservation as PassReservation).status === "committed"
        ? "committed"
        : (reservation as PassReservation).status === "released"
          ? "released"
          : "reserved";
    const normalizedReservation: PassReservation = {
      id: normalizedId,
      count,
      createdAt:
        typeof (reservation as PassReservation).createdAt === "string" &&
        (reservation as PassReservation).createdAt.trim().length > 0
          ? (reservation as PassReservation).createdAt
          : now,
      conversationId:
        typeof (reservation as PassReservation).conversationId === "string"
          ? (reservation as PassReservation).conversationId
          : null,
      branchId:
        typeof (reservation as PassReservation).branchId === "string"
          ? (reservation as PassReservation).branchId
          : null,
      status,
    };
    reservations[normalizedId] = normalizedReservation;
    if (status === "reserved") {
      recalculatedReserved += count;
    }
  }

  const usedCandidate = Number(stored.demo?.used);
  const total = DEFAULT_DEMO_TOTAL_PASSES;
  const used =
    Number.isFinite(usedCandidate) && usedCandidate >= 0
      ? Math.min(Math.floor(usedCandidate), total)
      : 0;
  const byok = normalizeByokCredential(
    (stored as Partial<AccountState>).byok ?? null,
    now,
  );
  const composerPreference = normalizeComposerPreference(
    (stored as Partial<AccountState>).composerPreference ?? null,
    now,
  );

  return {
    ownerId: normalizedOwnerId,
    demo: {
      total,
      used,
      reserved: recalculatedReserved,
    },
    byok,
    composerPreference,
    reservations,
    updatedAt:
      typeof stored.updatedAt === "string" && stored.updatedAt.trim().length > 0
        ? stored.updatedAt
        : now,
  };
}

function toQuotaSnapshot(state: AccountState): AccountQuotaSnapshot {
  return {
    ownerId: state.ownerId,
    total: state.demo.total,
    used: state.demo.used,
    reserved: state.demo.reserved,
    remaining: Math.max(0, state.demo.total - state.demo.used - state.demo.reserved),
  };
}

export class AccountDO implements DurableObject {
  private readonly state: DurableObjectState;
  private cache: AccountState | null = null;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/quota") {
      return this.handleGetQuota(url.searchParams.get("ownerId"));
    }

    if (request.method === "POST" && url.pathname === "/quota/reserve") {
      const payload = await request.json().catch(() => null);
      return this.handleReserve(payload);
    }

    if (request.method === "POST" && url.pathname === "/quota/commit") {
      const payload = await request.json().catch(() => null);
      return this.handleCommit(payload);
    }

    if (request.method === "POST" && url.pathname === "/quota/release") {
      const payload = await request.json().catch(() => null);
      return this.handleRelease(payload);
    }

    if (request.method === "GET" && url.pathname === "/byok") {
      return this.handleGetByok(url.searchParams.get("ownerId"));
    }

    if (request.method === "POST" && url.pathname === "/byok") {
      const payload = await request.json().catch(() => null);
      return this.handleSetByok(payload);
    }

    if (request.method === "DELETE" && url.pathname === "/byok") {
      const payload = await request.json().catch(() => null);
      return this.handleDeleteByok(payload);
    }

    if (request.method === "GET" && url.pathname === "/preferences/composer") {
      return this.handleGetComposerPreference(url.searchParams.get("ownerId"));
    }

    if (request.method === "POST" && url.pathname === "/preferences/composer") {
      const payload = await request.json().catch(() => null);
      return this.handleSetComposerPreference(payload);
    }

    return new Response("Not found", { status: 404 });
  }

  private async getState(ownerId: string): Promise<AccountState> {
    if (this.cache) {
      return this.cache;
    }

    const stored =
      (await this.state.storage.get<AccountState>(STORAGE_KEY)) ?? null;
    const normalized = normalizeState(stored, ownerId);
    this.cache = normalized;
    if (stored === null) {
      await this.state.storage.put(STORAGE_KEY, normalized);
    }
    return this.cache;
  }

  private async updateState(
    ownerId: string,
    mutator: (state: AccountState) => AccountState,
  ): Promise<AccountState> {
    return this.state.blockConcurrencyWhile(async () => {
      const current = await this.getState(ownerId);
      const next = mutator({
        ...current,
        demo: { ...current.demo },
        byok: current.byok ? { ...current.byok } : null,
        composerPreference: current.composerPreference
          ? { ...current.composerPreference, tools: [...current.composerPreference.tools] }
          : null,
        reservations: { ...current.reservations },
      });
      this.cache = next;
      await this.state.storage.put(STORAGE_KEY, next);
      return next;
    });
  }

  private async handleGetQuota(ownerId: unknown): Promise<Response> {
    try {
      const normalizedOwnerId = sanitizeOwnerId(ownerId);
      const state = await this.getState(normalizedOwnerId);
      return jsonResponse({
        snapshot: toQuotaSnapshot(state),
      });
    } catch (error) {
      console.error("[ERROR] account:quota:get failed", error);
      return jsonResponse(
        {
          error: "invalid-owner",
        },
        { status: 400 },
      );
    }
  }

  private async handleReserve(payload: unknown): Promise<Response> {
    try {
      if (!payload || typeof payload !== "object") {
        throw new TypeError("Payload must be an object");
      }
      const record = payload as Record<string, unknown>;
      const ownerId = sanitizeOwnerId(record.ownerId);
      const reservationId = sanitizeReservationId(record.reservationId);
      const count = sanitizeCount(record.count);
      const conversationId =
        typeof record.conversationId === "string"
          ? record.conversationId
          : null;
      const branchId =
        typeof record.branchId === "string"
          ? record.branchId
          : null;
      const now = new Date().toISOString();

      const next = await this.updateState(ownerId, (state) => {
        const existing = state.reservations[reservationId];
        if (existing) {
          if (existing.status === "reserved" || existing.status === "committed") {
            return state;
          }
          if (existing.status === "released") {
            throw new Error("reservation already released");
          }
        }

        const remaining =
          state.demo.total - state.demo.used - state.demo.reserved;
        if (remaining < count) {
          throw new Error("quota-exhausted");
        }

        state.reservations[reservationId] = {
          id: reservationId,
          count,
          createdAt: now,
          conversationId,
          branchId,
          status: "reserved",
        };
        state.demo.reserved += count;
        state.updatedAt = now;
        return state;
      });

      const snapshot = toQuotaSnapshot(next);
      console.log(
        "[TRACE] account:quota:reserve",
        JSON.stringify({
          ownerId,
          reservationId,
          conversationId,
          branchId,
          total: snapshot.total,
          used: snapshot.used,
          reserved: snapshot.reserved,
          remaining: snapshot.remaining,
        }),
      );

      return jsonResponse({
        reservationId,
        snapshot,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      if (message === "quota-exhausted") {
        return jsonResponse(
          {
            error: "quota-exhausted",
          },
          { status: 409 },
        );
      }
      if (message === "owner mismatch") {
        return jsonResponse(
          {
            error: "owner-mismatch",
          },
          { status: 403 },
        );
      }
      console.error("[ERROR] account:quota:reserve failed", error);
      return jsonResponse(
        {
          error: "invalid-reserve-request",
        },
        { status: 400 },
      );
    }
  }

  private async handleCommit(payload: unknown): Promise<Response> {
    try {
      if (!payload || typeof payload !== "object") {
        throw new TypeError("Payload must be an object");
      }
      const record = payload as Record<string, unknown>;
      const ownerId = sanitizeOwnerId(record.ownerId);
      const reservationId = sanitizeReservationId(record.reservationId);
      const now = new Date().toISOString();

      const next = await this.updateState(ownerId, (state) => {
        const existing = state.reservations[reservationId];
        if (!existing) {
          throw new Error("reservation-not-found");
        }
        if (existing.status === "committed") {
          return state;
        }
        if (existing.status === "released") {
          throw new Error("reservation-released");
        }

        state.demo.reserved = Math.max(0, state.demo.reserved - existing.count);
        state.demo.used += existing.count;
        state.reservations[reservationId] = {
          ...existing,
          status: "committed",
        };
        state.updatedAt = now;
        return state;
      });

      const snapshot = toQuotaSnapshot(next);
      console.log(
        "[TRACE] account:quota:commit",
        JSON.stringify({
          ownerId,
          reservationId,
          total: snapshot.total,
          used: snapshot.used,
          reserved: snapshot.reserved,
          remaining: snapshot.remaining,
        }),
      );

      return jsonResponse({ snapshot });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      if (message === "reservation-not-found") {
        return jsonResponse(
          { error: "reservation-not-found" },
          { status: 404 },
        );
      }
      if (message === "reservation-released") {
        return jsonResponse(
          { error: "reservation-released" },
          { status: 409 },
        );
      }
      if (message === "owner mismatch") {
        return jsonResponse(
          { error: "owner-mismatch" },
          { status: 403 },
        );
      }
      console.error("[ERROR] account:quota:commit failed", error);
      return jsonResponse(
        { error: "invalid-commit-request" },
        { status: 400 },
      );
    }
  }

  private async handleRelease(payload: unknown): Promise<Response> {
    try {
      if (!payload || typeof payload !== "object") {
        throw new TypeError("Payload must be an object");
      }
      const record = payload as Record<string, unknown>;
      const ownerId = sanitizeOwnerId(record.ownerId);
      const reservationId = sanitizeReservationId(record.reservationId);
      const now = new Date().toISOString();

      const next = await this.updateState(ownerId, (state) => {
        const existing = state.reservations[reservationId];
        if (!existing) {
          return state;
        }
        if (existing.status === "released" || existing.status === "committed") {
          return state;
        }

        state.demo.reserved = Math.max(0, state.demo.reserved - existing.count);
        state.reservations[reservationId] = {
          ...existing,
          status: "released",
        };
        state.updatedAt = now;
        return state;
      });

      const snapshot = toQuotaSnapshot(next);
      console.log(
        "[TRACE] account:quota:release",
        JSON.stringify({
          ownerId,
          reservationId,
          total: snapshot.total,
          used: snapshot.used,
          reserved: snapshot.reserved,
          remaining: snapshot.remaining,
        }),
      );

      return jsonResponse({ snapshot });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      if (message === "owner mismatch") {
        return jsonResponse(
          { error: "owner-mismatch" },
          { status: 403 },
        );
      }
      console.error("[ERROR] account:quota:release failed", error);
      return jsonResponse(
        { error: "invalid-release-request" },
        { status: 400 },
      );
    }
  }

  private async handleGetByok(ownerId: unknown): Promise<Response> {
    try {
      const normalizedOwnerId = sanitizeOwnerId(ownerId);
      const state = await this.getState(normalizedOwnerId);
      console.log(
        "[TRACE] account:byok:get",
        JSON.stringify({
          ownerId: normalizedOwnerId,
          connected: Boolean(state.byok),
          provider: state.byok?.provider ?? null,
          updatedAt: state.byok?.updatedAt ?? null,
        }),
      );
      return jsonResponse({
        byok: state.byok,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      if (message === "owner mismatch") {
        return jsonResponse(
          { error: "owner-mismatch" },
          { status: 403 },
        );
      }
      console.error("[ERROR] account:byok:get failed", error);
      return jsonResponse(
        { error: "invalid-owner" },
        { status: 400 },
      );
    }
  }

  private async handleSetByok(payload: unknown): Promise<Response> {
    try {
      if (!payload || typeof payload !== "object") {
        throw new TypeError("Payload must be an object");
      }
      const record = payload as Record<string, unknown>;
      const ownerId = sanitizeOwnerId(record.ownerId);
      const provider = sanitizeByokProvider(record.provider);
      const ciphertext = sanitizeByokField(record.ciphertext, "ciphertext");
      const iv = sanitizeByokField(record.iv, "iv");
      const version = sanitizeByokField(record.version, "version");
      const now = new Date().toISOString();

      const next = await this.updateState(ownerId, (state) => {
        state.byok = {
          provider,
          ciphertext,
          iv,
          version,
          createdAt: state.byok?.createdAt ?? now,
          updatedAt: now,
        };
        state.updatedAt = now;
        return state;
      });

      console.log(
        "[TRACE] account:byok:set",
        JSON.stringify({
          ownerId,
          provider,
          updatedAt: next.byok?.updatedAt ?? now,
        }),
      );

      return jsonResponse({
        byok: next.byok,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      if (message === "owner mismatch") {
        return jsonResponse(
          { error: "owner-mismatch" },
          { status: 403 },
        );
      }
      console.error("[ERROR] account:byok:set failed", error);
      return jsonResponse(
        { error: "invalid-byok-request" },
        { status: 400 },
      );
    }
  }

  private async handleDeleteByok(payload: unknown): Promise<Response> {
    try {
      if (!payload || typeof payload !== "object") {
        throw new TypeError("Payload must be an object");
      }
      const record = payload as Record<string, unknown>;
      const ownerId = sanitizeOwnerId(record.ownerId);
      const now = new Date().toISOString();
      let cleared = false;
      const next = await this.updateState(ownerId, (state) => {
        if (!state.byok) {
          return state;
        }
        cleared = true;
        state.byok = null;
        state.updatedAt = now;
        return state;
      });
      console.log(
        "[TRACE] account:byok:delete",
        JSON.stringify({
          ownerId,
          cleared,
          connected: Boolean(next.byok),
        }),
      );
      return jsonResponse({
        cleared,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      if (message === "owner mismatch") {
        return jsonResponse(
          { error: "owner-mismatch" },
          { status: 403 },
        );
      }
      console.error("[ERROR] account:byok:delete failed", error);
      return jsonResponse(
        { error: "invalid-byok-delete-request" },
        { status: 400 },
      );
    }
  }

  private async handleGetComposerPreference(ownerId: unknown): Promise<Response> {
    try {
      const normalizedOwnerId = sanitizeOwnerId(ownerId);
      const state = await this.getState(normalizedOwnerId);
      console.log(
        "[TRACE] account:composer:get",
        JSON.stringify({
          ownerId: normalizedOwnerId,
          hasPreference: Boolean(state.composerPreference),
          model: state.composerPreference?.model ?? null,
          preset: state.composerPreference?.preset ?? null,
          updatedAt: state.composerPreference?.updatedAt ?? null,
        }),
      );
      return jsonResponse({
        preference: state.composerPreference,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      if (message === "owner mismatch") {
        return jsonResponse(
          { error: "owner-mismatch" },
          { status: 403 },
        );
      }
      console.error("[ERROR] account:composer:get failed", error);
      return jsonResponse(
        { error: "invalid-owner" },
        { status: 400 },
      );
    }
  }

  private async handleSetComposerPreference(payload: unknown): Promise<Response> {
    try {
      if (!payload || typeof payload !== "object") {
        throw new TypeError("Payload must be an object");
      }
      const record = payload as Record<string, unknown>;
      const ownerId = sanitizeOwnerId(record.ownerId);
      const model =
        typeof record.model === "string" && record.model.trim().length > 0
          ? record.model.trim()
          : null;
      if (!model) {
        throw new TypeError("model is required");
      }
      const now = new Date().toISOString();
      const preference: AccountComposerPreference = {
        model,
        reasoningEffort: normalizeComposerReasoningEffort(record.reasoningEffort),
        preset: normalizeComposerPreset(record.preset),
        tools: normalizeComposerTools(record.tools),
        updatedAt: now,
      };
      const next = await this.updateState(ownerId, (state) => {
        state.composerPreference = preference;
        state.updatedAt = now;
        return state;
      });
      console.log(
        "[TRACE] account:composer:set",
        JSON.stringify({
          ownerId,
          model: preference.model,
          preset: preference.preset,
          toolCount: preference.tools.length,
          updatedAt: next.composerPreference?.updatedAt ?? now,
        }),
      );
      return jsonResponse({
        preference: next.composerPreference,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      if (message === "owner mismatch") {
        return jsonResponse(
          { error: "owner-mismatch" },
          { status: 403 },
        );
      }
      console.error("[ERROR] account:composer:set failed", error);
      return jsonResponse(
        { error: "invalid-composer-preference-request" },
        { status: 400 },
      );
    }
  }
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export class AccountClient {
  constructor(private readonly stub: DurableObjectStub, private readonly ownerId: string) {}

  async getSnapshot(): Promise<AccountQuotaSnapshot> {
    const params = new URLSearchParams({ ownerId: this.ownerId });
    const response = await this.stub.fetch(
      `https://account/quota?${params.toString()}`,
    );
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new AccountClientError({
        message: "Failed to fetch quota snapshot",
        status: response.status,
        body,
      });
    }
    const data = await parseJsonResponse<{ snapshot: AccountQuotaSnapshot }>(response);
    return data.snapshot;
  }

  async reservePass(input: {
    reservationId: string;
    count?: number;
    conversationId?: string;
    branchId?: string;
  }): Promise<PassReservationResult> {
    const response = await this.stub.fetch("https://account/quota/reserve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: this.ownerId,
        reservationId: input.reservationId,
        count: input.count ?? 1,
        conversationId: input.conversationId ?? null,
        branchId: input.branchId ?? null,
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new AccountClientError({
        message: "Failed to reserve demo pass",
        status: response.status,
        body,
      });
    }
    return parseJsonResponse<PassReservationResult>(response);
  }

  async commitPass(input: { reservationId: string }): Promise<AccountQuotaSnapshot> {
    const response = await this.stub.fetch("https://account/quota/commit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: this.ownerId,
        reservationId: input.reservationId,
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new AccountClientError({
        message: "Failed to commit demo pass",
        status: response.status,
        body,
      });
    }
    const data = await parseJsonResponse<{ snapshot: AccountQuotaSnapshot }>(response);
    return data.snapshot;
  }

  async releasePass(input: { reservationId: string }): Promise<AccountQuotaSnapshot> {
    const response = await this.stub.fetch("https://account/quota/release", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: this.ownerId,
        reservationId: input.reservationId,
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new AccountClientError({
        message: "Failed to release demo pass",
        status: response.status,
        body,
      });
    }
    const data = await parseJsonResponse<{ snapshot: AccountQuotaSnapshot }>(response);
    return data.snapshot;
  }

  async getByokKey(): Promise<AccountByokCredential | null> {
    const params = new URLSearchParams({ ownerId: this.ownerId });
    const response = await this.stub.fetch(`https://account/byok?${params.toString()}`);
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new AccountClientError({
        message: "Failed to fetch BYOK key",
        status: response.status,
        body,
      });
    }
    const data = await parseJsonResponse<{ byok: AccountByokCredential | null }>(response);
    return data.byok;
  }

  async setByokKey(input: {
    provider: string;
    ciphertext: string;
    iv: string;
    version: string;
  }): Promise<AccountByokCredential> {
    const response = await this.stub.fetch("https://account/byok", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: this.ownerId,
        provider: input.provider,
        ciphertext: input.ciphertext,
        iv: input.iv,
        version: input.version,
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new AccountClientError({
        message: "Failed to save BYOK key",
        status: response.status,
        body,
      });
    }
    const data = await parseJsonResponse<{ byok: AccountByokCredential }>(response);
    return data.byok;
  }

  async clearByokKey(): Promise<void> {
    const response = await this.stub.fetch("https://account/byok", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: this.ownerId,
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new AccountClientError({
        message: "Failed to clear BYOK key",
        status: response.status,
        body,
      });
    }
  }

  async getComposerPreference(): Promise<AccountComposerPreference | null> {
    const params = new URLSearchParams({ ownerId: this.ownerId });
    const response = await this.stub.fetch(
      `https://account/preferences/composer?${params.toString()}`,
    );
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new AccountClientError({
        message: "Failed to fetch composer preference",
        status: response.status,
        body,
      });
    }
    const data = await parseJsonResponse<{
      preference: AccountComposerPreference | null;
    }>(response);
    return data.preference;
  }

  async setComposerPreference(input: {
    model: string;
    reasoningEffort?: "low" | "medium" | "high" | null;
    preset?: ComposerPreset;
    tools?: ConversationComposerTool[];
  }): Promise<AccountComposerPreference> {
    const response = await this.stub.fetch("https://account/preferences/composer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: this.ownerId,
        model: input.model,
        reasoningEffort: input.reasoningEffort ?? null,
        preset: input.preset ?? "custom",
        tools: input.tools ?? [],
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new AccountClientError({
        message: "Failed to save composer preference",
        status: response.status,
        body,
      });
    }
    const data = await parseJsonResponse<{
      preference: AccountComposerPreference | null;
    }>(response);
    if (!data.preference) {
      throw new Error("Composer preference was missing from response");
    }
    return data.preference;
  }
}

export function getAccountStub(
  namespace: DurableObjectNamespace,
  ownerId: string,
): DurableObjectStub {
  const durableId = namespace.idFromName(`account:${ownerId}`);
  return namespace.get(durableId);
}
