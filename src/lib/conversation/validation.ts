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
  MessageAttachment,
  TokenUsage,
  ToolInvocation,
  ToolInvocationStatus,
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

function validateMessageAttachments(
  value: unknown,
): MessageAttachment[] | undefined | null {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  assert(Array.isArray(value), "message.attachments must be an array");
  return value.map((item) => {
    assert(isObject(item), "attachment must be an object");
    const record = item as RecordLike;
    const { id, kind, name, contentType, size, storageKey, openAIFileId, description, uploadedAt } =
      record;
    assert(typeof id === "string" && id.length > 0, "attachment.id invalid");
    assert(kind === "file", "attachment.kind must be \"file\"");
    assert(typeof name === "string" && name.length > 0, "attachment.name invalid");
    assert(
      typeof contentType === "string" && contentType.length > 0,
      "attachment.contentType invalid",
    );
    assert(
      Number.isInteger(size) && (size as number) >= 0,
      "attachment.size invalid",
    );
    assert(
      typeof storageKey === "string" && storageKey.length > 0,
      "attachment.storageKey invalid",
    );
    assert(
      openAIFileId === undefined ||
        openAIFileId === null ||
        typeof openAIFileId === "string",
      "attachment.openAIFileId invalid",
    );
    assert(
      description === undefined ||
        description === null ||
        typeof description === "string",
      "attachment.description invalid",
    );
    assert(isIsoDate(uploadedAt), "attachment.uploadedAt invalid");

    return {
      id: id as string,
      kind: "file" as const,
      name: name as string,
      contentType: contentType as string,
      size: size as number,
      storageKey: storageKey as string,
      openAIFileId: openAIFileId ?? undefined,
      description: description ?? undefined,
      uploadedAt: uploadedAt as string,
    };
  });
}

function validateToolInvocationStatus(
  value: unknown,
): ToolInvocationStatus {
  assert(typeof value === "string", "toolInvocation.status must be a string");
  assert(
    value === "pending" ||
      value === "running" ||
      value === "succeeded" ||
      value === "failed",
    "toolInvocation.status invalid",
  );
  return value as ToolInvocationStatus;
}

function validateToolInvocations(
  value: unknown,
): ToolInvocation[] | undefined | null {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  assert(Array.isArray(value), "message.toolInvocations must be an array");
  return value.map((item) => {
    assert(isObject(item), "toolInvocation must be an object");
    const record = item as RecordLike;
    const {
      id,
      toolType,
      toolName,
      callId,
      input,
      output,
      status,
      startedAt,
      completedAt,
      error,
    } = record;
    assert(typeof id === "string" && id.length > 0, "toolInvocation.id invalid");
    assert(
      typeof toolType === "string" && toolType.length > 0,
      "toolInvocation.toolType invalid",
    );
    assert(
      toolName === undefined ||
        toolName === null ||
        typeof toolName === "string",
      "toolInvocation.toolName invalid",
    );
    assert(
      callId === undefined || callId === null || typeof callId === "string",
      "toolInvocation.callId invalid",
    );
    assert(isIsoDate(startedAt), "toolInvocation.startedAt invalid");
    assert(
      completedAt === undefined ||
        completedAt === null ||
        isIsoDate(completedAt),
      "toolInvocation.completedAt invalid",
    );
    let normalizedError: ToolInvocation["error"] = undefined;
    if (error !== undefined && error !== null) {
      assert(isObject(error), "toolInvocation.error must be an object");
      const errorRecord = error as RecordLike;
      const { message, code } = errorRecord;
      assert(
        typeof message === "string" && message.length > 0,
        "toolInvocation.error.message invalid",
      );
      assert(
        code === undefined || code === null || typeof code === "string",
        "toolInvocation.error.code invalid",
      );
      normalizedError = {
        message: message as string,
        code: code ?? undefined,
      };
    }

    return {
      id: id as string,
      toolType: toolType as string,
      toolName: toolName ?? undefined,
      callId: callId ?? undefined,
      input,
      output,
      status: validateToolInvocationStatus(status),
      startedAt: startedAt as string,
      completedAt: completedAt ?? undefined,
      error: normalizedError,
    };
  });
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
  // Optional reasoning effort for reasoning models only
  const effort = (value as any).reasoningEffort;
  let reasoningEffort: ConversationSettings["reasoningEffort"] = undefined;
  if (
    effort === undefined ||
    effort === null ||
    effort === "low" ||
    effort === "medium" ||
    effort === "high"
  ) {
    reasoningEffort = effort ?? undefined;
  } else {
    throw new Error("settings.reasoningEffort invalid");
  }

  return {
    model,
    temperature,
    systemPrompt: systemPrompt ?? undefined,
    reasoningEffort,
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
  const { excerpt } = createdFrom as RecordLike;
  assert(
    excerpt === undefined || excerpt === null || typeof excerpt === "string",
    "branch.createdFrom.excerpt invalid",
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
    createdFrom: {
      messageId: messageId as MessageId,
      span: validatedSpan,
      excerpt: excerpt ?? undefined,
    },
    messageIds: validatedMessageIds,
    createdAt,
    archivedAt: archivedAt ?? undefined,
  };
}

function validateMessage(value: unknown): Message {
  assert(isObject(value), "message must be an object");
  const {
    id,
    branchId,
    role,
    content,
    createdAt,
    tokenUsage,
    attachments,
    toolInvocations,
  } = value;
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
    attachments: validateMessageAttachments(attachments),
    toolInvocations: validateToolInvocations(toolInvocations),
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
