export function isWebSearchSupportedModel(model?: string | null): boolean {
  if (!model || model.length === 0) {
    return true;
  }

  const normalized = model.toLowerCase();

  if (normalized.startsWith("gpt-5-chat")) {
    return true;
  }

  if (normalized.startsWith("gpt-5-mini")) {
    return true;
  }

  return false;
}
