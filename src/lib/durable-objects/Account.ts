const STORAGE_KEY = "account.state.v1";
const DEFAULT_DEMO_TOTAL_PASSES = 10;

type ReservationStatus = "reserved" | "committed" | "released";

interface PassReservation {
  id: string;
  count: number;
  createdAt: string;
  conversationId?: string | null;
  branchId?: string | null;
  status: ReservationStatus;
}

interface AccountState {
  ownerId: string;
  demo: {
    total: number;
    used: number;
    reserved: number;
  };
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

  const totalCandidate = Number(stored.demo?.total);
  const usedCandidate = Number(stored.demo?.used);
  const total =
    Number.isFinite(totalCandidate) && totalCandidate > 0
      ? Math.floor(totalCandidate)
      : DEFAULT_DEMO_TOTAL_PASSES;
  const used =
    Number.isFinite(usedCandidate) && usedCandidate >= 0
      ? Math.floor(usedCandidate)
      : 0;

  return {
    ownerId: normalizedOwnerId,
    demo: {
      total,
      used,
      reserved: recalculatedReserved,
    },
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
}

export function getAccountStub(
  namespace: DurableObjectNamespace,
  ownerId: string,
): DurableObjectStub {
  const durableId = namespace.idFromName(`account:${ownerId}`);
  return namespace.get(durableId);
}
