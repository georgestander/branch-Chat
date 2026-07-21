import {
  isOpenRouterModel,
  OPENROUTER_WEB_SEARCH_SUFFIX,
  stripOpenRouterPrefix,
} from "@/lib/openrouter/models";
import type { ReasoningEffort } from "@/lib/conversation";

export interface ChatGPTModelOption {
  id: "gpt-5.6-terra" | "gpt-5.6-luna" | "gpt-5.6-sol";
  label: string;
  description: string;
  defaultReasoningEffort: ReasoningEffort;
  supportedReasoningEfforts: readonly ReasoningEffort[];
}

const STANDARD_GPT_56_REASONING_EFFORTS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const satisfies readonly ReasoningEffort[];

const ULTRA_GPT_56_REASONING_EFFORTS = [
  ...STANDARD_GPT_56_REASONING_EFFORTS,
  "ultra",
] as const satisfies readonly ReasoningEffort[];

export const CHATGPT_MODEL_OPTIONS: readonly ChatGPTModelOption[] = [
  {
    id: "gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    description: "Balanced everyday model",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ULTRA_GPT_56_REASONING_EFFORTS,
  },
  {
    id: "gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    description: "Fast and efficient model",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: STANDARD_GPT_56_REASONING_EFFORTS,
  },
  {
    id: "gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    description: "Frontier capability model",
    defaultReasoningEffort: "low",
    supportedReasoningEfforts: ULTRA_GPT_56_REASONING_EFFORTS,
  },
];

export const REASONING_EFFORT_LABELS: Record<ReasoningEffort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "XHigh",
  max: "Max",
  ultra: "Ultra",
};

export function getChatGPTModelOption(
  model?: string | null,
): ChatGPTModelOption | null {
  if (!model) return null;
  return CHATGPT_MODEL_OPTIONS.find((option) => option.id === model) ?? null;
}

export function resolveReasoningEffortForModel(
  model: string,
  preferredEffort?: ReasoningEffort | null,
): ReasoningEffort {
  const option = getChatGPTModelOption(model);
  if (!option) return preferredEffort ?? "low";
  if (
    preferredEffort &&
    option.supportedReasoningEfforts.includes(preferredEffort)
  ) {
    return preferredEffort;
  }
  if (
    preferredEffort === "ultra" &&
    option.supportedReasoningEfforts.includes("max")
  ) {
    return "max";
  }
  return option.defaultReasoningEffort;
}

export type WebSearchToolType = "web_search" | "web_search_preview";

export function getWebSearchToolTypeForModel(
  model?: string | null,
): WebSearchToolType | null {
  if (!model || model.length === 0) {
    return "web_search_preview";
  }

  const normalized = model.trim().toLowerCase();

  if (isOpenRouterModel(normalized)) {
    return null;
  }

  if (normalized.startsWith("gpt-5-chat")) {
    return "web_search";
  }

  if (normalized.startsWith("gpt-5-mini")) {
    return "web_search";
  }

  if (
    normalized === "gpt-5" ||
    normalized.startsWith("gpt-5-") ||
    normalized.startsWith("gpt-5.")
  ) {
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

  return (
    modelId === "gpt-5" ||
    modelId.startsWith("gpt-5-") ||
    modelId.startsWith("gpt-5.")
  );
}
