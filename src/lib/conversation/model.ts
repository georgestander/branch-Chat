import type { ConversationComposerTool } from "./tools";

export type ISODateTimeString = string;

export type ConversationModelId = string;
export type BranchId = string;
export type MessageId = string;

export const DEFAULT_CONVERSATION_MODEL = "gpt-5.6-terra";

export type ConversationRole = "user" | "assistant" | "system";

export type ComposerPreset = "fast" | "reasoning" | "study" | "custom";

export type ReasoningEffort =
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | "ultra";

export interface ComposerDefaults {
  preset: ComposerPreset;
  tools: ConversationComposerTool[];
}

export interface ConversationSettings {
  model: string;
  temperature: number;
  systemPrompt?: string | null;
  // Optional: applies only to reasoning models; ignored for chat-tuned models
  reasoningEffort?: ReasoningEffort | null;
  composerDefaults: ComposerDefaults;
}

export interface Conversation {
  id: ConversationModelId;
  ownerId?: string | null;
  rootBranchId: BranchId;
  createdAt: ISODateTimeString;
  settings: ConversationSettings;
}

export interface BranchSpan {
  start: number;
  end: number;
}

export interface BranchCreationSource {
  messageId: MessageId;
  span?: BranchSpan | null;
  excerpt?: string | null;
}

/**
 * Recoverable pointer into Codex's local conversation history.
 *
 * The Durable Object graph remains canonical. These identifiers only let the
 * bridge continue or fork a provider thread without replaying that graph.
 */
export interface CodexBranchInferenceContext {
  provider: "codex";
  threadId: string;
  lastTurnId?: string | null;
}

export interface CodexMessageInferenceContext {
  provider: "codex";
  threadId: string;
  turnId: string;
}

export interface Branch {
  id: BranchId;
  parentId?: BranchId | null;
  title: string;
  createdFrom: BranchCreationSource;
  messageIds: MessageId[];
  createdAt: ISODateTimeString;
  archivedAt?: ISODateTimeString | null;
  inferenceContext?: CodexBranchInferenceContext | null;
}

export interface TokenUsage {
  prompt: number;
  completion: number;
  cost: number;
}

export interface MessageAttachment {
  id: string;
  kind: "file";
  name: string;
  contentType: string;
  size: number;
  storageKey: string;
  openAIFileId?: string | null;
  description?: string | null;
  uploadedAt: ISODateTimeString;
}

export type PendingAttachmentStatus = "pending" | "ready";

export interface PendingAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  storageKey: string;
  status: PendingAttachmentStatus;
  createdAt: ISODateTimeString;
  uploadedAt?: ISODateTimeString | null;
  openAIFileId?: string | null;
  openAIFileStatus?: "pending" | "ready" | "failed" | null;
  openAIFileError?: string | null;
}

export type AttachmentChunkKind = "text" | "image";

export interface AttachmentChunk {
  id: string;
  attachmentId: string;
  conversationId: ConversationModelId;
  kind: AttachmentChunkKind;
  content: string;
  tokenCount: number;
  embedding: number[];
  createdAt: ISODateTimeString;
  metadata?: {
    fileName: string;
    contentType: string;
    size: number;
    pageNumber?: number | null;
    language?: string | null;
    summary?: string | null;
  } | null;
}

export interface AttachmentIngestionRecord {
  attachmentId: string;
  conversationId: ConversationModelId;
  status: "pending" | "ready" | "failed";
  chunkIds: string[];
  updatedAt: ISODateTimeString;
  summary?: string | null;
  error?: string | null;
  openAIFileId?: string | null;
}

export interface WebSearchSnippet {
  id: string;
  conversationId: ConversationModelId;
  title: string;
  url: string;
  snippet: string;
  embedding: number[];
  createdAt: ISODateTimeString;
  provider?: string | null;
}

export interface AttachmentChunkMatch {
  chunk: AttachmentChunk;
  similarity: number;
}

export interface WebSearchSnippetMatch {
  snippet: WebSearchSnippet;
  similarity: number;
}

export interface RetrievedContextChunk {
  id: string;
  type: "attachment" | "web";
  attachmentId?: string;
  title: string;
  content: string;
  relevance: number;
  metadata?: Record<string, unknown>;
}

export type ToolInvocationStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed";

export interface ToolInvocationError {
  message: string;
  code?: string;
}

export interface ToolInvocation {
  id: string;
  toolType: string;
  toolName?: string | null;
  callId?: string | null;
  input?: unknown;
  output?: unknown;
  status: ToolInvocationStatus;
  startedAt: ISODateTimeString;
  completedAt?: ISODateTimeString | null;
  error?: ToolInvocationError | null;
}

export interface Message {
  id: MessageId;
  branchId: BranchId;
  role: ConversationRole;
  content: string;
  createdAt: ISODateTimeString;
  tokenUsage?: TokenUsage | null;
  attachments?: MessageAttachment[] | null;
  toolInvocations?: ToolInvocation[] | null;
  inferenceContext?: CodexMessageInferenceContext | null;
}

export interface ConversationCanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface CanvasBranchNodeState {
  branchId: BranchId;
  x: number;
  y: number;
  width?: number;
  height?: number;
  folded: boolean;
  expanded: boolean;
}

export interface ConversationCanvasState {
  version: 2;
  viewport: ConversationCanvasViewport;
  focusedBranchId: BranchId | null;
  nodes: Record<BranchId, CanvasBranchNodeState>;
}

type ConversationCanvasSource =
  Partial<Omit<ConversationCanvasState, "version" | "nodes">> & {
    version?: 1 | 2;
    nodes?: Record<BranchId, Partial<CanvasBranchNodeState>>;
  };

export interface ConversationGraphSnapshot {
  conversation: Conversation;
  branches: Record<BranchId, Branch>;
  messages: Record<MessageId, Message>;
  canvas: ConversationCanvasState;
}

export interface ConversationCanvasPatch {
  viewport?: Partial<ConversationCanvasViewport> | null;
  focusedBranchId?: BranchId | null;
  nodes?: Record<BranchId, Partial<CanvasBranchNodeState> | null>;
}

export type ConversationGraphUpdate =
  | {
      type: "message:append";
      conversationId: ConversationModelId;
      message: Message;
    }
  | {
      type: "message:update";
      conversationId: ConversationModelId;
      message: Message;
    }
  | {
      type: "branch:create";
      conversationId: ConversationModelId;
      branch: Branch;
    }
  | {
      type: "branch:update";
      conversationId: ConversationModelId;
      branch: Branch;
    }
  | {
      type: "branch:delete";
      conversationId: ConversationModelId;
      branchId: BranchId;
    }
  | {
      type: "conversation:update";
      conversation: Conversation;
    }
  | {
      type: "canvas:update";
      conversationId: ConversationModelId;
      patch: ConversationCanvasPatch;
    };

const DEFAULT_CANVAS_VIEWPORT: ConversationCanvasViewport = {
  x: 0,
  y: 0,
  zoom: 1,
};

const DEFAULT_CANVAS_DEPTH_SPACING = 420;
const DEFAULT_CANVAS_SIBLING_SPACING = 220;

function buildCanvasNodeLayout(
  snapshot: Pick<ConversationGraphSnapshot, "conversation" | "branches">,
): Record<BranchId, CanvasBranchNodeState> {
  const childrenByParent = new Map<BranchId, Branch[]>();

  for (const branch of Object.values(snapshot.branches)) {
    if (!branch.parentId) {
      continue;
    }
    const siblings = childrenByParent.get(branch.parentId) ?? [];
    siblings.push(branch);
    childrenByParent.set(branch.parentId, siblings);
  }

  for (const siblings of childrenByParent.values()) {
    siblings.sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    );
  }

  const ordered: Array<{ branch: Branch; depth: number }> = [];
  const traverse = (branchId: BranchId, depth: number) => {
    const branch = snapshot.branches[branchId];
    if (!branch) {
      return;
    }
    ordered.push({ branch, depth });
    for (const child of childrenByParent.get(branchId) ?? []) {
      traverse(child.id, depth + 1);
    }
  };

  traverse(snapshot.conversation.rootBranchId, 0);

  return Object.fromEntries(
    ordered.map(({ branch, depth }, index) => [
      branch.id,
      {
        branchId: branch.id,
        x: depth * DEFAULT_CANVAS_DEPTH_SPACING,
        y: index * DEFAULT_CANVAS_SIBLING_SPACING,
        folded: false,
        expanded: branch.id === snapshot.conversation.rootBranchId,
      } satisfies CanvasBranchNodeState,
    ]),
  );
}

export function normalizeConversationCanvasState(
  snapshot: Pick<ConversationGraphSnapshot, "conversation" | "branches"> & {
    canvas?: ConversationCanvasSource | null;
  },
): ConversationCanvasState {
  const layout = buildCanvasNodeLayout(snapshot);
  const source = snapshot.canvas ?? null;
  const viewport = source?.viewport ?? null;
  const normalizedNodes: Record<BranchId, CanvasBranchNodeState> = {};

  for (const [branchId, branch] of Object.entries(snapshot.branches)) {
    const fallback = layout[branchId as BranchId];
    const candidate = source?.nodes?.[branchId as BranchId];
    normalizedNodes[branchId as BranchId] = {
      branchId: branch.id,
      x:
        typeof candidate?.x === "number" && Number.isFinite(candidate.x)
          ? candidate.x
          : fallback?.x ?? 0,
      y:
        typeof candidate?.y === "number" && Number.isFinite(candidate.y)
          ? candidate.y
          : fallback?.y ?? 0,
      ...(typeof candidate?.width === "number" &&
      Number.isFinite(candidate.width) &&
      candidate.width > 0
        ? { width: candidate.width }
        : {}),
      ...(typeof candidate?.height === "number" &&
      Number.isFinite(candidate.height) &&
      candidate.height > 0
        ? { height: candidate.height }
        : {}),
      folded: candidate?.folded === true,
      expanded:
        typeof candidate?.expanded === "boolean"
          ? candidate.expanded
          : source?.version !== 2 && branch.id === snapshot.conversation.rootBranchId,
    };
  }

  const focusedBranchId =
    typeof source?.focusedBranchId === "string" &&
    snapshot.branches[source.focusedBranchId]
      ? source.focusedBranchId
      : snapshot.conversation.rootBranchId;

  return {
    version: 2,
    viewport: {
      x:
        typeof viewport?.x === "number" && Number.isFinite(viewport.x)
          ? viewport.x
          : DEFAULT_CANVAS_VIEWPORT.x,
      y:
        typeof viewport?.y === "number" && Number.isFinite(viewport.y)
          ? viewport.y
          : DEFAULT_CANVAS_VIEWPORT.y,
      zoom:
        typeof viewport?.zoom === "number" &&
        Number.isFinite(viewport.zoom) &&
        viewport.zoom > 0
          ? viewport.zoom
          : DEFAULT_CANVAS_VIEWPORT.zoom,
    },
    focusedBranchId,
    nodes: normalizedNodes,
  };
}

export function applyCanvasPatch(
  snapshot: ConversationGraphSnapshot,
  patch: ConversationCanvasPatch,
): ConversationCanvasState {
  const current = normalizeConversationCanvasState(snapshot);
  const nextNodes: Record<BranchId, CanvasBranchNodeState> = {
    ...current.nodes,
  };

  for (const [branchId, update] of Object.entries(patch.nodes ?? {})) {
    if (!snapshot.branches[branchId as BranchId]) {
      continue;
    }
    if (update === null) {
      delete nextNodes[branchId as BranchId];
      continue;
    }
    const existing = nextNodes[branchId as BranchId] ?? {
      branchId: branchId as BranchId,
      x: 0,
      y: 0,
      folded: false,
      expanded: branchId === snapshot.conversation.rootBranchId,
    };
    nextNodes[branchId as BranchId] = {
      branchId: branchId as BranchId,
      x:
        typeof update.x === "number" && Number.isFinite(update.x)
          ? update.x
          : existing.x,
      y:
        typeof update.y === "number" && Number.isFinite(update.y)
          ? update.y
          : existing.y,
      ...(typeof update.width === "number" &&
      Number.isFinite(update.width) &&
      update.width > 0
        ? { width: update.width }
        : existing.width === undefined
          ? {}
          : { width: existing.width }),
      ...(typeof update.height === "number" &&
      Number.isFinite(update.height) &&
      update.height > 0
        ? { height: update.height }
        : existing.height === undefined
          ? {}
          : { height: existing.height }),
      folded:
        typeof update.folded === "boolean" ? update.folded : existing.folded,
      expanded:
        typeof update.expanded === "boolean" ? update.expanded : existing.expanded,
    };
  }

  return normalizeConversationCanvasState({
    conversation: snapshot.conversation,
    branches: snapshot.branches,
    canvas: {
      version: 2,
      viewport: {
        ...current.viewport,
        ...(patch.viewport ?? {}),
      },
      focusedBranchId:
        patch.focusedBranchId === undefined
          ? current.focusedBranchId
          : patch.focusedBranchId,
      nodes: nextNodes,
    },
  });
}

const FOCUSED_CHILD_HORIZONTAL_GAP = 110;
const FOCUSED_CHILD_CARD_HEIGHT = 360;
const COLLAPSED_BRANCH_CARD_HEIGHT = 190;
const FOCUSED_CHILD_VERTICAL_GAP = 32;

export function arrangeFocusedChildOnCanvas(
  snapshot: Pick<ConversationGraphSnapshot, "branches" | "canvas">,
  parentBranchId: BranchId,
  branchId: BranchId,
): NonNullable<ConversationCanvasPatch["nodes"]> {
  const parentNode = snapshot.canvas.nodes[parentBranchId];
  const parentX = parentNode?.x ?? 0;
  const parentY = parentNode?.y ?? 0;
  const parentWidth = parentNode?.width ?? 680;
  const updates: NonNullable<ConversationCanvasPatch["nodes"]> = {};

  for (const existingBranch of Object.values(snapshot.branches)) {
    if (existingBranch.id === parentBranchId || existingBranch.id === branchId) {
      continue;
    }
    updates[existingBranch.id] = { expanded: false };
  }

  const siblings = Object.values(snapshot.branches)
    .filter(
      (existingBranch) =>
        existingBranch.parentId === parentBranchId &&
        existingBranch.id !== branchId,
    )
    .sort((left, right) => {
      const leftY = snapshot.canvas.nodes[left.id]?.y ?? 0;
      const rightY = snapshot.canvas.nodes[right.id]?.y ?? 0;
      return (
        leftY - rightY ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id)
      );
    });
  const firstSiblingY =
    parentY + FOCUSED_CHILD_CARD_HEIGHT + FOCUSED_CHILD_VERTICAL_GAP;
  siblings.forEach((sibling, index) => {
    updates[sibling.id] = {
      ...updates[sibling.id],
      y:
        firstSiblingY +
        index * (COLLAPSED_BRANCH_CARD_HEIGHT + FOCUSED_CHILD_VERTICAL_GAP),
    };
  });

  updates[parentBranchId] = { expanded: true };
  updates[branchId] = {
    x: parentX + parentWidth + FOCUSED_CHILD_HORIZONTAL_GAP,
    y: parentY,
    expanded: true,
  };
  return updates;
}

export function placeNewBranchOnCanvas(
  snapshot: Pick<ConversationGraphSnapshot, "branches" | "canvas">,
  parentBranchId: BranchId,
  branchId: BranchId,
): { x: number; y: number } {
  const placement = arrangeFocusedChildOnCanvas(
    snapshot,
    parentBranchId,
    branchId,
  )[branchId];
  return { x: placement?.x ?? 0, y: placement?.y ?? 0 };
}

export function createConversationSnapshot(input: {
  id: ConversationModelId;
  ownerId?: string | null;
  createdAt?: ISODateTimeString;
  settings: ConversationSettings;
  rootBranch: Pick<Branch, "id" | "title" | "createdFrom" | "createdAt">;
  initialMessages?: Message[];
}): ConversationGraphSnapshot {
  const createdAt = (input.createdAt ??
    new Date().toISOString()) as ISODateTimeString;

  const rootBranch: Branch = {
    id: input.rootBranch.id,
    parentId: null,
    title: input.rootBranch.title,
    createdFrom: input.rootBranch.createdFrom,
    createdAt: input.rootBranch.createdAt,
    messageIds: [],
    archivedAt: undefined,
    inferenceContext: undefined,
  };

  const snapshot: ConversationGraphSnapshot = {
    conversation: {
      id: input.id,
      ownerId: input.ownerId ?? null,
      rootBranchId: rootBranch.id,
      createdAt,
      settings: input.settings,
    },
    branches: {
      [rootBranch.id]: rootBranch,
    },
    messages: {},
    canvas: {
      version: 2,
      viewport: { ...DEFAULT_CANVAS_VIEWPORT },
      focusedBranchId: rootBranch.id,
      nodes: {
        [rootBranch.id]: {
          branchId: rootBranch.id,
          x: 0,
          y: 0,
          folded: false,
          expanded: true,
        },
      },
    },
  };

  for (const message of input.initialMessages ?? []) {
    snapshot.messages[message.id] = message;
    const branch = snapshot.branches[message.branchId];
    if (branch) {
      branch.messageIds.push(message.id);
    }
  }

  snapshot.canvas = normalizeConversationCanvasState(snapshot);
  return snapshot;
}

export function cloneConversationSnapshot(
  snapshot: ConversationGraphSnapshot,
): ConversationGraphSnapshot {
  const cloneUnknown = <T>(value: T): T => {
    if (value === undefined || value === null) {
      return value;
    }
    if (typeof globalThis.structuredClone === "function") {
      return globalThis.structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value)) as T;
  };

  return {
    conversation: { ...snapshot.conversation },
    branches: Object.fromEntries(
      Object.entries(snapshot.branches).map(([id, branch]) => [
        id,
        {
          ...branch,
          messageIds: [...branch.messageIds],
          inferenceContext: branch.inferenceContext
            ? { ...branch.inferenceContext }
            : branch.inferenceContext,
        },
      ]),
    ),
    messages: Object.fromEntries(
      Object.entries(snapshot.messages).map(([id, message]) => {
        const usage = message.tokenUsage;
        const attachments = message.attachments;
        const toolInvocations = message.toolInvocations;
        return [
          id,
          {
            ...message,
            tokenUsage:
              usage && typeof usage === "object"
                ? { ...usage }
                : usage === null
                  ? null
                  : undefined,
            attachments:
              attachments && Array.isArray(attachments)
                ? attachments.map((attachment) => ({ ...attachment }))
                : attachments === null
                  ? null
                  : undefined,
            toolInvocations:
              toolInvocations && Array.isArray(toolInvocations)
                ? toolInvocations.map((invocation) => ({
                    ...invocation,
                    input: cloneUnknown(invocation.input),
                    output: cloneUnknown(invocation.output),
                    error: invocation.error ? { ...invocation.error } : invocation.error,
                  }))
                : toolInvocations === null
                  ? null
                  : undefined,
            inferenceContext: message.inferenceContext
              ? { ...message.inferenceContext }
              : message.inferenceContext,
          },
        ];
      }),
    ),
    canvas: {
      version: 2,
      viewport: { ...snapshot.canvas.viewport },
      focusedBranchId: snapshot.canvas.focusedBranchId,
      nodes: Object.fromEntries(
        Object.entries(snapshot.canvas.nodes).map(([branchId, node]) => [
          branchId,
          { ...node },
        ]),
      ),
    },
  };
}

export function deleteBranchSubtree(
  snapshot: ConversationGraphSnapshot,
  branchId: BranchId,
): BranchId[] {
  if (branchId === snapshot.conversation.rootBranchId) {
    throw new Error("The root branch cannot be deleted");
  }
  if (!snapshot.branches[branchId]) {
    throw new Error(`Branch ${branchId} not found`);
  }

  const branchIds = new Set<BranchId>([branchId]);
  let foundDescendant = true;
  while (foundDescendant) {
    foundDescendant = false;
    for (const branch of Object.values(snapshot.branches)) {
      if (
        branch.parentId &&
        branchIds.has(branch.parentId) &&
        !branchIds.has(branch.id)
      ) {
        branchIds.add(branch.id);
        foundDescendant = true;
      }
    }
  }

  for (const [messageId, message] of Object.entries(snapshot.messages)) {
    if (branchIds.has(message.branchId)) {
      delete snapshot.messages[messageId];
    }
  }
  for (const deletedBranchId of branchIds) {
    delete snapshot.branches[deletedBranchId];
  }

  const nextCanvasNodes = { ...snapshot.canvas.nodes };
  for (const deletedBranchId of branchIds) {
    delete nextCanvasNodes[deletedBranchId];
  }
  snapshot.canvas = normalizeConversationCanvasState({
    conversation: {
      ...snapshot.conversation,
    },
    branches: snapshot.branches,
    canvas: {
      ...snapshot.canvas,
      focusedBranchId: branchIds.has(snapshot.canvas.focusedBranchId ?? "")
        ? null
        : snapshot.canvas.focusedBranchId,
      nodes: nextCanvasNodes,
    },
  });

  return [...branchIds];
}
