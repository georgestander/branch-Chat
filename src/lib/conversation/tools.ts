import type { ToolInvocation } from "./model";

export const WEB_SEARCH_TOOL_NAME = "web_search";
export const FILE_UPLOAD_TOOL_NAME = "connexus_upload_file";

export interface WebSearchResultSummary {
  id: string;
  title: string;
  url: string;
  snippet: string;
  siteName?: string | null;
  publishedAt?: string | null;
}

export interface WebSearchInvocationOutput {
  type: "web_search";
  results: WebSearchResultSummary[];
}

export function isWebSearchInvocationOutput(
  value: unknown,
): value is WebSearchInvocationOutput {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.type !== "web_search") {
    return false;
  }
  return Array.isArray(record.results);
}

export function extractWebSearchResults(
  invocations?: ToolInvocation[] | null,
): WebSearchResultSummary[] {
  if (!Array.isArray(invocations) || invocations.length === 0) {
    return [];
  }

  const results: WebSearchResultSummary[] = [];
  for (const invocation of invocations) {
    if (invocation.toolType !== WEB_SEARCH_TOOL_NAME) {
      continue;
    }
    if (isWebSearchInvocationOutput(invocation.output)) {
      results.push(...invocation.output.results);
    }
  }
  return results;
}
