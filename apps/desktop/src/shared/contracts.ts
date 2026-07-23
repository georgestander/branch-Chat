import type {
  Branch,
  BranchId,
  BranchSpan,
  ComposerPreset,
  Conversation,
  ConversationCanvasPatch,
  ConversationGraphSnapshot,
  ConversationModelId,
  ConversationSettings,
  Message,
  MessageId,
  PendingAttachment,
  ReasoningEffort,
} from "@branchy/conversation-core";
import type { RenderedMessage } from "@branchy/conversation-core/presentation";
import type { ConversationComposerTool } from "@branchy/conversation-core/tools";

export const IPC_CHANNELS = {
  bootstrap: "branchy:bootstrap",
  listConversations: "branchy:conversation:list",
  createConversation: "branchy:conversation:create",
  loadConversation: "branchy:conversation:load",
  renameConversation: "branchy:conversation:rename",
  deleteConversation: "branchy:conversation:delete",
  archiveConversation: "branchy:conversation:archive",
  unarchiveConversation: "branchy:conversation:unarchive",
  updateConversationSettings: "branchy:conversation:settings:update",
  updateConversationCanvas: "branchy:conversation:canvas:update",
  openCanvasBranchCard: "branchy:branch:card:open",
  loadCanvasBranchCard: "branchy:branch:card:load",
  renameBranch: "branchy:branch:rename",
  deleteBranch: "branchy:branch:delete",
  saveBranchNote: "branchy:branch:note:save",
  sendMessage: "branchy:message:send",
  cancelMessage: "branchy:message:cancel",
  getAttachmentConstraints: "branchy:attachment:constraints",
  createAttachment: "branchy:attachment:create",
  removeAttachment: "branchy:attachment:remove",
  transcribeAudio: "branchy:dictation:transcribe",
  getGeneratedImageUrl: "branchy:image:url",
  saveGeneratedImage: "branchy:image:save",
  retryGeneratedImage: "branchy:image:retry",
  getAccountState: "branchy:account:get",
  startChatGptLogin: "branchy:account:chatgpt:login:start",
  cancelChatGptLogin: "branchy:account:chatgpt:login:cancel",
  logoutChatGpt: "branchy:account:chatgpt:logout",
  exportArchive: "branchy:archive:export",
  importArchive: "branchy:archive:import",
  openExternal: "branchy:external:open",
  streamOpen: "branchy:stream:open",
  streamClose: "branchy:stream:close",
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export interface ConversationDirectoryEntry {
  id: ConversationModelId;
  title: string;
  createdAt: string;
  lastActiveAt: string;
  branchCount: number;
  archivedAt: string | null;
}

export interface ConversationDirectory {
  active: ConversationDirectoryEntry[];
  archived: ConversationDirectoryEntry[];
}

export interface ConnectedChatGptAccount {
  email: string | null;
  planType: string | null;
}

export interface PendingChatGptLogin {
  loginId: string;
  verificationUrl: string;
  userCode: string;
  expiresAt: string | null;
}

export type DesktopAccountState =
  | { status: "signed-out" }
  | { status: "signing-in"; login: PendingChatGptLogin }
  | { status: "connected"; account: ConnectedChatGptAccount }
  | { status: "error"; message: string };

export type EmptyPayload = Readonly<Record<string, never>>;

export interface BootstrapConversationInput {
  conversationId?: ConversationModelId;
  branchId?: BranchId;
}

export interface ListConversationsInput {
  includeArchived?: boolean;
}

export interface ActiveConversationStream {
  streamId: string;
  branchId: BranchId;
  assistantMessageId: MessageId;
}

export interface EmptyConversationBootstrap {
  kind: "empty";
  conversations: ConversationDirectory;
  account: DesktopAccountState;
  missingConversationId: ConversationModelId | null;
}

export interface ReadyConversationBootstrap {
  kind: "ready";
  conversationId: ConversationModelId;
  snapshot: ConversationGraphSnapshot;
  conversation: Conversation;
  initialActiveBranchId: BranchId;
  initialMessagesByBranch: Record<BranchId, RenderedMessage[]>;
  activeStreams: ActiveConversationStream[];
  conversations: ConversationDirectory;
  account: DesktopAccountState;
}

export type ConversationBootstrap =
  | EmptyConversationBootstrap
  | ReadyConversationBootstrap;

export interface LoadConversationInput {
  conversationId: ConversationModelId;
}

export interface ConversationLoadResult {
  conversationId: ConversationModelId;
  snapshot: ConversationGraphSnapshot;
  version: number;
  activeStreams: ActiveConversationStream[];
}

export interface CreateConversationInput {
  title?: string;
  initialMessage?: string;
  preset?: ComposerPreset;
  model?: string;
  reasoningEffort?: ReasoningEffort | null;
  tools?: ConversationComposerTool[];
}

export interface RenameConversationInput {
  conversationId: ConversationModelId;
  title: string;
}

export interface ConversationIdentityInput {
  conversationId: ConversationModelId;
}

export interface UpdateConversationSettingsInput {
  conversationId: ConversationModelId;
  model?: string;
  temperature?: number;
  systemPrompt?: string | null;
  reasoningEffort?: ReasoningEffort | null;
  preset?: ComposerPreset;
  tools?: ConversationComposerTool[];
}

export interface UpdateConversationCanvasInput {
  conversationId: ConversationModelId;
  viewport?: {
    x?: number;
    y?: number;
    zoom?: number;
  } | null;
  focusedBranchId?: BranchId | null;
  nodes?: Record<
    BranchId,
    {
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      folded?: boolean;
      expanded?: boolean;
    } | null
  >;
}

export interface BranchIdentityInput extends ConversationIdentityInput {
  branchId: BranchId;
}

export interface BranchCardResult extends ConversationLoadResult {
  branch: Branch;
  messages: RenderedMessage[];
}

export interface RenameBranchInput extends BranchIdentityInput {
  title: string;
}

export interface RenameBranchResult extends ConversationLoadResult {
  branch: Branch;
}

export interface DeleteBranchResult extends ConversationLoadResult {
  parentBranchId: BranchId;
}

export interface BranchDraftInput {
  parentBranchId: BranchId;
  messageId: MessageId;
  span?: BranchSpan | null;
  title?: string;
  excerpt?: string | null;
}

export interface SaveBranchNoteInput
  extends ConversationIdentityInput,
    BranchDraftInput {
  content: string;
  attachmentIds?: string[];
}

export interface SaveBranchNoteResult extends ConversationLoadResult {
  branch: Branch;
  appendedMessages: Message[];
}

interface SendMessageBase extends ConversationIdentityInput {
  content: string;
  streamId: string;
  tools?: ConversationComposerTool[];
  attachmentIds?: string[];
}

export type SendMessageInput = SendMessageBase &
  (
    | { branchId: BranchId; branchDraft?: never }
    | { branchId?: never; branchDraft: BranchDraftInput }
  );

export interface SendMessageResult extends ConversationLoadResult {
  streamId: string;
  optimisticUserMessage: Message;
  pendingAssistantMessage: Message;
  appendedMessages: Message[];
  createdBranch?: Branch | null;
  cancelled?: boolean;
}

export interface CancelMessageInput extends ConversationIdentityInput {
  streamId: string;
}

export interface CancelMessageResult {
  interrupted: boolean;
  settled: boolean;
  queued?: boolean;
}

export interface AttachmentConstraints {
  maxSizeBytes: number;
  maxAttachments: number;
}

export interface CreateAttachmentInput extends ConversationIdentityInput {
  fileName: string;
  contentType: string;
  bytes: Uint8Array | ArrayBuffer;
  lastModified?: number;
}

export interface RemoveAttachmentInput extends ConversationIdentityInput {
  attachmentId: string;
}

export interface TranscribeAudioInput {
  contentType: "audio/wav";
  bytes: Uint8Array | ArrayBuffer;
}

export interface TranscriptionResult {
  transcript: string;
}

export interface GeneratedImageIdentityInput
  extends ConversationIdentityInput {
  messageId: MessageId;
  imageId: string;
}

export interface SaveGeneratedImageInput extends GeneratedImageIdentityInput {
  suggestedFileName?: string;
}

export interface SaveFileResult {
  saved: boolean;
  fileName: string | null;
}

export interface RetryGeneratedImageInput
  extends GeneratedImageIdentityInput {
  branchId: BranchId;
  prompt: string;
  streamId: string;
}

export interface StreamConversationDelta {
  conversationId: ConversationModelId;
  branchId: BranchId;
  version: number;
  assistantMessage: Message;
  assistantRenderedHtml: string;
}

export interface StartChatGptLoginResult {
  status: "challenge";
  loginId: string;
  verificationUrl: string;
  userCode: string;
  expiresAt: string;
}

export interface CancelChatGptLoginInput {
  loginId: string;
}

export interface ExportArchiveInput {
  conversationIds?: ConversationModelId[];
}

export interface ExportArchiveResult extends SaveFileResult {
  conversationCount: number;
}

export interface ImportArchiveInput {
  conflictPolicy: "duplicate" | "skip";
}

export interface ImportArchiveResult {
  cancelled: boolean;
  importedConversationIds: ConversationModelId[];
  skippedConversationIds: ConversationModelId[];
}

export interface OpenExternalInput {
  url: string;
}

export interface OpenExternalResult {
  opened: boolean;
}

export const STREAM_PROTOCOL_VERSION = 1 as const;

export type StreamTool = "web_search" | "image_generation";
export type StreamToolStatus = "running" | "succeeded" | "failed";

export type BranchyStreamEvent =
  | {
      type: "start";
      threadId?: string;
      turnId?: string;
      contextMode?: "start" | "resume" | "fork" | "recovery";
      recovered?: boolean;
    }
  | { type: "delta"; delta: string }
  | { type: "reasoning_summary"; delta: string; content?: string }
  | {
      type: "tool_progress";
      tool: StreamTool;
      callId: string;
      status: StreamToolStatus;
      query?: string;
    }
  | {
      type: "image_ready";
      imageId: string;
      revisedPrompt?: string | null;
    }
  | {
      type: "complete";
      content: string;
      canonical: StreamConversationDelta;
      reasoningSummary?: string | null;
      promptTokens?: number;
      completionTokens?: number;
      threadId?: string;
      turnId?: string;
      recovered?: boolean;
      historyTruncated?: boolean;
    }
  | { type: "cancelled" }
  | { type: "error"; message: string; recoverable: boolean };

export interface StreamOpenInput {
  streamId: string;
  subscriptionId: string;
}

export interface StreamCloseInput extends StreamOpenInput {}

export interface StreamOpenedMessage {
  kind: "opened";
  protocolVersion: typeof STREAM_PROTOCOL_VERSION;
  streamId: string;
  subscriptionId: string;
}

export interface StreamEventMessage {
  kind: "event";
  protocolVersion: typeof STREAM_PROTOCOL_VERSION;
  streamId: string;
  event: BranchyStreamEvent;
}

export type StreamPortMessage = StreamOpenedMessage | StreamEventMessage;
export type StreamListener = (event: BranchyStreamEvent) => void;

export interface BranchyDesktopApi {
  bootstrap(input?: BootstrapConversationInput): Promise<ConversationBootstrap>;
  listConversations(
    input?: ListConversationsInput,
  ): Promise<ConversationDirectory>;
  createConversation(
    input?: CreateConversationInput,
  ): Promise<ConversationLoadResult>;
  loadConversation(input: LoadConversationInput): Promise<ConversationLoadResult>;
  renameConversation(
    input: RenameConversationInput,
  ): Promise<ConversationLoadResult>;
  deleteConversation(
    input: ConversationIdentityInput,
  ): Promise<{ conversationId: ConversationModelId }>;
  archiveConversation(
    input: ConversationIdentityInput,
  ): Promise<ConversationDirectoryEntry>;
  unarchiveConversation(
    input: ConversationIdentityInput,
  ): Promise<ConversationDirectoryEntry>;
  updateConversationSettings(
    input: UpdateConversationSettingsInput,
  ): Promise<ConversationLoadResult>;
  updateConversationCanvas(
    input: UpdateConversationCanvasInput,
  ): Promise<ConversationLoadResult>;
  openCanvasBranchCard(input: BranchIdentityInput): Promise<BranchCardResult>;
  loadCanvasBranchCard(input: BranchIdentityInput): Promise<BranchCardResult>;
  renameBranch(input: RenameBranchInput): Promise<RenameBranchResult>;
  deleteBranch(input: BranchIdentityInput): Promise<DeleteBranchResult>;
  saveBranchNote(input: SaveBranchNoteInput): Promise<SaveBranchNoteResult>;
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>;
  cancelMessage(input: CancelMessageInput): Promise<CancelMessageResult>;
  getAttachmentConstraints(): Promise<AttachmentConstraints>;
  createAttachment(input: CreateAttachmentInput): Promise<PendingAttachment>;
  removeAttachment(
    input: RemoveAttachmentInput,
  ): Promise<PendingAttachment | null>;
  transcribeAudio(input: TranscribeAudioInput): Promise<TranscriptionResult>;
  getGeneratedImageUrl(input: GeneratedImageIdentityInput): Promise<string>;
  saveGeneratedImage(input: SaveGeneratedImageInput): Promise<SaveFileResult>;
  retryGeneratedImage(
    input: RetryGeneratedImageInput,
  ): Promise<SendMessageResult>;
  getAccountState(): Promise<DesktopAccountState>;
  startChatGptLogin(): Promise<StartChatGptLoginResult>;
  cancelChatGptLogin(input: CancelChatGptLoginInput): Promise<void>;
  logoutChatGpt(): Promise<DesktopAccountState>;
  exportArchive(input?: ExportArchiveInput): Promise<ExportArchiveResult>;
  importArchive(input: ImportArchiveInput): Promise<ImportArchiveResult>;
  openExternal(input: OpenExternalInput): Promise<OpenExternalResult>;
  subscribeStream(streamId: string, listener: StreamListener): () => void;
}

export type DesktopCommandRequestMap = {
  [IPC_CHANNELS.bootstrap]: BootstrapConversationInput;
  [IPC_CHANNELS.listConversations]: ListConversationsInput;
  [IPC_CHANNELS.createConversation]: CreateConversationInput;
  [IPC_CHANNELS.loadConversation]: LoadConversationInput;
  [IPC_CHANNELS.renameConversation]: RenameConversationInput;
  [IPC_CHANNELS.deleteConversation]: ConversationIdentityInput;
  [IPC_CHANNELS.archiveConversation]: ConversationIdentityInput;
  [IPC_CHANNELS.unarchiveConversation]: ConversationIdentityInput;
  [IPC_CHANNELS.updateConversationSettings]: UpdateConversationSettingsInput;
  [IPC_CHANNELS.updateConversationCanvas]: UpdateConversationCanvasInput;
  [IPC_CHANNELS.openCanvasBranchCard]: BranchIdentityInput;
  [IPC_CHANNELS.loadCanvasBranchCard]: BranchIdentityInput;
  [IPC_CHANNELS.renameBranch]: RenameBranchInput;
  [IPC_CHANNELS.deleteBranch]: BranchIdentityInput;
  [IPC_CHANNELS.saveBranchNote]: SaveBranchNoteInput;
  [IPC_CHANNELS.sendMessage]: SendMessageInput;
  [IPC_CHANNELS.cancelMessage]: CancelMessageInput;
  [IPC_CHANNELS.getAttachmentConstraints]: EmptyPayload;
  [IPC_CHANNELS.createAttachment]: CreateAttachmentInput;
  [IPC_CHANNELS.removeAttachment]: RemoveAttachmentInput;
  [IPC_CHANNELS.transcribeAudio]: TranscribeAudioInput;
  [IPC_CHANNELS.getGeneratedImageUrl]: GeneratedImageIdentityInput;
  [IPC_CHANNELS.saveGeneratedImage]: SaveGeneratedImageInput;
  [IPC_CHANNELS.retryGeneratedImage]: RetryGeneratedImageInput;
  [IPC_CHANNELS.getAccountState]: EmptyPayload;
  [IPC_CHANNELS.startChatGptLogin]: EmptyPayload;
  [IPC_CHANNELS.cancelChatGptLogin]: CancelChatGptLoginInput;
  [IPC_CHANNELS.logoutChatGpt]: EmptyPayload;
  [IPC_CHANNELS.exportArchive]: ExportArchiveInput;
  [IPC_CHANNELS.importArchive]: ImportArchiveInput;
  [IPC_CHANNELS.openExternal]: OpenExternalInput;
  [IPC_CHANNELS.streamOpen]: StreamOpenInput;
  [IPC_CHANNELS.streamClose]: StreamCloseInput;
};

export type DesktopCommandResponseMap = {
  [IPC_CHANNELS.bootstrap]: ConversationBootstrap;
  [IPC_CHANNELS.listConversations]: ConversationDirectory;
  [IPC_CHANNELS.createConversation]: ConversationLoadResult;
  [IPC_CHANNELS.loadConversation]: ConversationLoadResult;
  [IPC_CHANNELS.renameConversation]: ConversationLoadResult;
  [IPC_CHANNELS.deleteConversation]: { conversationId: ConversationModelId };
  [IPC_CHANNELS.archiveConversation]: ConversationDirectoryEntry;
  [IPC_CHANNELS.unarchiveConversation]: ConversationDirectoryEntry;
  [IPC_CHANNELS.updateConversationSettings]: ConversationLoadResult;
  [IPC_CHANNELS.updateConversationCanvas]: ConversationLoadResult;
  [IPC_CHANNELS.openCanvasBranchCard]: BranchCardResult;
  [IPC_CHANNELS.loadCanvasBranchCard]: BranchCardResult;
  [IPC_CHANNELS.renameBranch]: RenameBranchResult;
  [IPC_CHANNELS.deleteBranch]: DeleteBranchResult;
  [IPC_CHANNELS.saveBranchNote]: SaveBranchNoteResult;
  [IPC_CHANNELS.sendMessage]: SendMessageResult;
  [IPC_CHANNELS.cancelMessage]: CancelMessageResult;
  [IPC_CHANNELS.getAttachmentConstraints]: AttachmentConstraints;
  [IPC_CHANNELS.createAttachment]: PendingAttachment;
  [IPC_CHANNELS.removeAttachment]: PendingAttachment | null;
  [IPC_CHANNELS.transcribeAudio]: TranscriptionResult;
  [IPC_CHANNELS.getGeneratedImageUrl]: string;
  [IPC_CHANNELS.saveGeneratedImage]: SaveFileResult;
  [IPC_CHANNELS.retryGeneratedImage]: SendMessageResult;
  [IPC_CHANNELS.getAccountState]: DesktopAccountState;
  [IPC_CHANNELS.startChatGptLogin]: StartChatGptLoginResult;
  [IPC_CHANNELS.cancelChatGptLogin]: void;
  [IPC_CHANNELS.logoutChatGpt]: DesktopAccountState;
  [IPC_CHANNELS.exportArchive]: ExportArchiveResult;
  [IPC_CHANNELS.importArchive]: ImportArchiveResult;
  [IPC_CHANNELS.openExternal]: OpenExternalResult;
  [IPC_CHANNELS.streamOpen]: void;
  [IPC_CHANNELS.streamClose]: void;
};

export type {
  Branch,
  BranchId,
  BranchSpan,
  ComposerPreset,
  Conversation,
  ConversationCanvasPatch,
  ConversationGraphSnapshot,
  ConversationModelId,
  ConversationSettings,
  Message,
  MessageId,
  PendingAttachment,
  ReasoningEffort,
  RenderedMessage,
};
