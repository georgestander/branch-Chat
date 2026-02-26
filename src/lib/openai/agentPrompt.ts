import type { BranchId, ConversationModelId } from "@/lib/conversation";

import CONNEXUS_BASE_PROMPT_RAW from "./prompts/connexus.base.md?raw";
import CONNEXUS_PLAN_PROMPT_RAW from "./prompts/connexus.plan.md?raw";

export interface AgentPromptContext {
  conversationId: ConversationModelId;
  branchId: BranchId;
  needsPlan: boolean;
  allowWebSearch: boolean;
  allowFileTools: boolean;
  userLocale?: string | null;
  costSummary?: string | null;
  safetyMode?: "default" | "strict";
}

function normalizePrompt(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

const CONNEXUS_BASE_PROMPT = normalizePrompt(CONNEXUS_BASE_PROMPT_RAW);
const CONNEXUS_PLAN_PROMPT = normalizePrompt(CONNEXUS_PLAN_PROMPT_RAW);

export function buildAgentInstructions(context: AgentPromptContext): string {
  const {
    needsPlan,
    allowWebSearch,
    allowFileTools,
    userLocale,
    costSummary,
    safetyMode,
    conversationId,
    branchId,
  } = context;

  const header = [
    `<conversation id="${conversationId}">`,
    `<branch id="${branchId}">`,
    `<safety mode="${safetyMode ?? "default"}">`,
    `<locale>${(userLocale ?? "en-US").toLowerCase()}</locale>`,
    allowWebSearch ? "<web_search enabled=\"true\" />" : "<web_search enabled=\"false\" />",
    allowFileTools ? "<file_tools enabled=\"true\" />" : "<file_tools enabled=\"false\" />",
    costSummary ? `<cost>${costSummary}</cost>` : null,
    "</safety>",
    "</branch>",
    "</conversation>",
  ]
    .filter(Boolean)
    .join("");

  const sections: Array<string | null> = [
    header,
    CONNEXUS_BASE_PROMPT,
    needsPlan ? CONNEXUS_PLAN_PROMPT : null,
  ];

  return sections
    .filter((value): value is string => Boolean(value))
    .join("\n\n");
}
