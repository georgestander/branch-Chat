import type { AppContext } from "@/app/context";
import {
  AccountClientError,
  type AccountByokCredential,
  type AccountQuotaSnapshot,
  type PassReservationResult,
} from "@/lib/durable-objects/Account";
import {
  decryptByokApiKey,
  encryptByokApiKey,
} from "@/app/shared/byokCrypto.server";

export class DemoQuotaExceededError extends Error {
  constructor() {
    super(
      "Demo pass limit reached (10/10). Add your own API key to continue.",
    );
    this.name = "DemoQuotaExceededError";
  }
}

function getClient(ctx: AppContext) {
  return ctx.getAccount();
}

function normalizeByokProvider(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("provider is required");
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new TypeError("provider is required");
  }
  return normalized;
}

function normalizeByokApiKey(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("apiKey is required");
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new TypeError("apiKey is required");
  }
  return normalized;
}

function toByokStatus(byok: AccountByokCredential | null): {
  provider: string | null;
  connected: boolean;
  updatedAt: string | null;
} {
  if (!byok) {
    return {
      provider: null,
      connected: false,
      updatedAt: null,
    };
  }
  return {
    provider: byok.provider,
    connected: true,
    updatedAt: byok.updatedAt,
  };
}

export async function getAccountQuotaSnapshot(
  ctx: AppContext,
): Promise<AccountQuotaSnapshot> {
  return getClient(ctx).getSnapshot();
}

export async function reserveDemoPass(
  ctx: AppContext,
  input: {
    reservationId: string;
    conversationId?: string;
    branchId?: string;
  },
): Promise<PassReservationResult> {
  try {
    return await getClient(ctx).reservePass({
      reservationId: input.reservationId,
      count: 1,
      conversationId: input.conversationId,
      branchId: input.branchId,
    });
  } catch (error) {
    if (error instanceof AccountClientError && error.status === 409) {
      throw new DemoQuotaExceededError();
    }
    throw error;
  }
}

export async function commitDemoPass(
  ctx: AppContext,
  input: { reservationId: string },
): Promise<AccountQuotaSnapshot> {
  return getClient(ctx).commitPass(input);
}

export async function releaseDemoPass(
  ctx: AppContext,
  input: { reservationId: string },
): Promise<AccountQuotaSnapshot> {
  return getClient(ctx).releasePass(input);
}

export async function getByokStatus(ctx: AppContext): Promise<{
  provider: string | null;
  connected: boolean;
  updatedAt: string | null;
}> {
  const byok = await getClient(ctx).getByokKey();
  const status = toByokStatus(byok);
  console.log(
    "[TRACE] account:byok:status",
    JSON.stringify({
      ownerId: ctx.auth.userId,
      provider: status.provider,
      connected: status.connected,
      updatedAt: status.updatedAt,
    }),
  );
  return status;
}

export async function saveByokKey(
  ctx: AppContext,
  input: { provider: string; apiKey: string },
): Promise<{
  provider: string | null;
  connected: boolean;
  updatedAt: string | null;
}> {
  const provider = normalizeByokProvider(input.provider);
  const apiKey = normalizeByokApiKey(input.apiKey);

  try {
    const encrypted = await encryptByokApiKey({
      secret: ctx.env.BYOK_ENCRYPTION_SECRET,
      plaintext: apiKey,
    });
    const byok = await getClient(ctx).setByokKey({
      provider,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      version: encrypted.version,
    });
    const status = toByokStatus(byok);
    console.log(
      "[TRACE] account:byok:save",
      JSON.stringify({
        ownerId: ctx.auth.userId,
        provider: status.provider,
        connected: status.connected,
        updatedAt: status.updatedAt,
      }),
    );
    return status;
  } catch (error) {
    console.error(
      "[ERROR] account:byok:save failed",
      JSON.stringify({
        ownerId: ctx.auth.userId,
        provider,
        message: error instanceof Error ? error.message : "unknown",
      }),
    );
    throw new Error("Failed to save BYOK key");
  }
}

export async function deleteByokKey(ctx: AppContext): Promise<void> {
  try {
    await getClient(ctx).clearByokKey();
    console.log(
      "[TRACE] account:byok:delete",
      JSON.stringify({
        ownerId: ctx.auth.userId,
      }),
    );
  } catch (error) {
    console.error(
      "[ERROR] account:byok:delete failed",
      JSON.stringify({
        ownerId: ctx.auth.userId,
        message: error instanceof Error ? error.message : "unknown",
      }),
    );
    throw new Error("Failed to delete BYOK key");
  }
}

export async function resolveByokKey(
  ctx: AppContext,
): Promise<string | null> {
  try {
    const byok = await getClient(ctx).getByokKey();
    if (!byok) {
      console.log(
        "[TRACE] account:byok:resolve",
        JSON.stringify({
          ownerId: ctx.auth.userId,
          connected: false,
        }),
      );
      return null;
    }
    const apiKey = await decryptByokApiKey({
      secret: ctx.env.BYOK_ENCRYPTION_SECRET,
      ciphertext: byok.ciphertext,
      iv: byok.iv,
      version: byok.version,
    });
    console.log(
      "[TRACE] account:byok:resolve",
      JSON.stringify({
        ownerId: ctx.auth.userId,
        connected: true,
        provider: byok.provider,
        updatedAt: byok.updatedAt,
      }),
    );
    return apiKey;
  } catch (error) {
    console.error(
      "[ERROR] account:byok:resolve failed",
      JSON.stringify({
        ownerId: ctx.auth.userId,
        message: error instanceof Error ? error.message : "unknown",
      }),
    );
    throw new Error("Failed to resolve BYOK key");
  }
}
