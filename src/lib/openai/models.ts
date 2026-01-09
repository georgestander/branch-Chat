export type WebSearchToolType = "web_search" | "web_search_preview";

export function getWebSearchToolTypeForModel(
  model?: string | null,
): WebSearchToolType | null {
  if (!model || model.length === 0) {
    return "web_search_preview";
  }

  const normalized = model.toLowerCase();

  if (normalized.startsWith("gpt-5-chat")) {
    return "web_search";
  }

  if (normalized.startsWith("gpt-5-mini")) {
    return "web_search";
  }

  return null;
}

export function isWebSearchSupportedModel(model?: string | null): boolean {
  return getWebSearchToolTypeForModel(model) !== null;
}
