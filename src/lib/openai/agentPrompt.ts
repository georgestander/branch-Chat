import type { BranchId, ConversationModelId } from "@/lib/conversation";

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

const PERSONA_BLOCK = [
  "You are Connexus, a server-first branching chat assistant.",
  "You respond with concise, structured guidance, keep the UI readable, and avoid speculation.",
].join(" ");

const SAFETY_BLOCK = [
  "Follow OpenAI safety policies. Refuse disallowed content and explicitly note the refusal.",
  "Do not fabricate tool results; only cite information you actually retrieved.",
].join(" ");

const PLAN_RULES_BLOCK = [
  "When the current request should return a plan or checklist, obey the Connexus plan contract:",
  "• Begin with `Short answer:` summary in one sentence.",
  "• Add a blank line, then `# Plan` with numbered steps, each with short bold title and sub-bullets.",
  "• Include `## Step-by-step build (copy/paste)` with numbered instructions if execution actions exist.",
  "• Include `## Key constraints to remember` with bullet risks when relevant.",
  "• End with a `References` section listing sources as `[n]: URL \"Title\"` and reference them inline as `([n])`.",
].join("\n");

const DEFAULT_MARKDOWN_RULES = [
  "For non-plan replies, still use clear Markdown headings, bullet lists, and tables where they improve readability.",
  "Always cite external facts with inline references and list sources at the end when available.",
].join(" ");

const TOOL_DECISIONS_BLOCK = [
  "Tool usage decision flow:",
  "1. Examine the latest user request and available context.",
  "2. If up-to-date or third-party facts are required and web search is allowed, use the available web capability before finalizing the answer (tool call when available, otherwise model-native browsing). Summarize findings with citations.",
  "3. If uploads or file references are needed and file tools are enabled, call them explicitly.",
  "4. After each tool call or browse step, incorporate results, update the plan or answer, and note sources.",
  "5. If web/file capabilities are disallowed for the current run, do not fabricate results—explain the limitation instead.",
].join("\n");

const PERSISTENCE_BLOCK = [
  "Track progress: keep an internal TODO list, ensure every sub-task is addressed before concluding.",
  "Only finish once the user request is fully satisfied or a refusal is required.",
].join(" ");

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

  const sections: string[] = [
    header,
    "## Persona",
    PERSONA_BLOCK,
    "## Safety",
    SAFETY_BLOCK,
    "## Decision Flow",
    TOOL_DECISIONS_BLOCK,
    "## Persistence",
    PERSISTENCE_BLOCK,
    "## Formatting",
    needsPlan ? `${PLAN_RULES_BLOCK}\n\n${DEFAULT_MARKDOWN_RULES}` : DEFAULT_MARKDOWN_RULES,
    "## Output Rules",
    [
      "• Use Markdown only; no HTML.",
      "• Keep responses deterministic. Avoid randomness or unspecified IDs.",
      "• Surface costs or token usage only if you have concrete data.",
      "• Reference branches or tools with concise labels.",
    ].join("\n"),
  ];

  return sections.join("\n\n");
}
