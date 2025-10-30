"use server";

import { getRequestInfo } from "rwsdk/worker";

import type { AppContext } from "@/app/context";
import {
  DEFAULT_CONVERSATION_ID,
  applyConversationUpdates,
  ensureConversationSnapshot,
  buildResponseInputFromBranch,
  buildStudyAgentInputFromBranch,
  draftBranchFromSelection,
  generateConversationId,
  maybeApplyRootBranchFallbackTitle,
  maybeAutoSummarizeRootBranchTitle,
  sanitizeBranchTitle,
  invalidateConversationCache,
} from "@/app/shared/conversation.server";
import {
  touchConversationDirectoryEntry,
  archiveConversationDirectoryEntry,
  unarchiveConversationDirectoryEntry,
  deleteConversationDirectoryEntry,
} from "@/app/shared/conversationDirectory.server";
import { getDefaultResponseTools } from "@/app/shared/openai/tools.server";
import {
  createAttachmentUpload as createAttachmentUploadHelper,
  finalizeAttachmentUpload as finalizeAttachmentUploadHelper,
  getMaxAttachmentSizeBytes,
  MAX_ATTACHMENTS_PER_MESSAGE,
  removeStagedAttachment as removeStagedAttachmentHelper,
} from "@/app/shared/uploads.server";
import { runStudyAndLearnAgent } from "@/app/shared/openai/studyAndLearnAgent.server";
import {
  buildRetrievalContext,
  formatRetrievedContextForPrompt,
  persistWebSearchSnippets,
} from "@/app/shared/retrieval.server";
import type {
  Branch,
  BranchId,
  BranchSpan,
  ConversationGraphSnapshot,
  ConversationModelId,
  Message,
  MessageAttachment,
  PendingAttachment,
  AttachmentIngestionRecord,
  ToolInvocation,
  ToolInvocationStatus,
} from "@/lib/conversation";
import type { ConversationDirectoryEntry } from "@/lib/durable-objects/ConversationDirectory";
import {
  WEB_SEARCH_TOOL_NAME,
  type ConversationComposerTool,
  type WebSearchInvocationOutput,
  type WebSearchResultSummary,
} from "@/lib/conversation/tools";
import type { AppRequestInfo } from "@/worker";

const TEMPERATURE_UNSUPPORTED_MODELS = new Set<string>(["gpt-5-nano"]);

function isReasoningModel(model: string): boolean {
  // Heuristics: treat non-chat variants of gpt-5 as reasoning models
  return model.startsWith("gpt-5-") && !model.includes("chat");
}

function buildResponseOptions(settings: {
  model: string;
  temperature: number;
  reasoningEffort?: "low" | "medium" | "high" | null;
}): {
  model: string;
  temperature?: number;
  reasoning?: { effort?: "low" | "medium" | "high" };
} {
  const request: {
    model: string;
    temperature?: number;
    reasoning?: { effort?: "low" | "medium" | "high" };
  } = {
    model: settings.model,
  };

  if (!TEMPERATURE_UNSUPPORTED_MODELS.has(settings.model)) {
    request.temperature = settings.temperature;
  }

  if (isReasoningModel(settings.model) && settings.reasoningEffort) {
    request.reasoning = { effort: settings.reasoningEffort };
  }

  return request;
}

export interface ConversationPayload {
  conversationId?: ConversationModelId;
}

export interface AttachmentConstraintsResponse {
  maxSizeBytes: number;
  maxAttachments: number;
}

export function getAttachmentConstraints(): AttachmentConstraintsResponse {
  return {
    maxSizeBytes: getMaxAttachmentSizeBytes(),
    maxAttachments: MAX_ATTACHMENTS_PER_MESSAGE,
  };
}

export interface CreateAttachmentUploadActionInput extends ConversationPayload {
  fileName: string;
  size: number;
  contentType: string;
}

export interface CreateAttachmentUploadActionOutput {
  attachment: PendingAttachment;
  uploadUrl: string;
  uploadHeaders: Record<string, string>;
  expiresAt: string;
  maxSizeBytes: number;
  maxAttachments: number;
}

export async function createAttachmentUploadAction(
  input: CreateAttachmentUploadActionInput,
): Promise<CreateAttachmentUploadActionOutput> {
  const requestInfo = getRequestInfo() as AppRequestInfo;
  const ctx = requestInfo.ctx as AppContext;
  const conversationId = input.conversationId ?? DEFAULT_CONVERSATION_ID;
  const storeClient = ctx.getConversationStore(conversationId);

  const result = await createAttachmentUploadHelper(ctx, {
    ...input,
    conversationId,
  });

  return {
    ...result,
    maxSizeBytes: getMaxAttachmentSizeBytes(),
    maxAttachments: MAX_ATTACHMENTS_PER_MESSAGE,
  };
}

export interface FinalizeAttachmentUploadActionInput
  extends ConversationPayload {
  attachmentId: string;
}

export async function finalizeAttachmentUploadAction(
  input: FinalizeAttachmentUploadActionInput,
): Promise<PendingAttachment> {
  const requestInfo = getRequestInfo() as AppRequestInfo;
  const ctx = requestInfo.ctx as AppContext;
  const conversationId = input.conversationId ?? DEFAULT_CONVERSATION_ID;

  return finalizeAttachmentUploadHelper(ctx, {
    conversationId,
    attachmentId: input.attachmentId,
  });
}

export interface RemoveAttachmentUploadActionInput extends ConversationPayload {
  attachmentId: string;
}

export async function removeAttachmentUploadAction(
  input: RemoveAttachmentUploadActionInput,
): Promise<PendingAttachment | null> {
  const requestInfo = getRequestInfo() as AppRequestInfo;
  const ctx = requestInfo.ctx as AppContext;
  const conversationId = input.conversationId ?? DEFAULT_CONVERSATION_ID;

  return removeStagedAttachmentHelper(ctx, {
    conversationId,
    attachmentId: input.attachmentId,
  });
}

export interface LoadConversationResponse {
  conversationId: ConversationModelId;
  snapshot: ConversationGraphSnapshot;
  version: number;
}

export interface SendMessageInput extends ConversationPayload {
  branchId?: BranchId;
  content: string;
  streamId?: string;
  tools?: ConversationComposerTool[];
  attachmentIds?: string[];
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
  archivedAt: string | null;
}

export interface ArchiveConversationInput extends ConversationPayload {}

export interface ArchiveConversationResponse {
  entry: ConversationDirectoryEntry;
}

export interface UnarchiveConversationInput extends ConversationPayload {}

export type UnarchiveConversationResponse = ArchiveConversationResponse;

export interface DeleteConversationInput extends ConversationPayload {}

export interface DeleteConversationResponse {
  conversationId: ConversationModelId;
}

export interface UpdateConversationSettingsInput extends ConversationPayload {
  model?: string;
  temperature?: number;
  reasoningEffort?: "low" | "medium" | "high" | null;
}

export type UpdateConversationSettingsResponse = LoadConversationResponse;

export async function updateConversationSettings(
  input: UpdateConversationSettingsInput,
): Promise<UpdateConversationSettingsResponse> {
  const requestInfo = getRequestInfo() as AppRequestInfo;
  const ctx = requestInfo.ctx as AppContext;
  const conversationId = input.conversationId ?? DEFAULT_CONVERSATION_ID;

  const ensured = await ensureConversationSnapshot(ctx, conversationId);
  const current = ensured.snapshot.conversation;
  const nextSettings = {
    ...current.settings,
    ...(input.model ? { model: input.model } : {}),
    ...(typeof input.temperature === "number"
      ? { temperature: input.temperature }
      : {}),
    ...(input.reasoningEffort !== undefined
      ? { reasoningEffort: input.reasoningEffort }
      : {}),
  };

  const applied = await applyConversationUpdates(ctx, conversationId, [
    {
      type: "conversation:update",
      conversation: {
        ...current,
        settings: nextSettings,
      },
    },
  ]);

  return {
    conversationId,
    snapshot: applied.snapshot,
    version: applied.version,
  };
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
  const storeClient = ctx.getConversationStore(conversationId);

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

  const attachmentIds = Array.isArray(input.attachmentIds)
    ? input.attachmentIds
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((value) => value.length > 0)
    : [];

  if (attachmentIds.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw new Error(
      `A maximum of ${MAX_ATTACHMENTS_PER_MESSAGE} attachments are allowed per message.`,
    );
  }

  let consumedAttachments: PendingAttachment[] = [];
  if (attachmentIds.length > 0) {
    consumedAttachments = await storeClient.consumeAttachments(attachmentIds);
    if (consumedAttachments.length !== attachmentIds.length) {
      throw new Error(
        "Some attachments are no longer available. Please re-upload and try again.",
      );
    }
  }

  let attachmentsToRestore: PendingAttachment[] | null =
    consumedAttachments.length > 0 ? [...consumedAttachments] : null;

  const toMessageAttachment = (attachment: PendingAttachment) => ({
    id: attachment.id,
    kind: "file" as const,
    name: attachment.name,
    contentType: attachment.contentType,
    size: attachment.size,
    storageKey: attachment.storageKey,
    openAIFileId: null,
    description: null,
    uploadedAt: attachment.uploadedAt ?? new Date().toISOString(),
  });

  try {
    const selectedTools = Array.isArray(input.tools)
    ? input.tools.filter((tool): tool is ConversationComposerTool => {
        return (
          tool === "study-and-learn" ||
          tool === "web-search" ||
          tool === "file-upload"
        );
      })
    : [];
  const selectedToolSet = new Set(selectedTools);
  if (selectedTools.length > 0) {
    ctx.trace("composer:tools:selected", {
      conversationId,
      branchId,
      tools: selectedTools,
    });
  }

  const settings = ensured.snapshot.conversation.settings;

  const attachmentLookup = new Map<string, MessageAttachment>();
  for (const storedMessage of Object.values(ensured.snapshot.messages)) {
    const storedAttachments = storedMessage.attachments;
    if (!Array.isArray(storedAttachments)) {
      continue;
    }
    for (const item of storedAttachments) {
      if (!attachmentLookup.has(item.id)) {
        attachmentLookup.set(item.id, item);
      }
    }
  }

  let attachmentIngestions: AttachmentIngestionRecord[] = [];
  try {
    attachmentIngestions = await storeClient.listAttachmentIngestions();
  } catch (error) {
    ctx.trace("retrieval:ingestion:list-error", {
      conversationId,
      branchId,
      error: error instanceof Error ? error.message : "unknown",
    });
  }

  const now = new Date().toISOString();
  const userMessage: Message = {
    id: crypto.randomUUID(),
    branchId,
    role: "user",
    content: input.content.trim(),
    createdAt: now,
    tokenUsage: null,
    attachments:
      consumedAttachments.length > 0
        ? consumedAttachments.map(toMessageAttachment)
        : [],
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

  const enableWebSearchTool =
    selectedToolSet.size === 0 || selectedToolSet.has("web-search");

  let retrievalContextResult: Awaited<ReturnType<typeof buildRetrievalContext>> | null =
    null;
  let retrievalContextText: string | null = null;
  try {
    retrievalContextResult = await buildRetrievalContext(ctx, {
      conversationId,
      query: userMessage.content,
      maxAttachmentChunks: 6,
      maxWebSnippets: enableWebSearchTool ? 6 : 0,
      allowedAttachmentIds: null,
      minScore: 0.12,
    });
    if (retrievalContextResult.blocks.length > 0) {
      retrievalContextText = formatRetrievedContextForPrompt(
        retrievalContextResult.blocks,
      );
      ctx.trace("retrieval:context", {
        conversationId,
        branchId,
        blockCount: retrievalContextResult.blocks.length,
        sources: retrievalContextResult.blocks.map((block) => ({
          id: block.id,
          type: block.type,
          title: block.title,
          relevance: Number(block.relevance?.toFixed?.(3) ?? block.relevance),
        })),
      });
    }
  } catch (error) {
    ctx.trace("retrieval:context:error", {
      conversationId,
      branchId,
      error: error instanceof Error ? error.message : "unknown",
    });
  }

  if (!retrievalContextText && attachmentIngestions.length > 0) {
    const summaryLines = attachmentIngestions
      .map((ingestion) => {
        const attachment = attachmentLookup.get(ingestion.attachmentId);
        const name = attachment?.name ?? ingestion.attachmentId;
        const summary = ingestion.summary?.trim();
        const fallbackSummary = attachment
          ? `${attachment.contentType} · ${Math.max(1, Math.round(attachment.size / 1024))} KB`
          : "Uploaded reference";
        return `• ${name}: ${summary && summary.length > 0 ? summary : fallbackSummary}`;
      })
      .slice(0, 5);

    if (summaryLines.length > 0) {
      retrievalContextText = `Here is what the user has shared so far:\n${summaryLines.join("\n")}\n\nUse these materials immediately—summarize key themes, surface important facts, and offer a study plan tailored to the document without waiting for more clarification.`;
    }
  }

  const toolInvocationMap = new Map<string, ToolInvocation>();
  // NOTE: We intentionally avoid partial Durable Object writes during streaming.
  // We'll persist once at the end to minimize sequential write overhead.
  const persistAssistantState = async () => Promise.resolve();

  const appendStart = Date.now();
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
  ctx.trace("conversation:apply:append-duration", {
    conversationId,
    branchId,
    ms: Date.now() - appendStart,
  });

  if (selectedToolSet.has("study-and-learn")) {
    const agentStart = Date.now();
    ctx.trace("agent:study:start", {
      conversationId,
      branchId,
      assistantMessageId: assistantMessage.id,
    });

    let agentOutput = "";
    const allowWebSearchForAgent =
      selectedToolSet.size === 0 ||
      selectedToolSet.has("web-search") ||
      selectedToolSet.has("study-and-learn");

    const studyAgentInput = buildStudyAgentInputFromBranch({
      snapshot: appendedSnapshot.snapshot,
      branchId,
      nextUserContent: userMessage.content,
      allowWebSearch: allowWebSearchForAgent,
      allowFileTools: selectedToolSet.has("file-upload"),
    });

    try {
      const agentHistory = [...studyAgentInput.messages];

      if (consumedAttachments.length > 0) {
        const attachmentSummary = consumedAttachments
          .map((attachment) => {
            const sizeKb = Math.max(1, Math.round(attachment.size / 1024));
            return `• ${attachment.name} (${attachment.contentType}, ${sizeKb} KB)`;
          })
          .join("\n");
        agentHistory.push({
          role: "user",
          content: `The user attached supporting files:\n${attachmentSummary}`,
        });
      }

      if (retrievalContextText) {
        agentHistory.push({
          role: "user",
          content: `Additional context from uploads & searches:\n${retrievalContextText}`,
        });
      }

      const result = await runStudyAndLearnAgent({
        instructions: studyAgentInput.instructions,
        history: agentHistory,
        model: settings.model,
        temperature: settings.temperature,
        reasoningEffort: settings.reasoningEffort ?? undefined,
        traceMetadata: {
          conversationId,
          branchId,
          assistantMessageId: assistantMessage.id,
        },
      });

      agentOutput = result.outputText.trim();
      ctx.trace("agent:study:success", {
        conversationId,
        branchId,
        assistantMessageId: assistantMessage.id,
        ms: Date.now() - agentStart,
        characters: agentOutput.length,
      });
    } catch (error) {
      ctx.trace("agent:study:error", {
        conversationId,
        branchId,
        assistantMessageId: assistantMessage.id,
        ms: Date.now() - agentStart,
        error: error instanceof Error ? error.message : "unknown",
      });
      agentOutput =
        "We couldn't reach the Study & Learn tutor. Please try again.";
    }

    if (!agentOutput) {
      agentOutput = "The Study & Learn tutor did not return a response.";
    }

    const finalAssistantMessage: Message = {
      ...assistantMessage,
      content: agentOutput,
      toolInvocations: [],
    };

    const finalPersistStart = Date.now();
    const applied = await applyConversationUpdates(ctx, conversationId, [
      {
        type: "message:update",
        conversationId,
        message: finalAssistantMessage,
      },
    ]);
    ctx.trace("conversation:apply:final-duration", {
      conversationId,
      branchId,
      ms: Date.now() - finalPersistStart,
    });

    let latestResult = applied;
    try {
      const fallbackResult = await maybeApplyRootBranchFallbackTitle({
        ctx,
        conversationId,
        snapshot: applied.snapshot,
        branchId,
      });
      if (fallbackResult) {
        latestResult = fallbackResult;
      }
    } catch (error) {
      ctx.trace("conversation:auto-title:fallback-error", {
        conversationId,
        branchId,
        error: error instanceof Error ? error.message : "unknown",
      });
    }

    void maybeAutoSummarizeRootBranchTitle({
      ctx,
      conversationId,
      snapshot: latestResult.snapshot,
      branchId,
    }).catch((error) => {
      ctx.trace("conversation:auto-title:deferred-error", {
        conversationId,
        branchId,
        error: error instanceof Error ? error.message : "unknown",
      });
    });

    attachmentsToRestore = null;
    return {
      conversationId,
      snapshot: latestResult.snapshot,
      version: latestResult.version,
      appendedMessages: [userMessage, finalAssistantMessage],
    };
  }

  const openaiInput = buildResponseInputFromBranch({
    snapshot: appendedSnapshot.snapshot,
    branchId,
    nextUserContent: userMessage.content,
    allowWebSearch: enableWebSearchTool,
    allowFileTools: selectedToolSet.has("file-upload"),
  });

  if (retrievalContextText) {
    openaiInput.unshift({
      role: "system",
      content: `Additional context from uploads & searches:\n\n${retrievalContextText}`,
    });
  }

  const openai = ctx.getOpenAIClient();

  const streamStart = Date.now();
  let firstDeltaAt: number | null = null;
  ctx.trace("openai:stream:start", {
    conversationId,
    branchId,
    model: settings.model,
    temperature: settings.temperature,
    messageCount: openaiInput.length,
    reasoningEffort: settings.reasoningEffort ?? null,
  });
  const responseTools = getDefaultResponseTools({
    enableWebSearchTool,
    enableFileUploadTool: selectedToolSet.has("file-upload"),
  });
  const streamInclude: string[] = [];
  if (enableWebSearchTool) {
    streamInclude.push("web_search_call.results");
  }

  const stream = await openai.responses.stream({
    ...buildResponseOptions(settings),
    input: openaiInput,
    ...(responseTools.length > 0 ? { tools: responseTools } : {}),
    ...(streamInclude.length > 0 ? { include: streamInclude } : {}),
  });

  let buffered = "";
  let lastPublishedLength = 0;
  let lastPublishTime = Date.now();
  const MIN_PUBLISH_CHARS = 64;
  const MIN_PUBLISH_MS = 500;

  const publishPartialUpdate = async (content: string) => {
    assistantState = {
      ...assistantState,
      content,
    };
    await persistAssistantState();
    if (input.streamId) {
      const { sendSSE } = await import("@/app/shared/streaming.server");
      sendSSE(input.streamId, "delta", { content });
    }
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
        if (!firstDeltaAt) {
          firstDeltaAt = Date.now();
          ctx.trace("openai:stream:first-token", {
            conversationId,
            branchId,
            dtMs: firstDeltaAt - streamStart,
          });
          if (input.streamId) {
            const { sendSSE } = await import("@/app/shared/streaming.server");
            sendSSE(input.streamId, "start", { startedAt: firstDeltaAt });
          }
        }
        const nowTs = Date.now();
        if (
          buffered.length - lastPublishedLength >= MIN_PUBLISH_CHARS ||
          nowTs - lastPublishTime >= MIN_PUBLISH_MS
        ) {
          // We no longer persist partial content to the DO to avoid throttling.
          // Hook for future SSE streaming could emit here instead.
          lastPublishedLength = buffered.length;
          lastPublishTime = nowTs;
          if (input.streamId) {
            const { sendSSE } = await import("@/app/shared/streaming.server");
            sendSSE(input.streamId, "delta", { content: buffered });
          }
        }
        continue;
      }

      if (!enableWebSearchTool) {
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
    if (input.streamId) {
      const { sendSSE, closeSSE } = await import("@/app/shared/streaming.server");
      sendSSE(input.streamId, "error", {
        message: error instanceof Error ? error.message : "unknown",
      });
      closeSSE(input.streamId);
    }
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
    const streamReply =
      typeof finalResponse?.response?.output?.[0]?.content?.[0]?.text === "string"
        ? finalResponse.response.output[0].content[0].text
        : buffered;
    ctx.trace("openai:stream:complete", {
      conversationId,
      branchId,
      promptTokens,
      completionTokens,
      characters: finalContent.length,
      streamReply,
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

  if (enableWebSearchTool && finalResponse && Array.isArray(finalResponse.output)) {
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
        if (normalized.length > 0) {
          try {
            await persistWebSearchSnippets(ctx, {
              conversationId,
              snippets: normalized,
              provider: "openai:web-search",
            });
          } catch (persistError) {
            ctx.trace("web-search:persist:error", {
              conversationId,
              branchId,
              error:
                persistError instanceof Error
                  ? persistError.message
                  : "unknown",
            });
          }
        }
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

  const finalPersistStart = Date.now();
  const applied = await applyConversationUpdates(ctx, conversationId, [
    {
      type: "message:update",
      conversationId,
      message: finalAssistantMessage,
    },
  ]);
  if (input.streamId) {
    const { sendSSE, closeSSE } = await import("@/app/shared/streaming.server");
    sendSSE(input.streamId, "complete", {
      content: finalContent,
      promptTokens,
      completionTokens,
    });
    closeSSE(input.streamId);
  }
  ctx.trace("conversation:apply:final-duration", {
    conversationId,
    branchId,
    ms: Date.now() - finalPersistStart,
  });

  let latestResult = applied;
  try {
    const fallbackResult = await maybeApplyRootBranchFallbackTitle({
      ctx,
      conversationId,
      snapshot: applied.snapshot,
      branchId,
    });
    if (fallbackResult) {
      latestResult = fallbackResult;
    }
  } catch (error) {
    ctx.trace("conversation:auto-title:fallback-error", {
      conversationId,
      branchId,
      error: error instanceof Error ? error.message : "unknown",
    });
  }

  const latestSnapshot = latestResult.snapshot;
  const latestVersion = latestResult.version;

  void maybeAutoSummarizeRootBranchTitle({
    ctx,
    conversationId,
    snapshot: latestSnapshot,
    branchId,
  }).catch((error) => {
    ctx.trace("conversation:auto-title:deferred-error", {
      conversationId,
      branchId,
      error: error instanceof Error ? error.message : "unknown",
    });
  });

  attachmentsToRestore = null;
  return {
    conversationId,
    snapshot: latestSnapshot,
    version: latestVersion,
    appendedMessages: [userMessage, finalAssistantMessage],
  };
  } catch (error) {
    if (attachmentsToRestore && attachmentsToRestore.length > 0) {
      for (const attachment of attachmentsToRestore) {
        try {
          const staged = await storeClient.stageAttachment(
            {
              id: attachment.id,
              name: attachment.name,
              contentType: attachment.contentType,
              size: attachment.size,
              storageKey: attachment.storageKey,
              createdAt: attachment.createdAt ?? new Date().toISOString(),
            },
            { maxAllowed: MAX_ATTACHMENTS_PER_MESSAGE },
          );
          if (attachment.status === "ready") {
            await storeClient.finalizeAttachment(attachment.id, {
              size: attachment.size,
              uploadedAt:
                attachment.uploadedAt ?? staged.attachment.uploadedAt ?? new Date().toISOString(),
            });
          }
        } catch (restoreError) {
          ctx.trace("attachment:restore:failed", {
            conversationId,
            attachmentId: attachment.id,
            error: restoreError instanceof Error ? restoreError.message : "unknown",
          });
        }
      }
    }
    throw error;
  }
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
    archivedAt: null,
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

export async function archiveConversation(
  input: ArchiveConversationInput = {},
): Promise<ArchiveConversationResponse> {
  const requestInfo = getRequestInfo() as AppRequestInfo;
  const ctx = requestInfo.ctx as AppContext;
  const conversationId = input.conversationId ?? DEFAULT_CONVERSATION_ID;

  const entry = await archiveConversationDirectoryEntry(ctx, {
    id: conversationId,
  });

  ctx.trace("conversation:archive", {
    conversationId,
    archivedAt: entry.archivedAt,
  });

  return { entry };
}

export async function unarchiveConversation(
  input: UnarchiveConversationInput = {},
): Promise<UnarchiveConversationResponse> {
  const requestInfo = getRequestInfo() as AppRequestInfo;
  const ctx = requestInfo.ctx as AppContext;
  const conversationId = input.conversationId ?? DEFAULT_CONVERSATION_ID;

  const entry = await unarchiveConversationDirectoryEntry(ctx, {
    id: conversationId,
  });

  ctx.trace("conversation:unarchive", {
    conversationId,
  });

  return { entry };
}

export async function deleteConversation(
  input: DeleteConversationInput = {},
): Promise<DeleteConversationResponse> {
  const requestInfo = getRequestInfo() as AppRequestInfo;
  const ctx = requestInfo.ctx as AppContext;
  const conversationId = input.conversationId ?? DEFAULT_CONVERSATION_ID;

  const store = ctx.getConversationStore(conversationId);
  await store.reset().catch((error) => {
    ctx.trace("conversation:delete:reset-error", {
      conversationId,
      error: error instanceof Error ? error.message : "unknown",
    });
    throw error;
  });

  invalidateConversationCache(conversationId);
  await deleteConversationDirectoryEntry(ctx, { id: conversationId });

  ctx.trace("conversation:delete", { conversationId });

  return { conversationId };
}
