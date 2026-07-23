export type JsonObject = Record<string, unknown>;

export interface CodexNotification {
  method: string;
  params?: JsonObject;
}

export type CodexNotificationListener = (
  notification: CodexNotification,
) => void;

export interface CodexTransportCloseEvent {
  error: Error;
  expected: boolean;
}

export type CodexTransportCloseListener = (
  event: CodexTransportCloseEvent,
) => void;

export interface CodexRpcTransport {
  start(): Promise<void>;
  stop(): Promise<void>;
  request<TResult = unknown>(
    method: string,
    params?: unknown,
  ): Promise<TResult>;
  notify(method: string, params?: unknown): Promise<void>;
  subscribe(listener: CodexNotificationListener): () => void;
  subscribeLifecycle?(
    listener: CodexTransportCloseListener,
  ): () => void;
}

export type CodexAccountState =
  | {
      status: "signed-out";
      requiresOpenaiAuth: boolean;
    }
  | {
      status: "chatgpt";
      email: string | null;
      planType: string;
      requiresOpenaiAuth: boolean;
    }
  | {
      status: "unsupported";
      accountType: string;
      requiresOpenaiAuth: boolean;
    };

export interface CodexModel {
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  isDefault: boolean;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: Array<{
    reasoningEffort: string;
    description?: string;
  }>;
  serviceTiers: Array<unknown>;
}

export interface DeviceCodeLoginCompletion {
  loginId: string;
  success: boolean;
  cancelled: boolean;
  error: string | null;
}

export interface DeviceCodeLoginSession {
  loginId: string;
  verificationUrl: string;
  userCode: string;
  completion: Promise<DeviceCodeLoginCompletion>;
  cancel(): Promise<boolean>;
}

export interface ConversationHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AdditionalContextEntry {
  value: string;
  kind?: "application" | "untrusted";
}

export interface StartCodexTurnInput {
  streamId: string;
  content: string;
  clientUserMessageId?: string | null;
  threadId?: string | null;
  forkFrom?: {
    threadId: string;
    turnId: string;
  } | null;
  messages?: ConversationHistoryMessage[];
  localImagePaths?: string[];
  additionalContext?: Record<string, AdditionalContextEntry> | null;
  model?: string;
  effort?: string;
  serviceTier?: "priority" | null;
  webSearch?: boolean;
  baseInstructions?: string | null;
  developerInstructions?: string | null;
}

export type CodexContextMode = "start" | "resume" | "fork" | "recovery";

export type CodexTurnEvent =
  | {
      type: "context";
      streamId: string;
      threadId: string;
      contextMode: CodexContextMode;
      recovered: boolean;
      historyTruncated: boolean;
    }
  | {
      type: "start";
      streamId: string;
      threadId: string;
      turnId: string | null;
      contextMode: CodexContextMode;
      recovered: boolean;
    }
  | {
      type: "delta";
      streamId: string;
      threadId: string;
      turnId: string | null;
      delta: string;
    }
  | {
      type: "reasoning_summary";
      streamId: string;
      threadId: string;
      turnId: string | null;
      delta: string;
      content: string;
    }
  | {
      type: "tool_progress";
      streamId: string;
      threadId: string;
      turnId: string | null;
      tool: "web_search" | "image_generation";
      callId: string;
      status: "running" | "succeeded" | "failed";
      query?: string;
    }
  | {
      type: "image_ready";
      streamId: string;
      threadId: string;
      turnId: string | null;
      imageId: string;
      savedPath: string;
      revisedPrompt: string | null;
    }
  | {
      type: "complete";
      streamId: string;
      threadId: string;
      turnId: string | null;
      content: string;
      reasoningSummary: string | null;
      promptTokens: number;
      completionTokens: number;
      contextMode: CodexContextMode;
      recovered: boolean;
      historyTruncated: boolean;
    }
  | {
      type: "cancelled";
      streamId: string;
      threadId: string;
      turnId: string | null;
    }
  | {
      type: "error";
      streamId: string;
      threadId: string | null;
      turnId: string | null;
      message: string;
    };

export type CodexTerminalTurnEvent = Extract<
  CodexTurnEvent,
  { type: "complete" | "cancelled" | "error" }
>;

export interface CodexTurnSession {
  streamId: string;
  threadId: string;
  completion: Promise<CodexTerminalTurnEvent>;
  cancel(): Promise<boolean>;
}

export interface PreparedCodexThread {
  threadId: string;
  contextMode: CodexContextMode;
  recovered: boolean;
  historyTruncated?: boolean;
}

export interface DeleteThreadsResult {
  deleted: string[];
  failed: Array<{
    threadId: string;
    message: string;
  }>;
}

export interface DictationResult {
  transcript: string;
  durationSeconds: number;
}
