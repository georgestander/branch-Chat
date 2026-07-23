import {
  applyCanvasPatch,
  cloneConversationSnapshot,
  deleteBranchSubtree,
  normalizeConversationCanvasState,
  type Branch,
  type Conversation,
  type ConversationGraphSnapshot,
  type ConversationGraphUpdate,
  type Message,
} from "./model.ts";

export interface ApplyConversationGraphUpdatesOptions {
  allowMissing?: boolean;
}

function cloneValue<T>(value: T): T {
  return globalThis.structuredClone(value);
}

function createEmptySnapshot(conversation: Conversation): ConversationGraphSnapshot {
  return {
    conversation: cloneValue(conversation),
    branches: {},
    messages: {},
    canvas: {
      version: 2,
      viewport: { x: 0, y: 0, zoom: 1 },
      focusedBranchId: null,
      nodes: {},
    },
  };
}

function assertConversationId(
  snapshot: ConversationGraphSnapshot,
  update: ConversationGraphUpdate,
): void {
  const updateConversationId =
    update.type === "conversation:update"
      ? update.conversation.id
      : update.conversationId;
  if (updateConversationId !== snapshot.conversation.id) {
    throw new Error(
      `Update conversation ${updateConversationId} does not match ${snapshot.conversation.id}`,
    );
  }
}

function addBranch(
  snapshot: ConversationGraphSnapshot,
  branch: Branch,
): void {
  if (snapshot.branches[branch.id]) {
    throw new Error(`Branch ${branch.id} already exists`);
  }
  if (branch.parentId && !snapshot.branches[branch.parentId]) {
    throw new Error(`Parent branch ${branch.parentId} does not exist`);
  }
  snapshot.branches[branch.id] = cloneValue(branch);
}

function updateBranch(
  snapshot: ConversationGraphSnapshot,
  branch: Branch,
): void {
  if (!snapshot.branches[branch.id]) {
    throw new Error(`Cannot update missing branch ${branch.id}`);
  }
  if (branch.parentId && !snapshot.branches[branch.parentId]) {
    throw new Error(`Parent branch ${branch.parentId} does not exist`);
  }
  snapshot.branches[branch.id] = cloneValue(branch);
}

function appendMessage(
  snapshot: ConversationGraphSnapshot,
  message: Message,
): void {
  const branch = snapshot.branches[message.branchId];
  if (!branch) {
    throw new Error(
      `Branch ${message.branchId} missing for message ${message.id}`,
    );
  }
  snapshot.messages[message.id] = cloneValue(message);
  if (!branch.messageIds.includes(message.id)) {
    branch.messageIds.push(message.id);
  }
}

function updateMessage(
  snapshot: ConversationGraphSnapshot,
  message: Message,
): void {
  const existing = snapshot.messages[message.id];
  if (!existing) {
    throw new Error(`Cannot update missing message ${message.id}`);
  }
  const branch = snapshot.branches[message.branchId];
  if (!branch) {
    throw new Error(
      `Branch ${message.branchId} missing for message ${message.id}`,
    );
  }

  if (existing.branchId !== message.branchId) {
    const previousBranch = snapshot.branches[existing.branchId];
    if (previousBranch) {
      previousBranch.messageIds = previousBranch.messageIds.filter(
        (messageId) => messageId !== message.id,
      );
    }
  }

  snapshot.messages[message.id] = {
    ...existing,
    ...cloneValue(message),
    tokenUsage: message.tokenUsage ?? existing.tokenUsage,
  };
  if (!branch.messageIds.includes(message.id)) {
    branch.messageIds.push(message.id);
  }
}

export function applyConversationGraphUpdates(
  snapshot: ConversationGraphSnapshot | null,
  updates: readonly ConversationGraphUpdate[],
  options: ApplyConversationGraphUpdatesOptions = {},
): ConversationGraphSnapshot {
  let next = snapshot ? cloneConversationSnapshot(snapshot) : null;

  if (!next) {
    if (!options.allowMissing) {
      throw new Error("Snapshot not initialized");
    }
    const conversationUpdate = updates.find(
      (update): update is Extract<
        ConversationGraphUpdate,
        { type: "conversation:update" }
      > => update.type === "conversation:update",
    );
    if (!conversationUpdate) {
      throw new Error("Missing conversation data for initialization");
    }
    next = createEmptySnapshot(conversationUpdate.conversation);
  }

  for (const update of updates) {
    assertConversationId(next, update);
    switch (update.type) {
      case "conversation:update": {
        next.conversation = cloneValue(update.conversation);
        break;
      }
      case "canvas:update": {
        next.canvas = applyCanvasPatch(next, cloneValue(update.patch));
        break;
      }
      case "branch:create": {
        addBranch(next, update.branch);
        break;
      }
      case "branch:update": {
        updateBranch(next, update.branch);
        break;
      }
      case "branch:delete": {
        deleteBranchSubtree(next, update.branchId);
        break;
      }
      case "message:append": {
        appendMessage(next, update.message);
        break;
      }
      case "message:update": {
        updateMessage(next, update.message);
        break;
      }
      case "message:delete": {
        const messageIds = new Set(update.messageIds);
        for (const messageId of messageIds) {
          delete next.messages[messageId];
        }
        for (const branch of Object.values(next.branches)) {
          branch.messageIds = branch.messageIds.filter(
            (messageId) => !messageIds.has(messageId),
          );
        }
        break;
      }
      default: {
        const exhaustiveCheck: never = update;
        throw new Error(
          `Unsupported update type ${(exhaustiveCheck as { type?: unknown }).type}`,
        );
      }
    }
  }

  if (!next.branches[next.conversation.rootBranchId]) {
    throw new Error(
      `Root branch ${next.conversation.rootBranchId} does not exist`,
    );
  }
  next.canvas = normalizeConversationCanvasState(next);
  return next;
}
