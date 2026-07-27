export const DEFAULT_CONVERSATION_TITLE = "New conversation";
export const MAX_CONVERSATION_TITLE_CHARACTERS = 60;

function compact(value: string): string {
  return value
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/^(?:#{1,6}|[-*+>]|\d+[.)])\s+/u, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function truncateAtWord(value: string): string {
  if (value.length <= MAX_CONVERSATION_TITLE_CHARACTERS) {
    return value;
  }
  const prefix = value.slice(0, MAX_CONVERSATION_TITLE_CHARACTERS - 1);
  const boundary = prefix.lastIndexOf(" ");
  const truncated =
    boundary >= Math.floor(MAX_CONVERSATION_TITLE_CHARACTERS * 0.6)
      ? prefix.slice(0, boundary)
      : prefix;
  return `${truncated.trimEnd()}…`;
}

export function fallbackConversationTitle(userMessage: string): string {
  const normalized = compact(userMessage);
  if (!normalized) {
    return DEFAULT_CONVERSATION_TITLE;
  }
  const firstSentence =
    normalized.match(/^.*?[.!?](?:\s|$)/u)?.[0]?.trim() ?? normalized;
  return truncateAtWord(firstSentence.replace(/[.!?]+$/u, "").trim());
}

export function sanitizeGeneratedConversationTitle(value: string): string | null {
  const firstLine = value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) {
    return null;
  }
  const normalized = compact(firstLine)
    .replace(/^title\s*:\s*/iu, "")
    .replace(/^["'“‘]+|["'”’]+$/gu, "")
    .replace(/[.!?,;:]+$/u, "")
    .trim();
  if (
    !normalized ||
    normalized.toLocaleLowerCase("en-US") ===
      DEFAULT_CONVERSATION_TITLE.toLocaleLowerCase("en-US")
  ) {
    return null;
  }
  return truncateAtWord(normalized.split(/\s+/u).slice(0, 6).join(" "));
}

export function conversationTitlePrompt(
  userMessage: string,
  assistantMessage: string,
): string {
  const boundedUser = compact(userMessage).slice(0, 1_200);
  const boundedAssistant = compact(assistantMessage).slice(0, 1_200);
  return [
    "Create a concise title for this conversation.",
    "",
    `User: ${boundedUser}`,
    `Assistant: ${boundedAssistant}`,
  ].join("\n");
}
