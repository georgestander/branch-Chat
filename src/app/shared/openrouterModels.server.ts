"use server";

import type { AppContext } from "@/app/context";
import {
  isByokConfigured,
  resolveByokCredential,
} from "@/app/shared/account.server";
import {
  type OpenRouterModelOption,
  withOpenRouterPrefix,
} from "@/lib/openrouter/models";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 64;

const FALLBACK_MODELS: OpenRouterModelOption[] = [
  {
    id: withOpenRouterPrefix("openrouter/auto"),
    rawId: "openrouter/auto",
    name: "OpenRouter Auto",
    description: "Automatic model routing",
    contextLength: null,
    isFree: false,
  },
  {
    id: withOpenRouterPrefix("meta-llama/llama-3.3-70b-instruct"),
    rawId: "meta-llama/llama-3.3-70b-instruct",
    name: "Llama 3.3 70B Instruct",
    description: null,
    contextLength: null,
    isFree: false,
  },
  {
    id: withOpenRouterPrefix("google/gemini-2.0-flash-001"),
    rawId: "google/gemini-2.0-flash-001",
    name: "Gemini 2.0 Flash",
    description: null,
    contextLength: null,
    isFree: false,
  },
];

type CachedModels = {
  models: OpenRouterModelOption[];
  expiresAt: number;
  lastAccessedAt: number;
};

const cache = new Map<string, CachedModels>();

function pruneModelCache(now: number): {
  expiredEvictions: number;
  sizeEvictions: number;
} {
  let expiredEvictions = 0;
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
      expiredEvictions += 1;
    }
  }

  let sizeEvictions = 0;
  if (cache.size > MAX_CACHE_ENTRIES) {
    const overflow = cache.size - MAX_CACHE_ENTRIES;
    const evictionCandidates = [...cache.entries()].sort(
      (left, right) => left[1].lastAccessedAt - right[1].lastAccessedAt,
    );
    for (let index = 0; index < overflow; index += 1) {
      const candidate = evictionCandidates[index];
      if (!candidate) {
        break;
      }
      cache.delete(candidate[0]);
      sizeEvictions += 1;
    }
  }

  return {
    expiredEvictions,
    sizeEvictions,
  };
}

function parseNumericPrice(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : null;
}

function toModelOption(entry: Record<string, unknown>): OpenRouterModelOption | null {
  const rawId =
    typeof entry.id === "string" && entry.id.trim().length > 0
      ? entry.id.trim()
      : null;
  if (!rawId) {
    return null;
  }

  const pricing =
    entry.pricing && typeof entry.pricing === "object"
      ? (entry.pricing as Record<string, unknown>)
      : {};

  const promptPrice = parseNumericPrice(pricing.prompt);
  const completionPrice = parseNumericPrice(pricing.completion);
  const isFree =
    rawId.includes(":free") ||
    ((promptPrice ?? 1) <= 0 && (completionPrice ?? 1) <= 0);

  return {
    id: withOpenRouterPrefix(rawId),
    rawId,
    name:
      typeof entry.name === "string" && entry.name.trim().length > 0
        ? entry.name.trim()
        : rawId,
    description:
      typeof entry.description === "string" && entry.description.trim().length > 0
        ? entry.description.trim()
        : null,
    contextLength:
      typeof entry.context_length === "number" &&
      Number.isFinite(entry.context_length)
        ? entry.context_length
        : null,
    isFree,
  };
}

function dedupeModels(models: OpenRouterModelOption[]): OpenRouterModelOption[] {
  const seen = new Set<string>();
  const next: OpenRouterModelOption[] = [];
  for (const model of models) {
    if (seen.has(model.id)) {
      continue;
    }
    seen.add(model.id);
    next.push(model);
  }
  return next;
}

function sortModels(models: OpenRouterModelOption[]): OpenRouterModelOption[] {
  return [...models].sort((a, b) => {
    if (a.isFree !== b.isFree) {
      return a.isFree ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

async function resolveOpenRouterCatalogApiKey(ctx: AppContext): Promise<{
  apiKey: string | null;
  source: "env" | "byok" | "none";
}> {
  const envApiKey = ctx.env.OPENROUTER_API_KEY?.trim();
  if (envApiKey) {
    return {
      apiKey: envApiKey,
      source: "env",
    };
  }

  if (!isByokConfigured(ctx)) {
    return {
      apiKey: null,
      source: "none",
    };
  }

  try {
    const credential = await resolveByokCredential(ctx);
    if (!credential) {
      return {
        apiKey: null,
        source: "none",
      };
    }

    if (credential.provider.trim().toLowerCase() !== "openrouter") {
      return {
        apiKey: null,
        source: "none",
      };
    }

    return {
      apiKey: credential.apiKey,
      source: "byok",
    };
  } catch (error) {
    ctx.trace("openrouter:models:byok-resolve-error", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return {
      apiKey: null,
      source: "none",
    };
  }
}

export async function listOpenRouterModels(
  ctx: AppContext,
): Promise<OpenRouterModelOption[]> {
  const apiKeyResolution = await resolveOpenRouterCatalogApiKey(ctx);
  if (!apiKeyResolution.apiKey) {
    // Allow BYOK flows to still select OpenRouter models even if demo key is unset.
    ctx.trace("openrouter:models:fallback", {
      reason: "missing-openrouter-api-key",
      fallbackCount: FALLBACK_MODELS.length,
    });
    return FALLBACK_MODELS;
  }

  const cacheKey =
    apiKeyResolution.source === "env"
      ? "env"
      : apiKeyResolution.source === "byok"
        ? `byok:${ctx.auth.userId}`
        : "fallback";

  const now = Date.now();
  const pruned = pruneModelCache(now);
  if (pruned.expiredEvictions > 0 || pruned.sizeEvictions > 0) {
    ctx.trace("openrouter:models:cache-pruned", {
      expiredEvictions: pruned.expiredEvictions,
      sizeEvictions: pruned.sizeEvictions,
      size: cache.size,
    });
  }

  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    cached.lastAccessedAt = now;
    cache.set(cacheKey, cached);
    ctx.trace("openrouter:models:cache-hit", {
      source: apiKeyResolution.source,
      count: cached.models.length,
    });
    return cached.models;
  }

  try {
    const headers: HeadersInit = {
      accept: "application/json",
    };
    headers.authorization = `Bearer ${apiKeyResolution.apiKey}`;

    const response = await fetch(OPENROUTER_MODELS_URL, {
      method: "GET",
      headers,
    });
    if (!response.ok) {
      throw new Error(`OpenRouter models request failed: ${response.status}`);
    }

    const payload = (await response.json()) as {
      data?: unknown[];
    };

    const mapped = Array.isArray(payload.data)
      ? payload.data
          .map((entry) =>
            entry && typeof entry === "object"
              ? toModelOption(entry as Record<string, unknown>)
              : null,
          )
          .filter((entry): entry is OpenRouterModelOption => Boolean(entry))
      : [];

    const models = sortModels(dedupeModels(mapped));

    if (models.length === 0) {
      throw new Error("OpenRouter models payload was empty");
    }

    cache.set(cacheKey, {
      models,
      expiresAt: now + CACHE_TTL_MS,
      lastAccessedAt: now,
    });

    ctx.trace("openrouter:models:fetched", {
      source: apiKeyResolution.source,
      count: models.length,
      payloadCount: Array.isArray(payload.data) ? payload.data.length : 0,
    });

    return models;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "unknown";
    if (
      errorMessage.includes(" 401") ||
      errorMessage.includes(" 403")
    ) {
      ctx.trace("openrouter:models:disabled", {
        source: apiKeyResolution.source,
        reason: "authentication-failed",
        error: errorMessage,
      });
      cache.set(cacheKey, {
        models: [],
        expiresAt: now + CACHE_TTL_MS,
        lastAccessedAt: now,
      });
      return [];
    }

    ctx.trace("openrouter:models:fallback", {
      source: apiKeyResolution.source,
      error: errorMessage,
      fallbackCount: FALLBACK_MODELS.length,
    });
    cache.set(cacheKey, {
      models: FALLBACK_MODELS,
      expiresAt: now + CACHE_TTL_MS,
      lastAccessedAt: now,
    });
    return FALLBACK_MODELS;
  }
}
