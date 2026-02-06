export const OPENROUTER_MODEL_PREFIX = "openrouter:";

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
