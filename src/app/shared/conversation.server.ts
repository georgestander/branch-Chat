import type { AppContext } from "@/app/context";
import {
  createConversationSnapshot,
  type Branch,
  type BranchId,
  type BranchSpan,
  type ConversationGraphSnapshot,
  type ConversationGraphUpdate,
  type ConversationModelId,
  type ConversationSettings,
  type Message,
} from "@/lib/conversation";

import { getConversationStoreClient } from "./conversationStore.server";
import {
  ensureConversationDirectoryEntry,
  touchConversationDirectoryEntry,
} from "./conversationDirectory.server";

const DEFAULT_MODEL = "gpt-5-nano";
const DEFAULT_TEMPERATURE = 0.1;

export const DEFAULT_BRANCH_TITLE = "Main Branch";
export const MAX_BRANCH_TITLE_LENGTH = 60;

export const DEFAULT_CONVERSATION_ID: ConversationModelId = "default-dev";

const PLAN_REQUEST_PATTERNS: RegExp[] = [
  /\bplan\b/i,
  /\broadmap\b/i,
  /\baction\s+plan\b/i,
  /\bexecution\s+plan\b/i,
  /\bimplementation\s+plan\b/i,
  /\bimplementation\s+steps\b/i,
  /\bstrategy\b/i,
  /\bstep[-\s]*by[-\s]*step\b/i,
  /\bwhat'?s\s+the\s+plan\b/i,
];

const PLAN_SECONDARY_PATTERNS: Array<(value: string) => boolean> = [
  (value) => value.includes("outline") && value.includes("steps"),
  (value) => value.includes("how do i") && value.includes("steps"),
  (value) => value.includes("walk me through"),
  (value) => value.includes("give me") && value.includes("steps"),
  (value) => value.includes("what is the approach"),
];

const PLAN_FORMATTING_PROMPT = [
  "Because the user is asking for a plan, format the reply with this exact contract:",
  "1. Begin with a single sentence line that starts with `Short answer:` summarizing the recommendation.",
  "2. Add a blank line followed by `# Plan`.",
  "3. Under `# Plan`, emit an ordered list. Each list item should lead with a short, Title Case label (bold is encouraged) and include compact sub-bullets describing the actions, decision points, or caveats for that step.",
  "4. When actionable execution details are available, include a `## Step-by-step build (copy/paste)` section containing numbered instructions the user can follow directly.",
  "5. When the work involves constraints, risks, or prerequisites, include a `## Key constraints to remember` section with bullet points.",
  "6. Cite supporting material inline with bracket references such as `([Source][1])` and finish with a `References` section that lists `[n]: URL \"Title\"` entries (reuse web-search sources when present, omit the section only if there are truly no sources).",
  "7. Keep the Markdown tidy, avoid redundant prose, and do not add explanations outside these sections.",
].join("\n");

export function generateConversationId(): ConversationModelId {
  const random = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `conversation-${random}` as ConversationModelId;
}

type SnapshotCacheEntry = {
  version: number;
  snapshot: ConversationGraphSnapshot;
};

const SNAPSHOT_CACHE: Map<ConversationModelId, SnapshotCacheEntry> = new Map();

function getCachedSnapshot(
  conversationId: ConversationModelId,
): SnapshotCacheEntry | undefined {
  return SNAPSHOT_CACHE.get(conversationId);
}

function setCachedSnapshot(
  conversationId: ConversationModelId,
  entry: SnapshotCacheEntry,
): void {
  SNAPSHOT_CACHE.set(conversationId, entry);
}

export interface ConversationLoadResult {
  conversationId: ConversationModelId;
  snapshot: ConversationGraphSnapshot;
  version: number;
}

export interface BranchTreeNode {
  branch: Branch;
  children: BranchTreeNode[];
  depth: number;
}

export async function ensureConversationSnapshot(
  ctx: AppContext,
  conversationId: ConversationModelId = DEFAULT_CONVERSATION_ID,
): Promise<ConversationLoadResult> {
  const cached = getCachedSnapshot(conversationId);
  if (cached) {
    ctx.trace("conversation:cache:hit", {
      conversationId,
      version: cached.version,
    });
    return {
      conversationId,
      snapshot: cached.snapshot,
      version: cached.version,
    };
  }

  const client = getConversationStoreClient(ctx, conversationId);
  const result = await client.read();

  if (result.snapshot) {
    ctx.trace("conversation:load", {
      conversationId,
      version: result.version,
      payloadBytes: JSON.stringify(result.snapshot).length,
    });

    setCachedSnapshot(conversationId, {
      snapshot: result.snapshot,
      version: result.version,
    });

    return {
      conversationId,
      snapshot: result.snapshot,
      version: result.version,
    };
  }

  const initialized = await initializeConversation(ctx, client, conversationId);
  return initialized;
}

export function getBranchMessages(
  snapshot: ConversationGraphSnapshot,
  branchId: BranchId,
): Message[] {
  const branch = snapshot.branches[branchId];
  if (!branch) {
    return [];
  }

  return branch.messageIds
    .map((id) => snapshot.messages[id])
    .filter((msg): msg is Message => Boolean(msg));
}

export function getBranchAncestors(
  snapshot: ConversationGraphSnapshot,
  branchId: BranchId,
): Branch[] {
  const result: Branch[] = [];
  let current: Branch | undefined | null = snapshot.branches[branchId];

  while (current) {
    result.push(current);
    if (!current.parentId) {
      break;
    }
    current = snapshot.branches[current.parentId] ?? null;
  }

  return result.reverse();
}

export function buildBranchTree(
  snapshot: ConversationGraphSnapshot,
): BranchTreeNode {
  const childrenMap = new Map<BranchId, Branch[]>();

  for (const branch of Object.values(snapshot.branches)) {
    if (!branch.parentId) {
      continue;
    }
    const siblings = childrenMap.get(branch.parentId) ?? [];
    siblings.push(branch);
    childrenMap.set(branch.parentId, siblings);
  }

  const buildNode = (branch: Branch, depth: number): BranchTreeNode => {
    const children = (childrenMap.get(branch.id) ?? [])
      .sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      )
      .map((child) => buildNode(child, depth + 1));
    return { branch, children, depth };
  };

  const rootBranch = snapshot.branches[snapshot.conversation.rootBranchId];
  if (!rootBranch) {
    throw new Error("Root branch missing from snapshot");
  }

  return buildNode(rootBranch, 0);
}

export function draftBranchFromSelection(options: {
  snapshot: ConversationGraphSnapshot;
  parentBranchId: BranchId;
  messageId: string;
  span?: BranchSpan | null;
  title?: string;
  excerpt?: string | null;
}): Branch {
  const { snapshot, parentBranchId, messageId, span, title, excerpt } = options;
  const parentBranch = snapshot.branches[parentBranchId];
  if (!parentBranch) {
    throw new Error(`Parent branch ${parentBranchId} not found`);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const derivedTitle = deriveBranchTitle({
    explicitTitle: title,
    excerpt: excerpt ?? null,
    fallbackId: id,
  });

  return {
    id,
    parentId: parentBranchId,
    title: derivedTitle,
    createdFrom: {
      messageId,
      span: span ?? undefined,
      excerpt: excerpt ?? undefined,
    },
    messageIds: [],
    createdAt: now,
    archivedAt: undefined,
  };
}

const MAX_BRANCH_TITLE_CHARS = 20;

function deriveBranchTitle(options: {
  explicitTitle?: string;
  excerpt: string | null;
  fallbackId: string;
}): string {
  const { explicitTitle, excerpt, fallbackId } = options;
  if (explicitTitle && explicitTitle.trim().length > 0) {
    return explicitTitle.trim();
  }

  if (excerpt) {
    const normalized = excerpt.replace(/\s+/g, " ").trim();
    if (normalized.length > 0) {
      if (normalized.length <= MAX_BRANCH_TITLE_CHARS) {
        return normalized;
      }
      return `${normalized.slice(0, MAX_BRANCH_TITLE_CHARS).trimEnd()}...`;
    }
  }

  return `Branch ${fallbackId.slice(0, 6)}`;
}

export async function applyConversationUpdates(
  ctx: AppContext,
  conversationId: ConversationModelId,
  updates: ConversationGraphUpdate[],
  options: { touchDirectory?: boolean } = {},
): Promise<ConversationLoadResult> {
  const client = getConversationStoreClient(ctx, conversationId);
  const applied = await client.apply(updates);

  if (!applied.snapshot) {
    throw new Error("Conversation snapshot missing after apply");
  }

  ctx.trace("conversation:apply", {
    conversationId,
    version: applied.version,
    updateCount: updates.length,
  });

  setCachedSnapshot(conversationId, {
    version: applied.version,
    snapshot: applied.snapshot,
  });

  const shouldTouchDirectory = options.touchDirectory ?? true;
  if (shouldTouchDirectory) {
    const branchCount = Object.keys(applied.snapshot.branches).length;
    const rootBranch =
      applied.snapshot.branches[applied.snapshot.conversation.rootBranchId];
    await touchConversationDirectoryEntry(ctx, {
      id: conversationId,
      branchCount,
      title: rootBranch?.title ?? conversationId,
    });
  }

  return {
    conversationId,
    snapshot: applied.snapshot,
    version: applied.version,
  };
}

export function sanitizeBranchTitle(
  input: string | null | undefined,
  fallback: string = DEFAULT_BRANCH_TITLE,
): string {
  if (!input) {
    return fallback;
  }

  const collapsed = input.replace(/\s+/g, " ").trim();
  if (!collapsed) {
    return fallback;
  }

  if (collapsed.length <= MAX_BRANCH_TITLE_LENGTH) {
    return collapsed;
  }

  return collapsed.slice(0, MAX_BRANCH_TITLE_LENGTH).trimEnd();
}

export async function maybeAutoSummarizeRootBranchTitle(options: {
  ctx: AppContext;
  conversationId: ConversationModelId;
  snapshot: ConversationGraphSnapshot;
  branchId: BranchId;
}): Promise<ConversationLoadResult | null> {
  const { ctx, conversationId, snapshot, branchId } = options;
  const branch = snapshot.branches[branchId];
  if (!branch || branch.parentId) {
    return null;
  }

  if (branch.title && branch.title !== DEFAULT_BRANCH_TITLE) {
    return null;
  }

  const messages = getBranchMessages(snapshot, branchId);
  const nonSystemMessages = messages.filter((message) => message.role !== "system");
  const firstUserMessage = nonSystemMessages.find(
    (message) => message.role === "user" && message.content.trim().length > 0,
  );
  const firstAssistantMessage = nonSystemMessages.find(
    (message) => message.role === "assistant" && message.content.trim().length > 0,
  );

  if (!firstUserMessage || !firstAssistantMessage) {
    return null;
  }

  const openai = ctx.getOpenAIClient();
  const truncateForPrompt = (value: string): string => {
    const trimmed = value.trim();
    if (trimmed.length <= 512) {
      return trimmed;
    }
    return `${trimmed.slice(0, 509).trimEnd()}…`;
  };

  const promptUser = truncateForPrompt(firstUserMessage.content);
  const promptAssistant = truncateForPrompt(firstAssistantMessage.content);

  try {
    ctx.trace("conversation:auto-title:start", {
      conversationId,
      branchId,
      model: "gpt-5-nano",
    });

    const response = await openai.responses.create({
      model: "gpt-5-nano",
      temperature: 0.2,
      max_output_tokens: 32,
      input: [
        {
          role: "system",
          content:
            "You generate concise chat titles. Respond with a short title under 6 words summarizing the conversation. Avoid quotation marks and punctuation at the end.",
        },
        {
          role: "user",
          content: `User request: ${promptUser}\nAssistant reply: ${promptAssistant}\nTitle:`,
        },
      ],
    });

    const candidate = response.output_text?.trim();
    const cleaned = candidate
      ? candidate
          .replace(/^["'\-\s]+/, "")
          .replace(/["'\s]+$/, "")
          .replace(/\.\s*$/, "")
      : "";
    const sanitized = sanitizeBranchTitle(cleaned, DEFAULT_BRANCH_TITLE);

    if (!sanitized || sanitized === branch.title) {
      ctx.trace("conversation:auto-title:skip", {
        conversationId,
        branchId,
        reason: "empty-or-unchanged",
      });
      return null;
    }

    ctx.trace("conversation:auto-title:applied", {
      conversationId,
      branchId,
      title: sanitized,
    });

    return applyConversationUpdates(ctx, conversationId, [
      {
        type: "branch:update",
        conversationId,
        branch: {
          ...branch,
          title: sanitized,
        },
      },
    ]);
  } catch (error) {
    ctx.trace("conversation:auto-title:error", {
      conversationId,
      branchId,
      error: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}

export function buildResponseInputFromBranch(options: {
  snapshot: ConversationGraphSnapshot;
  branchId: BranchId;
  nextUserContent: string;
}): Array<{
  role: "system" | "user" | "assistant";
  content: string;
}> {
  const { snapshot, branchId, nextUserContent } = options;
  const chain = getBranchChain(snapshot, branchId);

  const orderedMessages: Message[] = [];
  for (let index = 0; index < chain.length; index++) {
    const branch = chain[index];
    const branchMessages = getBranchMessages(snapshot, branch.id);

    const isTargetBranch = index === chain.length - 1;
    if (isTargetBranch) {
      orderedMessages.push(...branchMessages.filter((message) => message.content.trim().length > 0));
      continue;
    }

    const childBranch = chain[index + 1];
    const cutOffId = childBranch.createdFrom?.messageId;
    if (!cutOffId) {
      orderedMessages.push(...branchMessages.filter((message) => message.content.trim().length > 0));
      continue;
    }

    const cutOffIndex = branchMessages.findIndex((message) => message.id === cutOffId);
    const sliceEnd = cutOffIndex >= 0 ? cutOffIndex + 1 : branchMessages.length;
    orderedMessages.push(
      ...branchMessages
        .slice(0, sliceEnd)
        .filter((message) => message.content.trim().length > 0),
    );
  }

  const inputs: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [];

  const systemPrompt = snapshot.conversation.settings.systemPrompt;
  if (systemPrompt?.trim()) {
    inputs.push({
      role: "system",
      content: systemPrompt,
    });
  }

  const planFormattingEnabled = shouldApplyPlanFormatting(nextUserContent);
  if (planFormattingEnabled) {
    inputs.push({
      role: "system",
      content: PLAN_FORMATTING_PROMPT,
    });
  }

  if (orderedMessages.length > 0) {
    const lastMessage = orderedMessages[orderedMessages.length - 1];
    if (
      lastMessage.role === "user" &&
      lastMessage.content.trim() === nextUserContent.trim()
    ) {
      orderedMessages.pop();
    }
  }

  for (const message of orderedMessages) {
    inputs.push({
      role: message.role,
      content: message.content,
    });
  }

  const branch = snapshot.branches[branchId];
  const excerpt = branch?.createdFrom?.excerpt?.trim();
  if (excerpt) {
    inputs.push({
      role: "user",
      content: `For reference, this question refers to the highlighted portion of the parent response: "${excerpt}"`,
    });
  }

  inputs.push({
    role: "user",
    content: nextUserContent,
  });

  return inputs;
}

function shouldApplyPlanFormatting(nextUserContent: string): boolean {
  if (!nextUserContent) {
    return false;
  }

  const normalized = nextUserContent.toLowerCase();
  const condensed = normalized.replace(/\s+/g, " ");

  if (PLAN_REQUEST_PATTERNS.some((pattern) => pattern.test(condensed))) {
    return true;
  }

  return PLAN_SECONDARY_PATTERNS.some((predicate) => predicate(condensed));
}

export function getBranchChain(
  snapshot: ConversationGraphSnapshot,
  branchId: BranchId,
): Branch[] {
  const chain: Branch[] = [];
  let current: Branch | undefined = snapshot.branches[branchId];

  while (current) {
    chain.push(current);
    if (!current.parentId) {
      break;
    }
    current = snapshot.branches[current.parentId];
  }

  return chain.reverse();
}

function getDefaultConversationSettings(): ConversationSettings {
  return {
    model: DEFAULT_MODEL,
    temperature: DEFAULT_TEMPERATURE,
    systemPrompt:
      "You are Connexus, a branching conversation assistant. Provide concise, structured replies to help users explore alternatives.",
  };
}

async function initializeConversation(
  ctx: AppContext,
  client: ReturnType<typeof getConversationStoreClient>,
  conversationId: ConversationModelId,
): Promise<ConversationLoadResult> {
  const now = new Date().toISOString();
  const rootBranchId: BranchId = `${conversationId}:root`;

  const snapshot = createConversationSnapshot({
    id: conversationId,
    createdAt: now,
    settings: getDefaultConversationSettings(),
    rootBranch: {
      id: rootBranchId,
      title: DEFAULT_BRANCH_TITLE,
      createdFrom: null,
      createdAt: now,
    },
  });

  const replaced = await client.replace(snapshot);

  if (!replaced.snapshot) {
    throw new Error("Failed to initialize conversation snapshot");
  }

  ctx.trace("conversation:init", {
    conversationId,
    version: replaced.version,
  });

  setCachedSnapshot(conversationId, {
    version: replaced.version,
    snapshot: replaced.snapshot,
  });

  const branchCount = Object.keys(replaced.snapshot.branches).length;
  const rootBranch =
    replaced.snapshot.branches[replaced.snapshot.conversation.rootBranchId];
  await ensureConversationDirectoryEntry(ctx, {
    id: conversationId,
    title: rootBranch?.title ?? conversationId,
    branchCount,
    lastActiveAt: now,
  });

  return {
    conversationId,
    snapshot: replaced.snapshot,
    version: replaced.version,
  };
}
