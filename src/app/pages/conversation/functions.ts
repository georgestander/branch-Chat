"use server";

import { getRequestInfo } from "rwsdk/worker";

import type { AppContext } from "@/app/context";
import {
  DEFAULT_CONVERSATION_ID,
  applyConversationUpdates,
  ensureConversationSnapshot,
  buildResponseInputFromBranch,
  draftBranchFromSelection,
  generateConversationId,
  maybeAutoSummarizeRootBranchTitle,
  sanitizeBranchTitle,
} from "@/app/shared/conversation.server";
import { touchConversationDirectoryEntry } from "@/app/shared/conversationDirectory.server";
import { getDefaultResponseTools } from "@/app/shared/openai/tools.server";
import type {
  Branch,
  BranchId,
  BranchSpan,
  ConversationGraphSnapshot,
  ConversationModelId,
  Message,
  ToolInvocation,
  ToolInvocationStatus,
} from "@/lib/conversation";
import {
  WEB_SEARCH_TOOL_NAME,
  type WebSearchInvocationOutput,
  type WebSearchResultSummary,
} from "@/lib/conversation/tools";
import type { AppRequestInfo } from "@/worker";

const TEMPERATURE_UNSUPPORTED_MODELS = new Set<string>(["gpt-5-nano"]);

function buildResponseOptions(settings: {
  model: string;
  temperature: number;
}): { model: string; temperature?: number } {
  const request: { model: string; temperature?: number } = {
    model: settings.model,
  };

  if (!TEMPERATURE_UNSUPPORTED_MODELS.has(settings.model)) {
    request.temperature = settings.temperature;
  }

  return request;
}

export interface ConversationPayload {
  conversationId?: ConversationModelId;
}

export interface LoadConversationResponse {
  conversationId: ConversationModelId;
  snapshot: ConversationGraphSnapshot;
  version: number;
}

export interface SendMessageInput extends ConversationPayload {
  branchId?: BranchId;
  content: string;
}

export interface SendMessageResponse extends LoadConversationResponse {
  appendedMessages: Message[];
}

export interface CreateBranchInput extends ConversationPayload {
  parentBranchId: BranchId;
  messageId: string;
  span?: BranchSpan | null;
  title?: string;
  excerpt?: string | null;
}

export interface CreateBranchResponse extends LoadConversationResponse {
  branch: Branch;
}

export interface CreateConversationInput extends ConversationPayload {
  title?: string;
}

export type CreateConversationResponse = LoadConversationResponse;

export interface RenameBranchInput extends ConversationPayload {
  branchId: BranchId;
  title: string;
}

export interface RenameBranchResponse extends LoadConversationResponse {
  branch: Branch;
}

export interface ConversationSummary {
  conversationId: ConversationModelId;
  title: string;
  branchCount: number;
  lastActiveAt: string;
}

function normalizeWebSearchResults(item: any): WebSearchResultSummary[] {
  const rawResults = extractResultArray(item);

  if (!rawResults || rawResults.length === 0) {
    return [];
  }

  return rawResults.map((entry: any, index: number) => {
    const url =
      typeof entry?.url === "string"
        ? entry.url
        : typeof entry?.link === "string"
          ? entry.link
          : typeof entry?.sourceUrl === "string"
            ? entry.sourceUrl
            : typeof entry?.href === "string"
              ? entry.href
              : "";
    const title =
      typeof entry?.title === "string"
        ? entry.title
        : typeof entry?.name === "string"
          ? entry.name
          : url || `Result ${index + 1}`;
    const snippet =
      typeof entry?.snippet === "string"
        ? entry.snippet
        : typeof entry?.content === "string"
          ? entry.content
          : typeof entry?.description === "string"
            ? entry.description
            : typeof entry?.summary === "string"
              ? entry.summary
              : "";

    return {
      id:
        typeof entry?.id === "string"
          ? entry.id
          : url
            ? `${item.id}:${url}`
            : `${item.id}:${index}`,
      title,
      url,
      snippet,
      siteName:
        (typeof entry?.site_name === "string" && entry.site_name) ||
        (typeof entry?.siteName === "string" && entry.siteName) ||
        (typeof entry?.source === "string" && entry.source) ||
        (typeof entry?.publisher === "string" && entry.publisher) ||
        null,
      publishedAt:
        (typeof entry?.published_at === "string" && entry.published_at) ||
        (typeof entry?.published_time === "string" && entry.published_time) ||
        (typeof entry?.date === "string" && entry.date) ||
        null,
    } satisfies WebSearchResultSummary;
  });
}

function extractResultArray(root: unknown, seen = new Set<unknown>()): any[] | null {
  if (root == null) {
    return null;
  }

  if (Array.isArray(root)) {
    return root;
  }

  if (typeof root === "string") {
    try {
      const parsed = JSON.parse(root);
      return extractResultArray(parsed, seen);
    } catch {
      return null;
    }
  }

  if (typeof root !== "object") {
    return null;
  }

  if (seen.has(root)) {
    return null;
  }
  seen.add(root);

  const record = root as Record<string, unknown>;
  if (Array.isArray(record.results)) {
    return record.results;
  }
  if (Array.isArray((record as any).web_results)) {
    return (record as any).web_results;
  }
  if (Array.isArray((record as any).search_results)) {
    return (record as any).search_results;
  }
  if (Array.isArray((record as any).items)) {
    return (record as any).items;
  }

  for (const value of Object.values(record)) {
    const extracted = extractResultArray(value, seen);
    if (extracted && extracted.length > 0) {
      return extracted;
    }
  }

  return null;
}

export async function loadConversation(
  input: ConversationPayload = {},
): Promise<LoadConversationResponse> {
  const requestInfo = getRequestInfo() as AppRequestInfo;
  const ctx = requestInfo.ctx as AppContext;
  const conversationId = input.conversationId ?? DEFAULT_CONVERSATION_ID;

  const result = await ensureConversationSnapshot(ctx, conversationId);
  const rootBranch =
    result.snapshot.branches[result.snapshot.conversation.rootBranchId];
  await touchConversationDirectoryEntry(ctx, {
    id: conversationId,
    title: rootBranch?.title ?? conversationId,
    branchCount: Object.keys(result.snapshot.branches).length,
  });
  return result;
}

export async function createConversation(
  input: CreateConversationInput = {},
): Promise<CreateConversationResponse> {
  const requestInfo = getRequestInfo() as AppRequestInfo;
  const ctx = requestInfo.ctx as AppContext;
  const conversationId = input.conversationId ?? generateConversationId();

  const ensured = await ensureConversationSnapshot(ctx, conversationId);
  const rootBranch =
    ensured.snapshot.branches[ensured.snapshot.conversation.rootBranchId];
  const title = input.title?.trim() || rootBranch?.title || conversationId;

  await touchConversationDirectoryEntry(ctx, {
    id: conversationId,
    title,
    branchCount: Object.keys(ensured.snapshot.branches).length,
  });

  return ensured;
}

export async function sendMessage(
  input: SendMessageInput,
): Promise<SendMessageResponse> {
  const requestInfo = getRequestInfo() as AppRequestInfo;
  const ctx = requestInfo.ctx as AppContext;
  const conversationId = input.conversationId ?? DEFAULT_CONVERSATION_ID;

  if (!input.content || input.content.trim().length === 0) {
    throw new Error("Message content is required");
  }

  const ensured = await ensureConversationSnapshot(ctx, conversationId);
  const branchId =
    input.branchId ?? ensured.snapshot.conversation.rootBranchId;
  const branch = ensured.snapshot.branches[branchId];

  if (!branch) {
    throw new Error(`Branch ${branchId} not found for conversation`);
  }

  const now = new Date().toISOString();
  const userMessage: Message = {
    id: crypto.randomUUID(),
    branchId,
    role: "user",
    content: input.content.trim(),
    createdAt: now,
    tokenUsage: null,
    attachments: [],
    toolInvocations: null,
  };

  const assistantMessage: Message = {
    id: crypto.randomUUID(),
    branchId,
    role: "assistant",
    content: "",
    createdAt: new Date().toISOString(),
    tokenUsage: null,
    attachments: null,
    toolInvocations: [],
  };
  let assistantState: Message = assistantMessage;

  const toolInvocationMap = new Map<string, ToolInvocation>();
  const persistAssistantState = async () => {
    await applyConversationUpdates(
      ctx,
      conversationId,
      [
        {
          type: "message:update",
          conversationId,
          message: assistantState,
        },
      ],
      { touchDirectory: false },
    );
  };

  const appendedSnapshot = await applyConversationUpdates(ctx, conversationId, [
    {
      type: "message:append",
      conversationId,
      message: userMessage,
    },
    {
      type: "message:append",
      conversationId,
      message: assistantMessage,
    },
  ]);

  const openaiInput = buildResponseInputFromBranch({
    snapshot: appendedSnapshot.snapshot,
    branchId,
    nextUserContent: userMessage.content,
  });

  const settings = ensured.snapshot.conversation.settings;
  const openai = ctx.getOpenAIClient();

  ctx.trace("openai:stream:start", {
    conversationId,
    branchId,
    model: settings.model,
    temperature: settings.temperature,
    messageCount: openaiInput.length,
  });

  const stream = await openai.responses.stream({
    ...buildResponseOptions(settings),
    input: openaiInput,
    tools: getDefaultResponseTools(),
    include: ["web_search_call.results"],
  });

  let buffered = "";
  let lastPublishedLength = 0;
  let lastPublishTime = Date.now();
  const MIN_PUBLISH_CHARS = 24;
  const MIN_PUBLISH_MS = 150;

  const publishPartialUpdate = async (content: string) => {
    assistantState = {
      ...assistantState,
      content,
    };
    await persistAssistantState();
  };

  const harmonizeStatus = (status: string): ToolInvocationStatus => {
    switch (status) {
      case "completed":
        return "succeeded";
      case "failed":
        return "failed";
      case "searching":
      case "in_progress":
        return "running";
      default:
        return "pending";
    }
  };

  const updateToolInvocation = async (
    callId: string,
    updates: {
      status?: ToolInvocationStatus;
      errorMessage?: string;
      output?: unknown;
    } = {},
  ) => {
    const now = new Date().toISOString();
    const existing = toolInvocationMap.get(callId);
    const nextStatus =
      updates.status ?? existing?.status ?? ("pending" as ToolInvocationStatus);

    const next: ToolInvocation = existing
      ? { ...existing }
      : {
          id: callId,
          toolType: WEB_SEARCH_TOOL_NAME,
          toolName: WEB_SEARCH_TOOL_NAME,
          callId,
          input: undefined,
          output: undefined,
          status: nextStatus,
          startedAt: now,
          completedAt:
            nextStatus === "succeeded" || nextStatus === "failed"
              ? now
              : undefined,
          error: undefined,
        };

    next.status = nextStatus;
    if (updates.status) {
      next.completedAt =
        updates.status === "succeeded" || updates.status === "failed"
          ? now
          : existing?.completedAt;
    }

    if (updates.errorMessage) {
      next.error = { message: updates.errorMessage };
    } else if (updates.status && updates.status !== "failed") {
      next.error = undefined;
    }

    if (Object.prototype.hasOwnProperty.call(updates, "output")) {
      next.output = updates.output;
    }

    toolInvocationMap.set(callId, next);
    assistantState = {
      ...assistantState,
      toolInvocations: Array.from(toolInvocationMap.values()),
    };
    await persistAssistantState();
  };

  try {
    for await (const event of stream) {
      if (event.type === "response.output_text.delta") {
        const delta = typeof event.delta === "string" ? event.delta : "";
        if (!delta) {
          continue;
        }
        buffered += delta;
        const nowTs = Date.now();
        if (
          buffered.length - lastPublishedLength >= MIN_PUBLISH_CHARS ||
          nowTs - lastPublishTime >= MIN_PUBLISH_MS
        ) {
          lastPublishedLength = buffered.length;
          lastPublishTime = nowTs;
          await publishPartialUpdate(buffered);
        }
        continue;
      }

      if (event.type === "response.web_search_call.in_progress") {
        await updateToolInvocation(event.item_id, { status: "running" });
        continue;
      }

      if (event.type === "response.web_search_call.searching") {
        await updateToolInvocation(event.item_id, { status: "running" });
        continue;
      }

      if (event.type === "response.web_search_call.completed") {
        await updateToolInvocation(event.item_id, { status: "succeeded" });
      }
    }
  } catch (error) {
    ctx.trace("openai:stream:error", {
      conversationId,
      branchId,
      error: error instanceof Error ? error.message : "unknown",
    });
  }

  let finalContent = buffered;
  let promptTokens = 0;
  let completionTokens = 0;
  let finalResponse: any = null;

  try {
    finalResponse = await stream.finalResponse();
    finalContent =
      finalResponse.output_text?.trim() ??
      finalResponse.output
        ?.map((item: any) =>
          item.content
            ?.map?.((part: any) => part.text ?? "")
            ?.join("") ?? "",
        )
        ?.join("")
        .trim() ??
      buffered.trim();
    promptTokens = finalResponse.usage?.input_tokens ?? 0;
    completionTokens = finalResponse.usage?.output_tokens ?? 0;
    ctx.trace("openai:stream:complete", {
      conversationId,
      branchId,
      promptTokens,
      completionTokens,
      characters: finalContent.length,
    });
  } catch (error) {
    ctx.trace("openai:stream:finalize-error", {
      conversationId,
      branchId,
      error: error instanceof Error ? error.message : "unknown",
    });
    if (!finalContent.trim()) {
      finalContent = "Assistant response interrupted. Please try again.";
    }
  }

  if (finalResponse && Array.isArray(finalResponse.output)) {
    for (const item of finalResponse.output) {
      if (item.type === "web_search_call") {
        const status = harmonizeStatus(item.status ?? "completed");
        const normalized = normalizeWebSearchResults(item);
        ctx.trace("openai:web-search:results", {
          conversationId,
          branchId,
          toolCallId: item.id,
          status,
          resultCount: normalized.length,
          itemKeys: Object.keys(item ?? {}),
        });
        await updateToolInvocation(item.id, {
          status,
          output: {
            type: "web_search",
            results: normalized,
          } as WebSearchInvocationOutput,
          errorMessage:
            status === "failed" && typeof item?.error === "string"
              ? item.error
              : undefined,
        });
      }
    }
  }

  assistantState = {
    ...assistantState,
    content: finalContent,
    tokenUsage: {
      prompt: promptTokens,
      completion: completionTokens,
      cost: 0,
    },
    toolInvocations: Array.from(toolInvocationMap.values()),
  };

  const finalAssistantMessage = assistantState;

  const applied = await applyConversationUpdates(ctx, conversationId, [
    {
      type: "message:update",
      conversationId,
      message: finalAssistantMessage,
    },
  ]);

  void maybeAutoSummarizeRootBranchTitle({
    ctx,
    conversationId,
    snapshot: applied.snapshot,
    branchId,
  }).catch((error) => {
    ctx.trace("conversation:auto-title:deferred-error", {
      conversationId,
      branchId,
      error: error instanceof Error ? error.message : "unknown",
    });
  });

  return {
    conversationId,
    snapshot: applied.snapshot,
    version: applied.version,
    appendedMessages: [userMessage, finalAssistantMessage],
  };
}

export async function createBranchFromSelection(
  input: CreateBranchInput,
): Promise<CreateBranchResponse> {
  const requestInfo = getRequestInfo() as AppRequestInfo;
  const ctx = requestInfo.ctx as AppContext;
  const conversationId = input.conversationId ?? DEFAULT_CONVERSATION_ID;

  const ensured = await ensureConversationSnapshot(ctx, conversationId);
  const draft = draftBranchFromSelection({
    snapshot: ensured.snapshot,
    parentBranchId: input.parentBranchId,
    messageId: input.messageId,
    span: input.span,
    title: input.title,
    excerpt: input.excerpt,
  });

  const applied = await applyConversationUpdates(ctx, conversationId, [
    {
      type: "branch:create",
      conversationId,
      branch: draft,
    },
  ]);

  const branch = applied.snapshot.branches[draft.id];
  if (!branch) {
    throw new Error("Branch creation failed to persist");
  }

  return {
    conversationId,
    snapshot: applied.snapshot,
    version: applied.version,
    branch,
  };
}

export async function getConversationSummary(
  input: ConversationPayload = {},
): Promise<ConversationSummary> {
  const requestInfo = getRequestInfo() as AppRequestInfo;
  const ctx = requestInfo.ctx as AppContext;
  const conversationId = input.conversationId ?? DEFAULT_CONVERSATION_ID;

  const ensured = await ensureConversationSnapshot(ctx, conversationId);
  const snapshot = ensured.snapshot;
  const branchCount = Object.keys(snapshot.branches).length;
  const rootBranch =
    snapshot.branches[snapshot.conversation.rootBranchId];

  return {
    conversationId,
    title: rootBranch?.title?.trim() || conversationId,
    branchCount,
    lastActiveAt: new Date().toISOString(),
  };
}

export async function renameBranch(
  input: RenameBranchInput,
): Promise<RenameBranchResponse> {
  const requestInfo = getRequestInfo() as AppRequestInfo;
  const ctx = requestInfo.ctx as AppContext;
  const conversationId = input.conversationId ?? DEFAULT_CONVERSATION_ID;

  if (!input.branchId) {
    throw new Error("Branch ID is required");
  }

  const ensured = await ensureConversationSnapshot(ctx, conversationId);
  const existingBranch = ensured.snapshot.branches[input.branchId];

  if (!existingBranch) {
    throw new Error(`Branch ${input.branchId} not found for conversation`);
  }

  const nextTitle = sanitizeBranchTitle(
    input.title,
    existingBranch.title || undefined,
  );

  if (nextTitle === existingBranch.title) {
    return {
      conversationId,
      snapshot: ensured.snapshot,
      version: ensured.version,
      branch: existingBranch,
    };
  }

  const applied = await applyConversationUpdates(ctx, conversationId, [
    {
      type: "branch:update",
      conversationId,
      branch: {
        ...existingBranch,
        title: nextTitle,
      },
    },
  ]);

  const branch = applied.snapshot.branches[input.branchId];
  if (!branch) {
    throw new Error("Branch rename failed to persist");
  }

  return {
    conversationId,
    snapshot: applied.snapshot,
    version: applied.version,
    branch,
  };
}
