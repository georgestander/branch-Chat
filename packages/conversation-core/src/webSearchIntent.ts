export type WebSearchAutoEnableReason = "direct-intent" | "assistant-follow-up";

const DIRECT_WEB_SEARCH_PATTERNS: RegExp[] = [
  /\bweb\s*search\b/i,
  /\bsearch\s+(the\s+)?web\b/i,
  /\bsearch\s+online\b/i,
  /\blook\s+up\b/i,
  /\bgoogle\b/i,
  /\bbrowse\s+(the\s+)?web\b/i,
  /\bverify\b.*\b(online|source|sources)\b/i,
  /\b(check|confirm)\b.*\b(latest|current|official|up[-\s]?to[-\s]?date)\b/i,
  /\b(latest|most\s+recent|up[-\s]?to[-\s]?date|current|today)\b.*\b(docs?|documentation|guidance|instructions|release|announcement|policy|law|spec|api|version|update|changes)\b/i,
];

const ASSENT_ONLY_PATTERN =
  /^(yes|yes please|please|please do|go ahead|sure|ok|okay|yep|yeah|do it)\b[\s.!?]*$/i;

const ASSISTANT_WEB_SEARCH_PROMPT_PATTERNS: RegExp[] = [
  /\bweb\s*search\b.*\b(enable|enabled|turn on|disabled|off|active)\b/i,
  /\benable\b.*\bweb\s*search\b/i,
  /\bturn\s+on\b.*\bweb\s*search\b/i,
  /\bweb\s*search\s+is\s+(currently\s+)?disabled\b/i,
  /\bonce\s+web\s*search\s+is\s+enabled\b/i,
];

function hasAssistantWebSearchPrompt(messages: string[]): boolean {
  for (const message of messages) {
    const trimmed = message.trim();
    if (!trimmed) {
      continue;
    }
    for (const pattern of ASSISTANT_WEB_SEARCH_PROMPT_PATTERNS) {
      if (pattern.test(trimmed)) {
        return true;
      }
    }
  }
  return false;
}

export function detectAutoEnableWebSearchIntent(options: {
  content: string;
  recentAssistantMessages?: string[];
}): WebSearchAutoEnableReason | null {
  const trimmedContent = options.content.trim();
  if (!trimmedContent) {
    return null;
  }

  for (const pattern of DIRECT_WEB_SEARCH_PATTERNS) {
    if (pattern.test(trimmedContent)) {
      return "direct-intent";
    }
  }

  if (
    ASSENT_ONLY_PATTERN.test(trimmedContent) &&
    hasAssistantWebSearchPrompt(options.recentAssistantMessages ?? [])
  ) {
    return "assistant-follow-up";
  }

  return null;
}
