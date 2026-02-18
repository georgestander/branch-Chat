import type { AppContext } from "@/app/context";
import {
  type AccountByokCredential,
  type AccountComposerPreference,
} from "@/lib/durable-objects/Account";
import {
  decryptByokApiKey,
  encryptByokApiKey,
} from "@/app/shared/byokCrypto.server";
import type { ComposerPreset } from "@/lib/conversation";
import type { ConversationComposerTool } from "@/lib/conversation/tools";

function getClient(ctx: AppContext) {
  return ctx.getAccount();
}

export function isByokConfigured(ctx: AppContext): boolean {
  return (
    typeof ctx.env.BYOK_ENCRYPTION_SECRET === "string" &&
    ctx.env.BYOK_ENCRYPTION_SECRET.trim().length > 0
  );
}

export interface ResolvedByokCredential {
  provider: string;
  apiKey: string;
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

function normalizeComposerModel(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("model is required");
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new TypeError("model is required");
  }
  return normalized;
}

function normalizeComposerReasoningEffort(
  value: unknown,
): "low" | "medium" | "high" | null {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }
  return null;
}

function normalizeComposerPreset(value: unknown): ComposerPreset {
  return value === "fast" ||
    value === "reasoning" ||
    value === "study" ||
    value === "custom"
    ? value
    : "custom";
}

function normalizeComposerTools(value: unknown): ConversationComposerTool[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const tools: ConversationComposerTool[] = [];
  for (const entry of value) {
    if (
      (entry === "study-and-learn" ||
        entry === "web-search" ||
        entry === "file-upload") &&
      !tools.includes(entry)
    ) {
      tools.push(entry);
    }
  }
  return tools;
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

export interface ComposerPreferenceInput {
  model: string;
  reasoningEffort?: "low" | "medium" | "high" | null;
  preset?: ComposerPreset;
  tools?: ConversationComposerTool[];
}

export async function getComposerPreference(
  ctx: AppContext,
): Promise<AccountComposerPreference | null> {
  try {
    const preference = await getClient(ctx).getComposerPreference();
    console.log(
      "[TRACE] account:composer:status",
      JSON.stringify({
        ownerId: ctx.auth.userId,
        hasPreference: Boolean(preference),
        model: preference?.model ?? null,
        preset: preference?.preset ?? null,
        updatedAt: preference?.updatedAt ?? null,
      }),
    );
    return preference;
  } catch (error) {
    console.error(
      "[ERROR] account:composer:status failed",
      JSON.stringify({
        ownerId: ctx.auth.userId,
        message: error instanceof Error ? error.message : "unknown",
      }),
    );
    throw new Error("Failed to load composer preference");
  }
}

export async function saveComposerPreference(
  ctx: AppContext,
  input: ComposerPreferenceInput,
): Promise<AccountComposerPreference> {
  const model = normalizeComposerModel(input.model);
  const reasoningEffort = normalizeComposerReasoningEffort(input.reasoningEffort);
  const preset = normalizeComposerPreset(input.preset);
  const tools = normalizeComposerTools(input.tools);
  try {
    const preference = await getClient(ctx).setComposerPreference({
      model,
      reasoningEffort,
      preset,
      tools,
    });
    console.log(
      "[TRACE] account:composer:save",
      JSON.stringify({
        ownerId: ctx.auth.userId,
        model: preference.model,
        preset: preference.preset,
        toolCount: preference.tools.length,
        updatedAt: preference.updatedAt,
      }),
    );
    return preference;
  } catch (error) {
    console.error(
      "[ERROR] account:composer:save failed",
      JSON.stringify({
        ownerId: ctx.auth.userId,
        model,
        message: error instanceof Error ? error.message : "unknown",
      }),
    );
    throw new Error("Failed to save composer preference");
  }
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
  if (!isByokConfigured(ctx)) {
    throw new Error(
      "BYOK is not configured in this environment. Add BYOK_ENCRYPTION_SECRET to your worker/.dev.vars.",
    );
  }

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
    const message = error instanceof Error ? error.message : "unknown";
    console.error(
      "[ERROR] account:byok:save failed",
      JSON.stringify({
        ownerId: ctx.auth.userId,
        provider,
        message,
      }),
    );
    if (message.includes("BYOK secret is missing")) {
      throw new Error(
        "BYOK is not configured in this environment. Add BYOK_ENCRYPTION_SECRET to your worker/.dev.vars.",
      );
    }
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
  const credential = await resolveByokCredential(ctx);
  return credential?.apiKey ?? null;
}

export async function resolveByokCredential(
  ctx: AppContext,
): Promise<ResolvedByokCredential | null> {
  if (!isByokConfigured(ctx)) {
    throw new Error(
      "BYOK is not configured in this environment. Add BYOK_ENCRYPTION_SECRET to your worker/.dev.vars.",
    );
  }

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
    return {
      provider: byok.provider,
      apiKey,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    console.error(
      "[ERROR] account:byok:resolve failed",
      JSON.stringify({
        ownerId: ctx.auth.userId,
        message,
      }),
    );
    if (message.includes("BYOK secret is missing")) {
      throw new Error(
        "BYOK is not configured in this environment. Add BYOK_ENCRYPTION_SECRET to your worker/.dev.vars.",
      );
    }
    throw new Error("Failed to resolve BYOK key");
  }
}
