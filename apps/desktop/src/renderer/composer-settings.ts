import type {
  ComposerPreset,
  ReasoningEffort,
} from "@branchy/conversation-core";
import type { ConversationComposerTool } from "@branchy/conversation-core/tools";

export type ComposerSettingsSelection = {
  model: string;
  reasoningEffort: ReasoningEffort | null;
  preset: ComposerPreset;
  tools: ConversationComposerTool[];
};

export type ComposerSettingsChangeHandler = (
  settings: ComposerSettingsSelection,
) => void | Promise<void>;

export type ComposerModelOption = {
  id: string;
  label: string;
  description: string;
  defaultReasoningEffort: ReasoningEffort;
  supportedReasoningEfforts: readonly ReasoningEffort[];
};

const STANDARD_REASONING_EFFORTS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const satisfies readonly ReasoningEffort[];

const ULTRA_REASONING_EFFORTS = [
  ...STANDARD_REASONING_EFFORTS,
  "ultra",
] as const satisfies readonly ReasoningEffort[];

export const COMPOSER_MODEL_OPTIONS: readonly ComposerModelOption[] = [
  {
    id: "gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    description: "Balanced everyday model",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ULTRA_REASONING_EFFORTS,
  },
  {
    id: "gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    description: "Fast and efficient model",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: STANDARD_REASONING_EFFORTS,
  },
  {
    id: "gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    description: "Frontier capability model",
    defaultReasoningEffort: "low",
    supportedReasoningEfforts: ULTRA_REASONING_EFFORTS,
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

export const COMPOSER_PRESET_DEFAULTS: Record<
  Exclude<ComposerPreset, "custom">,
  ComposerSettingsSelection
> = {
  fast: {
    model: "gpt-5.6-terra",
    reasoningEffort: "medium",
    preset: "fast",
    tools: ["web-search"],
  },
  reasoning: {
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
    preset: "reasoning",
    tools: ["web-search"],
  },
  study: {
    model: "gpt-5.6-sol",
    reasoningEffort: "medium",
    preset: "study",
    tools: ["study-and-learn", "web-search"],
  },
};

export const DEFAULT_COMPOSER_SETTINGS: ComposerSettingsSelection =
  COMPOSER_PRESET_DEFAULTS.fast;

const ALLOWED_TOOLS = new Set<ConversationComposerTool>([
  "study-and-learn",
  "web-search",
  "file-upload",
]);

function sanitizeTools(
  tools: readonly ConversationComposerTool[],
): ConversationComposerTool[] {
  const sanitized: ConversationComposerTool[] = [];
  for (const tool of tools) {
    if (ALLOWED_TOOLS.has(tool) && !sanitized.includes(tool)) {
      sanitized.push(tool);
    }
  }
  return sanitized;
}

function sameTools(
  left: readonly ConversationComposerTool[],
  right: readonly ConversationComposerTool[],
): boolean {
  return (
    left.length === right.length &&
    left.every((tool, index) => tool === right[index])
  );
}

export function composerModelOption(
  model: string,
): ComposerModelOption | null {
  return COMPOSER_MODEL_OPTIONS.find((option) => option.id === model) ?? null;
}

export function composerModelLabel(model: string): string {
  return composerModelOption(model)?.label ?? model;
}

export function reasoningEffortsForModel(
  model: string,
): readonly ReasoningEffort[] {
  return (
    composerModelOption(model)?.supportedReasoningEfforts ??
    STANDARD_REASONING_EFFORTS
  );
}

export function resolveReasoningEffort(
  model: string,
  preferred: ReasoningEffort | null,
): ReasoningEffort {
  const option = composerModelOption(model);
  if (!option) return preferred ?? "low";
  if (preferred && option.supportedReasoningEfforts.includes(preferred)) {
    return preferred;
  }
  if (
    preferred === "ultra" &&
    option.supportedReasoningEfforts.includes("max")
  ) {
    return "max";
  }
  return option.defaultReasoningEffort;
}

export function inferComposerPreset(
  settings: Pick<
    ComposerSettingsSelection,
    "model" | "reasoningEffort" | "tools"
  >,
): ComposerPreset {
  const tools = sanitizeTools(settings.tools);

  for (const preset of ["fast", "reasoning", "study"] as const) {
    const defaults = COMPOSER_PRESET_DEFAULTS[preset];
    if (
      settings.model === defaults.model &&
      resolveReasoningEffort(settings.model, settings.reasoningEffort) ===
        defaults.reasoningEffort &&
      sameTools(tools, defaults.tools)
    ) {
      return preset;
    }
  }

  return "custom";
}

export function normalizeComposerSettings(
  settings: ComposerSettingsSelection | undefined,
): ComposerSettingsSelection {
  if (!settings) {
    return {
      ...DEFAULT_COMPOSER_SETTINGS,
      tools: [...DEFAULT_COMPOSER_SETTINGS.tools],
    };
  }

  const normalized = {
    model: settings.model,
    reasoningEffort: resolveReasoningEffort(
      settings.model,
      settings.reasoningEffort,
    ),
    tools: sanitizeTools(settings.tools),
  };

  return {
    ...normalized,
    preset:
      settings.preset === "custom"
        ? inferComposerPreset(normalized)
        : settings.preset,
  };
}

export function settingsForPreset(
  preset: Exclude<ComposerPreset, "custom">,
): ComposerSettingsSelection {
  const defaults = COMPOSER_PRESET_DEFAULTS[preset];
  return {
    ...defaults,
    tools: [...defaults.tools],
  };
}

export function settingsForModel(
  current: ComposerSettingsSelection,
  model: string,
): ComposerSettingsSelection {
  const next = {
    model,
    reasoningEffort: resolveReasoningEffort(model, current.reasoningEffort),
    tools: sanitizeTools(current.tools),
  };
  return {
    ...next,
    preset: inferComposerPreset(next),
  };
}

export function settingsForReasoningEffort(
  current: ComposerSettingsSelection,
  reasoningEffort: ReasoningEffort,
): ComposerSettingsSelection {
  const next = {
    model: current.model,
    reasoningEffort: resolveReasoningEffort(
      current.model,
      reasoningEffort,
    ),
    tools: sanitizeTools(current.tools),
  };
  return {
    ...next,
    preset: inferComposerPreset(next),
  };
}

export function settingsWithWebSearch(
  current: ComposerSettingsSelection,
  enabled: boolean,
): ComposerSettingsSelection {
  const tools: ConversationComposerTool[] = sanitizeTools(current.tools).filter(
    (tool) => tool !== "web-search",
  );
  if (enabled) tools.push("web-search");
  const next = {
    model: current.model,
    reasoningEffort: current.reasoningEffort,
    tools,
  };
  return {
    ...next,
    preset: inferComposerPreset(next),
  };
}
