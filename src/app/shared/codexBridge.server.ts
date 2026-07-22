const DEFAULT_CODEX_BRIDGE_URL = "http://127.0.0.1:43991";

export interface CodexAccountStatus {
  connected: boolean;
  email: string | null;
  planType: string | null;
}

export interface CodexBridgeModel {
  id: string;
  model: string;
  displayName: string;
  description: string;
  supportedReasoningEfforts: Array<{
    reasoningEffort: string;
    description: string;
  }>;
  defaultReasoningEffort: string;
  serviceTiers: Array<{ id: string; name: string; description: string }>;
  isDefault: boolean;
}

export type CodexBridgeContextMode = "start" | "resume" | "fork" | "recovery";

export interface CodexBridgeAdditionalContext {
  [sourceId: string]: {
    value: string;
    kind: "untrusted" | "application";
  };
}

export type CodexBridgeStreamEvent =
  | {
      type: "context";
      threadId: string;
      contextMode: CodexBridgeContextMode;
      recovered: boolean;
      historyTruncated: boolean;
    }
  | {
      type: "start";
      threadId: string;
      turnId?: string;
      contextMode?: CodexBridgeContextMode;
      recovered?: boolean;
    }
  | { type: "delta"; delta: string }
  | { type: "reasoning_summary"; delta: string; content?: string }
  | {
      type: "tool_progress";
      tool: "web_search";
      callId: string;
      status: "running" | "succeeded" | "failed";
      query?: string;
    }
  | {
      type: "complete";
      content: string;
      reasoningSummary?: string | null;
      promptTokens?: number;
      completionTokens?: number;
      threadId?: string;
      turnId?: string;
      contextMode?: CodexBridgeContextMode;
      recovered?: boolean;
      historyTruncated?: boolean;
    }
  | { type: "error"; message: string };

function getBridgeUrl(env?: Env): string {
  const configured = env?.CODEX_BRIDGE_URL?.trim();
  return configured || DEFAULT_CODEX_BRIDGE_URL;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error.trim()) return body.error;
  } catch {
    // Fall through to the status message.
  }
  return `Codex bridge returned ${response.status}`;
}

export async function getCodexAccountStatus(
  env?: Env,
): Promise<CodexAccountStatus> {
  try {
    const response = await fetch(`${getBridgeUrl(env)}/health`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(await readError(response));
    const body = (await response.json()) as {
      account?: { type?: string; email?: string | null; planType?: string | null } | null;
    };
    const account = body.account;
    return {
      connected: account?.type === "chatgpt",
      email: typeof account?.email === "string" ? account.email : null,
      planType: typeof account?.planType === "string" ? account.planType : null,
    };
  } catch (error) {
    return {
      connected: false,
      email: null,
      planType:
        error instanceof Error
          ? `Local Codex bridge unavailable: ${error.message}`
          : "Local Codex bridge unavailable",
    };
  }
}

export async function listCodexModels(env?: Env): Promise<CodexBridgeModel[]> {
  const response = await fetch(`${getBridgeUrl(env)}/models`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(await readError(response));
  const body = (await response.json()) as { data?: unknown };
  return Array.isArray(body.data) ? (body.data as CodexBridgeModel[]) : [];
}

export async function* streamCodexTurn(options: {
  env?: Env;
  model: string;
  effort: string | null;
  serviceTier?: string | null;
  webSearch: boolean;
  content: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  baseInstructions?: string | null;
  developerInstructions?: string | null;
  threadId?: string | null;
  forkFrom?: { threadId: string; turnId: string } | null;
  clientUserMessageId?: string | null;
  additionalContext?: CodexBridgeAdditionalContext | null;
}): AsyncGenerator<CodexBridgeStreamEvent> {
  const response = await fetch(`${getBridgeUrl(options.env)}/turns`, {
    method: "POST",
    headers: {
      accept: "application/x-ndjson",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: options.model,
      effort: options.effort,
      serviceTier: options.serviceTier ?? null,
      webSearch: options.webSearch,
      content: options.content,
      messages: options.messages.map(({ role, content }) => ({ role, content })),
      baseInstructions: options.baseInstructions ?? null,
      developerInstructions: options.developerInstructions ?? null,
      threadId: options.threadId ?? null,
      forkFrom: options.forkFrom ?? null,
      clientUserMessageId: options.clientUserMessageId ?? null,
      additionalContext: options.additionalContext ?? null,
    }),
  });
  if (!response.ok) throw new Error(await readError(response));
  if (!response.body) throw new Error("Codex bridge returned no response body");

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += value ?? "";
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) break;
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        yield JSON.parse(line) as CodexBridgeStreamEvent;
      }
      if (done) break;
    }
    if (buffer.trim()) yield JSON.parse(buffer) as CodexBridgeStreamEvent;
  } finally {
    reader.releaseLock();
  }
}

export async function deleteCodexThreads(
  threadIds: string[],
  env?: Env,
): Promise<{ deleted: string[]; failed: Array<{ threadId: string; message: string }> }> {
  const normalized = Array.from(
    new Set(threadIds.map((threadId) => threadId.trim()).filter(Boolean)),
  );
  if (normalized.length === 0) {
    return { deleted: [], failed: [] };
  }
  const response = await fetch(`${getBridgeUrl(env)}/threads/delete`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ threadIds: normalized }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as {
    deleted: string[];
    failed: Array<{ threadId: string; message: string }>;
  };
}
