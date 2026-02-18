export const OPENROUTER_MODEL_PREFIX = "openrouter:";
export const OPENROUTER_WEB_SEARCH_SUFFIX = ":online";
export const OPENROUTER_DEFAULT_CHAT_MODEL_CANDIDATES = [
  "openai/chatgpt-4o-latest",
  "openai/gpt-5-chat",
  "openai/gpt-4.1-mini",
  "openai/gpt-4o-mini",
  "openrouter/auto",
] as const;

export interface OpenRouterModelOption {
  id: string;
  rawId: string;
  name: string;
  description?: string | null;
  contextLength?: number | null;
  isFree: boolean;
}

export function isOpenRouterModel(model?: string | null): boolean {
  if (!model) {
    return false;
  }
  const normalized = model.trim().toLowerCase();
  return normalized.startsWith(OPENROUTER_MODEL_PREFIX);
}

export function stripOpenRouterPrefix(model: string): string {
  if (!isOpenRouterModel(model)) {
    return model;
  }
  return model.trim().slice(OPENROUTER_MODEL_PREFIX.length);
}

export function withOpenRouterPrefix(rawModelId: string): string {
  const normalized = rawModelId.trim();
  if (!normalized) {
    return OPENROUTER_MODEL_PREFIX;
  }
  if (isOpenRouterModel(normalized)) {
    return normalized;
  }
  return `${OPENROUTER_MODEL_PREFIX}${normalized}`;
}

function normalizeOpenRouterRawModel(rawModelId?: string | null): string | null {
  if (typeof rawModelId !== "string") {
    return null;
  }
  const normalized = stripOpenRouterPrefix(rawModelId).trim();
  if (!normalized) {
    return null;
  }
  return normalized.endsWith(OPENROUTER_WEB_SEARCH_SUFFIX)
    ? normalized.slice(0, -OPENROUTER_WEB_SEARCH_SUFFIX.length)
    : normalized;
}

export function resolvePreferredOpenRouterChatModel(
  currentModel?: string | null,
): string {
  const normalized = normalizeOpenRouterRawModel(currentModel);
  if (!normalized) {
    return OPENROUTER_DEFAULT_CHAT_MODEL_CANDIDATES[0];
  }

  for (const candidate of OPENROUTER_DEFAULT_CHAT_MODEL_CANDIDATES) {
    if (normalized === candidate) {
      return candidate;
    }
  }

  return OPENROUTER_DEFAULT_CHAT_MODEL_CANDIDATES[0];
}

export function resolveOpenRouterWebSearchModel(
  currentModel?: string | null,
): string {
  const baseModel = resolvePreferredOpenRouterChatModel(currentModel);
  return `${baseModel}${OPENROUTER_WEB_SEARCH_SUFFIX}`;
}
