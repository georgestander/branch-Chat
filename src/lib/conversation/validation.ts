import type {
  Branch,
  BranchId,
  BranchSpan,
  Conversation,
  ConversationGraphSnapshot,
  ConversationModelId,
  ConversationSettings,
  Message,
  MessageId,
  TokenUsage,
} from "./model";

type RecordLike = Record<string, unknown>;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

export function isIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    ISO_DATE_PATTERN.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function isObject(value: unknown): value is RecordLike {
  return typeof value === "object" && value !== null;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new TypeError(message);
  }
}

function validateTokenUsage(value: unknown): TokenUsage | undefined | null {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  assert(isObject(value), "tokenUsage must be an object");
  const { prompt, completion, cost } = value;
  assert(typeof prompt === "number", "tokenUsage.prompt must be a number");
  assert(
    typeof completion === "number",
    "tokenUsage.completion must be a number",
  );
  assert(typeof cost === "number", "tokenUsage.cost must be a number");
  return { prompt, completion, cost };
}

function validateBranchSpan(value: unknown): BranchSpan | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  assert(isObject(value), "span must be an object");
  const spanRecord = value as RecordLike;
  const start = spanRecord.start;
  const end = spanRecord.end;
  assert(Number.isInteger(start), "span.start must be an integer");
  assert(Number.isInteger(end), "span.end must be an integer");
  assert(
    (start as number) >= 0 && (end as number) >= (start as number),
    "span range is invalid",
  );
  return { start: start as number, end: end as number };
}

function validateConversationSettings(
  value: unknown,
): ConversationSettings {
  assert(isObject(value), "settings must be an object");
  const { model, temperature, systemPrompt } = value;
  assert(typeof model === "string" && model.length > 0, "settings.model invalid");
  assert(typeof temperature === "number", "settings.temperature invalid");
  assert(
    systemPrompt === undefined ||
      systemPrompt === null ||
      typeof systemPrompt === "string",
    "settings.systemPrompt invalid",
  );
  return {
    model,
    temperature,
    systemPrompt: systemPrompt ?? undefined,
  };
}

function validateConversation(value: unknown): Conversation {
  assert(isObject(value), "conversation must be an object");
  const { id, rootBranchId, createdAt, settings } = value;
  assert(typeof id === "string" && id.length > 0, "conversation.id invalid");
  assert(
    typeof rootBranchId === "string" && rootBranchId.length > 0,
    "conversation.rootBranchId invalid",
  );
  assert(isIsoDate(createdAt), "conversation.createdAt invalid");
  return {
    id: id as ConversationModelId,
    rootBranchId: rootBranchId as BranchId,
    createdAt,
    settings: validateConversationSettings(settings),
  };
}

function validateBranch(value: unknown): Branch {
  assert(isObject(value), "branch must be an object");
  const {
    id,
    parentId,
    title,
    createdFrom,
    messageIds,
    createdAt,
    archivedAt,
  } = value;

  assert(typeof id === "string" && id.length > 0, "branch.id invalid");
  assert(
    parentId === undefined ||
      parentId === null ||
      (typeof parentId === "string" && parentId.length > 0),
    "branch.parentId invalid",
  );
  assert(typeof title === "string", "branch.title invalid");
  assert(isObject(createdFrom), "branch.createdFrom invalid");
  const { messageId, span } = createdFrom as RecordLike;
  assert(
    typeof messageId === "string" && messageId.length > 0,
    "branch.createdFrom.messageId invalid",
  );
  const validatedSpan = validateBranchSpan(span);

  assert(Array.isArray(messageIds), "branch.messageIds invalid");
  const validatedMessageIds = messageIds.map((id) => {
    assert(typeof id === "string" && id.length > 0, "branch.messageIds invalid");
    return id as MessageId;
  });

  assert(isIsoDate(createdAt), "branch.createdAt invalid");
  assert(
    archivedAt === undefined ||
      archivedAt === null ||
      isIsoDate(archivedAt),
    "branch.archivedAt invalid",
  );

  return {
    id: id as BranchId,
    parentId: parentId ?? undefined,
    title,
    createdFrom: { messageId: messageId as MessageId, span: validatedSpan },
    messageIds: validatedMessageIds,
    createdAt,
    archivedAt: archivedAt ?? undefined,
  };
}

function validateMessage(value: unknown): Message {
  assert(isObject(value), "message must be an object");
  const { id, branchId, role, content, createdAt, tokenUsage } = value;
  assert(typeof id === "string" && id.length > 0, "message.id invalid");
  assert(
    typeof branchId === "string" && branchId.length > 0,
    "message.branchId invalid",
  );
  assert(
    role === "user" || role === "assistant" || role === "system",
    "message.role invalid",
  );
  assert(typeof content === "string", "message.content invalid");
  assert(isIsoDate(createdAt), "message.createdAt invalid");

  return {
    id: id as MessageId,
    branchId: branchId as BranchId,
    role,
    content,
    createdAt,
    tokenUsage: validateTokenUsage(tokenUsage),
  };
}

export function validateConversationGraphSnapshot(
  value: unknown,
): ConversationGraphSnapshot {
  assert(isObject(value), "snapshot must be an object");
  const { conversation, branches, messages } = value as RecordLike;

  const validatedConversation = validateConversation(conversation);

  assert(isObject(branches), "branches must be an object map");
  const validatedBranches: ConversationGraphSnapshot["branches"] = {};
  for (const [branchId, branchValue] of Object.entries(branches)) {
    const branch = validateBranch(branchValue);
    assert(
      branch.id === branchId,
      `branch map key mismatch for ${branchId}`,
    );
    validatedBranches[branchId as BranchId] = branch;
  }

  assert(isObject(messages), "messages must be an object map");
  const validatedMessages: ConversationGraphSnapshot["messages"] = {};
  for (const [messageId, messageValue] of Object.entries(messages)) {
    const message = validateMessage(messageValue);
    assert(
      message.id === messageId,
      `message map key mismatch for ${messageId}`,
    );
    validatedMessages[messageId as MessageId] = message;
  }

  // Ensure branch/message relationships are consistent
  for (const branch of Object.values(validatedBranches)) {
    for (const messageId of branch.messageIds) {
      const message = validatedMessages[messageId];
      assert(
        message && message.branchId === branch.id,
        `branch ${branch.id} references message ${messageId} that is missing or belongs to a different branch`,
      );
    }
  }

  assert(
    validatedBranches[validatedConversation.rootBranchId] !== undefined,
    "root branch missing from branches map",
  );

  return {
    conversation: validatedConversation,
    branches: validatedBranches,
    messages: validatedMessages,
  };
}

export function assertConversationGraphSnapshot(
  value: unknown,
): asserts value is ConversationGraphSnapshot {
  validateConversationGraphSnapshot(value);
}
