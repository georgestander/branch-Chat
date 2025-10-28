export type ISODateTimeString = string;

export type ConversationModelId = string;
export type BranchId = string;
export type MessageId = string;

export type ConversationRole = "user" | "assistant" | "system";

export interface ConversationSettings {
  model: string;
  temperature: number;
  systemPrompt?: string | null;
}

export interface Conversation {
  id: ConversationModelId;
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
}

export interface Branch {
  id: BranchId;
  parentId?: BranchId | null;
  title: string;
  createdFrom: BranchCreationSource;
  messageIds: MessageId[];
  createdAt: ISODateTimeString;
  archivedAt?: ISODateTimeString | null;
}

export interface TokenUsage {
  prompt: number;
  completion: number;
  cost: number;
}

export interface Message {
  id: MessageId;
  branchId: BranchId;
  role: ConversationRole;
  content: string;
  createdAt: ISODateTimeString;
  tokenUsage?: TokenUsage | null;
}

export interface ConversationGraphSnapshot {
  conversation: Conversation;
  branches: Record<BranchId, Branch>;
  messages: Record<MessageId, Message>;
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
      type: "conversation:update";
      conversation: Conversation;
    };

export function createConversationSnapshot(input: {
  id: ConversationModelId;
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
  };

  const snapshot: ConversationGraphSnapshot = {
    conversation: {
      id: input.id,
      rootBranchId: rootBranch.id,
      createdAt,
      settings: input.settings,
    },
    branches: {
      [rootBranch.id]: rootBranch,
    },
    messages: {},
  };

  for (const message of input.initialMessages ?? []) {
    snapshot.messages[message.id] = message;
    const branch = snapshot.branches[message.branchId];
    if (branch) {
      branch.messageIds.push(message.id);
    }
  }

  return snapshot;
}

export function cloneConversationSnapshot(
  snapshot: ConversationGraphSnapshot,
): ConversationGraphSnapshot {
  return {
    conversation: { ...snapshot.conversation },
    branches: Object.fromEntries(
      Object.entries(snapshot.branches).map(([id, branch]) => [
        id,
        { ...branch, messageIds: [...branch.messageIds] },
      ]),
    ),
    messages: Object.fromEntries(
      Object.entries(snapshot.messages).map(([id, message]) => {
        const usage = message.tokenUsage;
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
          },
        ];
      }),
    ),
  };
}
