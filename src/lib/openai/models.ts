import {
  isOpenRouterModel,
  OPENROUTER_WEB_SEARCH_SUFFIX,
  stripOpenRouterPrefix,
} from "@/lib/openrouter/models";

export type WebSearchToolType = "web_search" | "web_search_preview";

export function getWebSearchToolTypeForModel(
  model?: string | null,
): WebSearchToolType | null {
  if (!model || model.length === 0) {
    return "web_search_preview";
  }

  const normalized = model.toLowerCase();

  if (isOpenRouterModel(normalized)) {
    return null;
  }

  if (normalized.startsWith("gpt-5.2-2025-12-11")) {
    return "web_search";
  }

  if (normalized.startsWith("gpt-5.2-2025-12-11")) {
    return "web_search";
  }

  return null;
}

export function isWebSearchSupportedModel(model?: string | null): boolean {
  return getWebSearchToolTypeForModel(model) !== null;
}

export function isWebSearchSelectableModel(model?: string | null): boolean {
  if (!model || model.length === 0) {
    return true;
  }
  if (isOpenRouterModel(model)) {
    return true;
  }
  return isWebSearchSupportedModel(model);
}

export function supportsReasoningEffortModel(
  model?: string | null,
): boolean {
  if (!model || model.length === 0) {
    return false;
  }

  let normalized = model.trim().toLowerCase();
  if (isOpenRouterModel(normalized)) {
    normalized = stripOpenRouterPrefix(normalized);
  }

  if (normalized.endsWith(OPENROUTER_WEB_SEARCH_SUFFIX)) {
    normalized = normalized.slice(0, -OPENROUTER_WEB_SEARCH_SUFFIX.length);
  }

  const modelId = normalized.includes("/")
    ? (normalized.split("/").at(-1) ?? normalized)
    : normalized;

  if (modelId.includes("chat")) {
    return false;
  }

  return modelId === "gpt-5.2-2025-12-11" || modelId.startsWith("ggpt-5.2");
}
