"use server";

import type { AppContext } from "@/app/context";
import {
  type OpenRouterModelOption,
  withOpenRouterPrefix,
} from "@/lib/openrouter/models";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_SELECTOR_MODELS = 24;

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
};

let cache: CachedModels | null = null;

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

export async function listOpenRouterModels(
  ctx: AppContext,
): Promise<OpenRouterModelOption[]> {
  if (!ctx.env.OPENROUTER_API_KEY) {
    ctx.trace("openrouter:models:disabled", {
      reason: "missing-openrouter-api-key",
    });
    return [];
  }

  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    ctx.trace("openrouter:models:cache-hit", {
      count: cache.models.length,
    });
    return cache.models;
  }

  try {
    const headers: HeadersInit = {
      accept: "application/json",
    };
    headers.authorization = `Bearer ${ctx.env.OPENROUTER_API_KEY}`;

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

    const models = sortModels(dedupeModels(mapped)).slice(0, MAX_SELECTOR_MODELS);

    if (models.length === 0) {
      throw new Error("OpenRouter models payload was empty");
    }

    cache = {
      models,
      expiresAt: now + CACHE_TTL_MS,
    };

    ctx.trace("openrouter:models:fetched", {
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
        reason: "authentication-failed",
        error: errorMessage,
      });
      cache = {
        models: [],
        expiresAt: now + CACHE_TTL_MS,
      };
      return [];
    }

    ctx.trace("openrouter:models:fallback", {
      error: errorMessage,
      fallbackCount: FALLBACK_MODELS.length,
    });
    cache = {
      models: FALLBACK_MODELS,
      expiresAt: now + CACHE_TTL_MS,
    };
    return FALLBACK_MODELS;
  }
}
