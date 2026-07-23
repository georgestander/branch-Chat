import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  DEFAULT_CONVERSATION_MODEL,
  applyCanvasPatch,
  applyConversationGraphUpdates,
  arrangeFocusedChildOnCanvas,
  cloneConversationSnapshot,
  createConversationSnapshot,
  deleteBranchSubtree,
  getBoundedBranchRecoveryMessages,
  type Branch,
  type BranchId,
  type ConversationGraphSnapshot,
  type Message,
  type MessageAttachment,
  type PendingAttachment,
  type ToolInvocation,
} from "@branchy/conversation-core";

import type {
  ActiveConversationStream,
  AttachmentConstraints,
  BranchCardResult,
  BranchyStreamEvent,
  CancelMessageResult,
  ConversationBootstrap,
  ConversationDirectory,
  ConversationDirectoryEntry,
  ConversationLoadResult,
  CreateAttachmentInput,
  CreateConversationInput,
  DeleteBranchResult,
  DesktopAccountState,
  ImportArchiveResult,
  RenameBranchResult,
  RetryGeneratedImageInput,
  SaveBranchNoteInput,
  SaveBranchNoteResult,
  SendMessageInput,
  SendMessageResult,
  StartChatGptLoginResult,
  TranscriptionResult,
  UpdateConversationCanvasInput,
  UpdateConversationSettingsInput,
} from "../../shared/contracts.ts";
import {
  exportBranchyChatArchive,
  stageBranchyChatArchive,
  type BranchyArchiveAssetInput,
  type StagedBranchyArchive,
} from "../archive/index.ts";
import {
  ATTACHMENT_MAX_BYTES,
  AssetStore,
  assetUrl,
  canonicalExtensionForMimeType,
  validateAttachmentFilename,
  type StoredAsset,
  type SupportedAssetMimeType,
} from "../assets/index.ts";
import {
  type CodexAccountState,
  type CancelTurnResult,
  type CodexTurnEvent,
  type CodexTurnSession,
  type DeleteThreadsResult,
  type DeviceCodeLoginSession,
  type DictationResult,
  type StartCodexTurnInput,
} from "../codex/index.ts";
import {
  ConversationRepository,
  type ConversationDirectoryEntry as PersistedDirectoryEntry,
} from "../persistence/index.ts";
import { extractAttachmentContext } from "../attachments/context.ts";
import {
  renderBranchMessages,
  renderMessage,
  renderMessagesByBranch,
} from "./presentation.ts";

const MAX_ATTACHMENTS_PER_MESSAGE = 8;
const MAX_PENDING_ATTACHMENTS_PER_CONVERSATION = 64;
const MAX_PENDING_ATTACHMENT_BYTES = 64 * 1024 * 1024;
const LOGIN_LIFETIME_MILLISECONDS = 15 * 60 * 1000;

interface ActiveTurn {
  assistantMessageId: string;
  branchId: BranchId;
  content: string;
  contextMode: "start" | "resume" | "fork" | "recovery";
  conversationId: string;
  historyTruncated: boolean;
  processing: Promise<void>;
  reasoningSummary: string;
  recovered: boolean;
  session: CodexTurnSession | null;
  streamId: string;
  terminal: boolean;
  threadId: string | null;
  toolInvocations: Map<string, ToolInvocation>;
  turnId: string | null;
  userPrompt: string;
}

export interface BranchyApplicationOptions {
  assets: AssetStore;
  codex: BranchyCodexGateway;
  now?: () => Date;
  publishStream: (streamId: string, event: BranchyStreamEvent) => void;
  repository: ConversationRepository;
}

export interface BranchyCodexGateway {
  cancelDeviceCodeLogin(loginId: string): Promise<boolean>;
  cancelTurn(streamId: string): Promise<CancelTurnResult>;
  deleteThreads(threadIds: string[]): Promise<DeleteThreadsResult>;
  logoutChatGpt(): Promise<CodexAccountState>;
  readAccount(): Promise<CodexAccountState>;
  startDeviceCodeLogin(): Promise<DeviceCodeLoginSession>;
  startTurn(
    input: StartCodexTurnInput,
    onEvent: (event: CodexTurnEvent) => void,
  ): Promise<CodexTurnSession>;
  stop(): Promise<void>;
  transcribeWav(input: Uint8Array): Promise<DictationResult>;
}

export interface BranchyArchiveExport {
  bytes: Uint8Array;
  conversationCount: number;
}

export interface BranchyGeneratedImageFile {
  absolutePath: string;
  contentType: string;
  suggestedFileName: string;
}

function titleFromPrompt(value: string): string {
  const compact = value.trim().replace(/\s+/gu, " ");
  if (!compact) {
    return "New branch";
  }
  return compact.length > 64 ? `${compact.slice(0, 61)}…` : compact;
}

function accountState(value: CodexAccountState): DesktopAccountState {
  if (value.status === "chatgpt") {
    return {
      status: "connected",
      account: {
        email: value.email,
        planType: value.planType,
      },
    };
  }
  if (value.status === "signed-out") {
    return { status: "signed-out" };
  }
  return {
    status: "error",
    message: `Branchy requires a ChatGPT account, not ${value.accountType}.`,
  };
}

function directoryEntry(
  value: PersistedDirectoryEntry,
): ConversationDirectoryEntry {
  return {
    id: value.id,
    title: value.title,
    createdAt: value.createdAt,
    lastActiveAt: value.lastActiveAt,
    branchCount: value.branchCount,
    archivedAt: value.archivedAt,
  };
}

function toolInvocation(
  event: Extract<CodexTurnEvent, { type: "tool_progress" }>,
  now: string,
): ToolInvocation {
  return {
    id: event.callId,
    callId: event.callId,
    toolType: event.tool,
    toolName:
      event.tool === "image_generation" ? "Image generation" : "Web search",
    input: event.query ? { query: event.query } : null,
    output: null,
    status: event.status,
    startedAt: now,
    completedAt: event.status === "running" ? null : now,
    error:
      event.status === "failed"
        ? { message: `${event.tool.replaceAll("_", " ")} failed` }
        : null,
  };
}

function providerThreadIds(snapshot: ConversationGraphSnapshot): string[] {
  return Array.from(
    new Set(
      Object.values(snapshot.branches)
        .map((branch) => branch.inferenceContext?.threadId)
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

function referencedAssetKeys(
  snapshots: readonly ConversationGraphSnapshot[],
): Set<string> {
  const keys = new Set<string>();
  for (const snapshot of snapshots) {
    for (const message of Object.values(snapshot.messages)) {
      for (const attachment of message.attachments ?? []) {
        keys.add(attachment.storageKey);
      }
      for (const invocation of message.toolInvocations ?? []) {
        if (
          invocation.toolType === "image_generation" &&
          invocation.output &&
          typeof invocation.output === "object" &&
          "storageKey" in invocation.output &&
          typeof invocation.output.storageKey === "string"
        ) {
          keys.add(invocation.output.storageKey);
        }
      }
    }
  }
  return keys;
}

function assetNames(
  snapshots: readonly ConversationGraphSnapshot[],
): Map<string, string> {
  const names = new Map<string, string>();
  for (const snapshot of snapshots) {
    for (const message of Object.values(snapshot.messages)) {
      for (const attachment of message.attachments ?? []) {
        if (!names.has(attachment.storageKey)) {
          names.set(attachment.storageKey, attachment.name);
        }
      }
    }
  }
  return names;
}

function imageStorageKeys(
  snapshots: readonly ConversationGraphSnapshot[],
): Set<string> {
  const keys = new Set<string>();
  for (const snapshot of snapshots) {
    for (const message of Object.values(snapshot.messages)) {
      for (const invocation of message.toolInvocations ?? []) {
        if (
          invocation.toolType === "image_generation" &&
          invocation.output &&
          typeof invocation.output === "object" &&
          "storageKey" in invocation.output &&
          typeof invocation.output.storageKey === "string"
        ) {
          keys.add(invocation.output.storageKey);
        }
      }
    }
  }
  return keys;
}

export class BranchyApplication {
  private readonly assets: AssetStore;
  private readonly codex: BranchyCodexGateway;
  private readonly now: () => Date;
  private readonly publishStream: BranchyApplicationOptions["publishStream"];
  private readonly repository: ConversationRepository;
  private readonly activeTurns = new Map<string, ActiveTurn>();
  private readonly activeBranchStreams = new Map<string, string>();
  private readonly loginSessions = new Map<string, DeviceCodeLoginSession>();
  private readonly pendingAttachments = new Map<
    string,
    Map<string, PendingAttachment>
  >();
  private readonly versions = new Map<string, number>();
  private readonly mutationTails = new Map<string, Promise<void>>();

  constructor(options: BranchyApplicationOptions) {
    this.assets = options.assets;
    this.codex = options.codex;
    this.now = options.now ?? (() => new Date());
    this.publishStream = options.publishStream;
    this.repository = options.repository;
  }

  async bootstrap(input: {
    conversationId?: string;
    branchId?: string;
  } = {}): Promise<ConversationBootstrap> {
    const conversations = this.listConversations({ includeArchived: true });
    const account = await this.getAccountState();
    const requested = input.conversationId
      ? this.repository.load(input.conversationId)
      : null;
    const firstActive = conversations.active[0]?.id;
    const snapshot = requested ?? (firstActive
      ? this.repository.load(firstActive)
      : null);
    if (!snapshot) {
      return {
        kind: "empty",
        conversations,
        account,
        missingConversationId:
          input.conversationId && !requested ? input.conversationId : null,
      };
    }
    const activeBranchId =
      (input.branchId && snapshot.branches[input.branchId]
        ? input.branchId
        : snapshot.canvas.focusedBranchId) ??
      snapshot.conversation.rootBranchId;
    return {
      kind: "ready",
      conversationId: snapshot.conversation.id,
      snapshot,
      conversation: snapshot.conversation,
      initialActiveBranchId: activeBranchId,
      initialMessagesByBranch: renderMessagesByBranch(snapshot),
      activeStreams: this.activeStreamsFor(snapshot.conversation.id),
      conversations,
      account,
    };
  }

  listConversations(
    input: { includeArchived?: boolean } = {},
  ): ConversationDirectory {
    const entries = this.repository
      .list({ includeArchived: input.includeArchived ?? true })
      .map(directoryEntry);
    return {
      active: entries.filter((entry) => entry.archivedAt === null),
      archived: entries.filter((entry) => entry.archivedAt !== null),
    };
  }

  createConversation(
    input: CreateConversationInput = {},
  ): ConversationLoadResult {
    const now = this.now().toISOString();
    const conversationId = `conversation-${randomUUID()}`;
    const rootBranchId = `${conversationId}:root`;
    const initialMessages: Message[] = [];
    if (input.initialMessage?.trim()) {
      initialMessages.push({
        id: `message-${randomUUID()}`,
        branchId: rootBranchId,
        role: "user",
        content: input.initialMessage.trim(),
        createdAt: now,
      });
    }
    const snapshot = createConversationSnapshot({
      id: conversationId,
      createdAt: now,
      settings: {
        model: input.model ?? DEFAULT_CONVERSATION_MODEL,
        temperature: 0.1,
        reasoningEffort: input.reasoningEffort ?? "medium",
        systemPrompt: null,
        composerDefaults: {
          preset: input.preset ?? "fast",
          tools: input.tools ?? ["web-search"],
        },
      },
      rootBranch: {
        id: rootBranchId,
        title: input.title?.trim() || "New conversation",
        createdFrom: {
          messageId: `${conversationId}:origin`,
          excerpt: null,
          span: null,
        },
        createdAt: now,
      },
      initialMessages,
    });
    this.repository.create(snapshot, {
      title: input.title?.trim() || "New conversation",
      lastActiveAt: now,
    });
    return this.loadResult(snapshot);
  }

  loadConversation(conversationId: string): ConversationLoadResult {
    return this.loadResult(this.repository.require(conversationId));
  }

  renameConversation(
    conversationId: string,
    title: string,
  ): ConversationLoadResult {
    this.repository.rename(conversationId, title, this.now().toISOString());
    this.bumpVersion(conversationId);
    return this.loadConversation(conversationId);
  }

  async deleteConversation(
    conversationId: string,
  ): Promise<{ conversationId: string }> {
    const snapshot = this.repository.require(conversationId);
    if (
      [...this.activeTurns.values()].some(
        (turn) => turn.conversationId === conversationId && !turn.terminal,
      )
    ) {
      throw new Error(
        "Stop the active Branchy response before deleting this conversation.",
      );
    }
    await this.deleteProviderThreads(providerThreadIds(snapshot));
    const assetKeys = referencedAssetKeys([snapshot]);
    for (const attachment of this.pendingAttachments
      .get(conversationId)
      ?.values() ?? []) {
      assetKeys.add(attachment.storageKey);
    }
    this.repository.delete(conversationId);
    this.versions.delete(conversationId);
    this.pendingAttachments.delete(conversationId);
    await this.deleteUnreferencedAssets(assetKeys);
    return { conversationId };
  }

  archiveConversation(conversationId: string): ConversationDirectoryEntry {
    return directoryEntry(
      this.repository.archive(conversationId, this.now().toISOString()),
    );
  }

  unarchiveConversation(conversationId: string): ConversationDirectoryEntry {
    return directoryEntry(
      this.repository.unarchive(conversationId, this.now().toISOString()),
    );
  }

  updateConversationSettings(
    input: UpdateConversationSettingsInput,
  ): ConversationLoadResult {
    const snapshot = cloneConversationSnapshot(
      this.repository.require(input.conversationId),
    );
    snapshot.conversation.settings = {
      ...snapshot.conversation.settings,
      ...(input.model === undefined ? {} : { model: input.model }),
      ...(input.temperature === undefined
        ? {}
        : { temperature: input.temperature }),
      ...(input.systemPrompt === undefined
        ? {}
        : { systemPrompt: input.systemPrompt }),
      ...(input.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: input.reasoningEffort }),
      composerDefaults: {
        preset:
          input.preset ??
          snapshot.conversation.settings.composerDefaults.preset,
        tools:
          input.tools ??
          snapshot.conversation.settings.composerDefaults.tools,
      },
    };
    this.saveSnapshot(snapshot);
    return this.loadResult(snapshot);
  }

  updateConversationCanvas(
    input: UpdateConversationCanvasInput,
  ): ConversationLoadResult {
    const snapshot = cloneConversationSnapshot(
      this.repository.require(input.conversationId),
    );
    snapshot.canvas = applyCanvasPatch(snapshot, {
      viewport: input.viewport,
      focusedBranchId: input.focusedBranchId,
      nodes: input.nodes,
    });
    this.saveSnapshot(snapshot);
    return this.loadResult(snapshot);
  }

  openBranchCard(
    conversationId: string,
    branchId: BranchId,
  ): BranchCardResult {
    const snapshot = this.repository.require(conversationId);
    const branch = snapshot.branches[branchId];
    if (!branch) {
      throw new Error(`Branch ${branchId} was not found`);
    }
    return {
      ...this.loadResult(snapshot),
      branch,
      messages: renderBranchMessages(snapshot, branchId),
    };
  }

  renameBranch(
    conversationId: string,
    branchId: BranchId,
    title: string,
  ): RenameBranchResult {
    const snapshot = cloneConversationSnapshot(
      this.repository.require(conversationId),
    );
    const branch = snapshot.branches[branchId];
    if (!branch) {
      throw new Error(`Branch ${branchId} was not found`);
    }
    branch.title = title;
    this.saveSnapshot(snapshot);
    return {
      ...this.loadResult(snapshot),
      branch,
    };
  }

  async deleteBranch(
    conversationId: string,
    branchId: BranchId,
  ): Promise<DeleteBranchResult> {
    const snapshot = cloneConversationSnapshot(
      this.repository.require(conversationId),
    );
    const parentBranchId = snapshot.branches[branchId]?.parentId;
    if (!parentBranchId) {
      throw new Error("The root branch cannot be deleted");
    }
    const assetKeys = referencedAssetKeys([snapshot]);
    const beforeThreads = new Set(providerThreadIds(snapshot));
    deleteBranchSubtree(snapshot, branchId);
    const survivingBranches = new Set(Object.keys(snapshot.branches));
    if (
      [...this.activeTurns.values()].some(
        (turn) =>
          turn.conversationId === conversationId &&
          !turn.terminal &&
          !survivingBranches.has(turn.branchId),
      )
    ) {
      throw new Error(
        "Stop the active Branchy response before deleting this branch.",
      );
    }
    const afterThreads = new Set(providerThreadIds(snapshot));
    await this.deleteProviderThreads(
      [...beforeThreads].filter((threadId) => !afterThreads.has(threadId)),
    );
    this.saveSnapshot(snapshot);
    await this.deleteUnreferencedAssets(assetKeys);
    return {
      ...this.loadResult(snapshot),
      parentBranchId,
    };
  }

  saveBranchNote(input: SaveBranchNoteInput): SaveBranchNoteResult {
    const snapshot = cloneConversationSnapshot(
      this.repository.require(input.conversationId),
    );
    const branch = this.createChildBranch(snapshot, input);
    const message: Message = {
      id: `message-${randomUUID()}`,
      branchId: branch.id,
      role: "user",
      content: input.content,
      createdAt: this.now().toISOString(),
      attachments: this.messageAttachments(
        input.conversationId,
        input.attachmentIds ?? [],
      ),
    };
    const next = applyConversationGraphUpdates(snapshot, [
      {
        type: "branch:create",
        conversationId: input.conversationId,
        branch,
      },
      {
        type: "canvas:update",
        conversationId: input.conversationId,
        patch: {
          focusedBranchId: branch.id,
          nodes: arrangeFocusedChildOnCanvas(
            snapshot,
            branch.parentId as BranchId,
            branch.id,
          ),
        },
      },
      {
        type: "message:append",
        conversationId: input.conversationId,
        message,
      },
    ]);
    this.saveSnapshot(next);
    this.consumePendingAttachments(
      input.conversationId,
      input.attachmentIds ?? [],
    );
    return {
      ...this.loadResult(next),
      branch,
      appendedMessages: [message],
    };
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    return this.startMessage(input, input.content);
  }

  async retryGeneratedImage(
    input: RetryGeneratedImageInput,
  ): Promise<SendMessageResult> {
    this.requireImageGenerationInvocation(
      input.conversationId,
      input.messageId,
      input.imageId,
    );
    return this.startMessage(
      {
        conversationId: input.conversationId,
        branchId: input.branchId,
        content: input.prompt,
        streamId: input.streamId,
      },
      `Generate an image using this prompt:\n\n${input.prompt}`,
    );
  }

  async cancelMessage(streamId: string): Promise<CancelMessageResult> {
    const result = await this.codex.cancelTurn(streamId);
    return {
      interrupted: result.interrupted,
      settled: result.settled,
      ...(result.queued === undefined ? {} : { queued: result.queued }),
    };
  }

  attachmentConstraints(): AttachmentConstraints {
    return {
      maxSizeBytes: Math.min(
        this.assets.attachmentMaxBytes,
        ATTACHMENT_MAX_BYTES,
      ),
      maxAttachments: MAX_ATTACHMENTS_PER_MESSAGE,
    };
  }

  async createAttachment(
    input: CreateAttachmentInput,
  ): Promise<PendingAttachment> {
    this.repository.require(input.conversationId);
    const bytes =
      input.bytes instanceof Uint8Array
        ? input.bytes
        : new Uint8Array(input.bytes);
    if (input.contentType === "application/msword") {
      throw new Error(
        "Legacy .doc attachments are not supported. Convert the file to DOCX, PDF, or plain text.",
      );
    }
    return this.withMutation(input.conversationId, async () => {
      const pending =
        this.pendingAttachments.get(input.conversationId) ?? new Map();
      if (pending.size >= MAX_PENDING_ATTACHMENTS_PER_CONVERSATION) {
        throw new Error(
          `A conversation can keep at most ${MAX_PENDING_ATTACHMENTS_PER_CONVERSATION} pending attachments. Send or remove files and try again.`,
        );
      }
      const pendingBytes = [...pending.values()].reduce(
        (total, attachment) => total + attachment.size,
        0,
      );
      if (pendingBytes + bytes.byteLength > MAX_PENDING_ATTACHMENT_BYTES) {
        throw new Error(
          "Pending attachments may use at most 64 MB. Remove a file and try again.",
        );
      }
      const asset = await this.assets.writeAttachment({
        bytes,
        fileName: input.fileName,
        mimeType: input.contentType,
      });
      if (asset.mimeType === "application/msword") {
        await this.deleteUnreferencedAssets(new Set([asset.assetId]));
        throw new Error(
          "Legacy .doc attachments are not supported. Convert the file to DOCX, PDF, or plain text.",
        );
      }
      const createdAt = this.now().toISOString();
      const attachment: PendingAttachment = {
        id: `attachment-${randomUUID()}`,
        name: validateAttachmentFilename(input.fileName, asset.mimeType),
        contentType: asset.mimeType,
        size: asset.byteLength,
        storageKey: asset.assetId,
        status: "ready",
        createdAt,
        uploadedAt: createdAt,
      };
      pending.set(attachment.id, attachment);
      this.pendingAttachments.set(input.conversationId, pending);
      return attachment;
    });
  }

  async removeAttachment(
    conversationId: string,
    attachmentId: string,
  ): Promise<PendingAttachment | null> {
    const pending = this.pendingAttachments.get(conversationId);
    const attachment = pending?.get(attachmentId) ?? null;
    pending?.delete(attachmentId);
    if (attachment) {
      await this.deleteUnreferencedAssets(
        new Set([attachment.storageKey]),
      );
    }
    return attachment;
  }

  async transcribeAudio(bytes: Uint8Array): Promise<TranscriptionResult> {
    const result = await this.codex.transcribeWav(bytes);
    return { transcript: result.transcript };
  }

  generatedImageUrl(
    conversationId: string,
    messageId: string,
    imageId: string,
  ): string {
    const storageKey = this.requireGeneratedImage(
      conversationId,
      messageId,
      imageId,
    );
    return assetUrl(storageKey);
  }

  async generatedImageFile(
    conversationId: string,
    messageId: string,
    imageId: string,
    preferredName?: string,
  ): Promise<BranchyGeneratedImageFile> {
    const storageKey = this.requireGeneratedImage(
      conversationId,
      messageId,
      imageId,
    );
    const resolved = await this.assets.resolveAssetFile(storageKey);
    const metadata = await this.assets.downloadMetadata(
      storageKey,
      preferredName,
    );
    return {
      absolutePath: resolved.absolutePath,
      contentType: metadata.mimeType,
      suggestedFileName: metadata.suggestedFilename,
    };
  }

  async getAccountState(): Promise<DesktopAccountState> {
    if (this.loginSessions.size > 0) {
      return { status: "signing-in" };
    }
    try {
      return accountState(await this.codex.readAccount());
    } catch (error) {
      return {
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Branchy could not read the ChatGPT account.",
      };
    }
  }

  async startChatGptLogin(): Promise<StartChatGptLoginResult> {
    const session = await this.codex.startDeviceCodeLogin();
    this.loginSessions.set(session.loginId, session);
    void session.completion.finally(() => {
      this.loginSessions.delete(session.loginId);
    });
    return {
      status: "challenge",
      loginId: session.loginId,
      verificationUrl: session.verificationUrl,
      userCode: session.userCode,
      expiresAt: new Date(
        this.now().getTime() + LOGIN_LIFETIME_MILLISECONDS,
      ).toISOString(),
    };
  }

  async cancelChatGptLogin(loginId: string): Promise<void> {
    const session = this.loginSessions.get(loginId);
    if (session) {
      await session.cancel();
    } else {
      await this.codex.cancelDeviceCodeLogin(loginId);
    }
    this.loginSessions.delete(loginId);
  }

  async logoutChatGpt(): Promise<DesktopAccountState> {
    this.loginSessions.clear();
    return accountState(await this.codex.logoutChatGpt());
  }

  async exportArchive(
    conversationIds?: readonly string[],
  ): Promise<BranchyArchiveExport> {
    const ids =
      conversationIds && conversationIds.length > 0
        ? [...new Set(conversationIds)]
        : this.repository.list({ includeArchived: true }).map((entry) => entry.id);
    const snapshots = ids.map((id) => this.repository.require(id));
    if (snapshots.length === 0) {
      throw new Error("There are no conversations to export.");
    }
    const assets: BranchyArchiveAssetInput[] = [];
    for (const storageKey of referencedAssetKeys(snapshots)) {
      const resolved = await this.assets.resolveAssetFile(storageKey);
      assets.push({
        storageKey,
        bytes: await readFile(resolved.absolutePath),
        contentType: resolved.asset.mimeType,
      });
    }
    return {
      bytes: exportBranchyChatArchive({ snapshots, assets }),
      conversationCount: snapshots.length,
    };
  }

  async importArchive(
    bytes: Uint8Array,
    conflictPolicy: "duplicate" | "skip",
  ): Promise<ImportArchiveResult> {
    const staged = stageBranchyChatArchive(bytes);
    const skippedConversationIds: string[] = [];
    const snapshots = staged.snapshots.flatMap((snapshot) => {
      if (!this.repository.load(snapshot.conversation.id)) {
        return [cloneConversationSnapshot(snapshot)];
      }
      if (conflictPolicy === "skip") {
        skippedConversationIds.push(snapshot.conversation.id);
        return [];
      }
      const duplicate = cloneConversationSnapshot(snapshot);
      duplicate.conversation.id = `conversation-${randomUUID()}`;
      for (const branch of Object.values(duplicate.branches)) {
        branch.inferenceContext = null;
      }
      for (const message of Object.values(duplicate.messages)) {
        message.inferenceContext = null;
      }
      return [duplicate];
    });
    if (snapshots.length === 0) {
      return {
        cancelled: false,
        importedConversationIds: [],
        skippedConversationIds,
      };
    }
    await this.importAssets(staged, snapshots);
    this.repository.createMany(
      snapshots.map((snapshot) => ({
        snapshot,
        options: {
          title:
            snapshot.branches[snapshot.conversation.rootBranchId]?.title ||
            "Imported conversation",
          lastActiveAt: this.now().toISOString(),
        },
      })),
    );
    for (const snapshot of snapshots) {
      this.versions.set(snapshot.conversation.id, 1);
    }
    return {
      cancelled: false,
      importedConversationIds: snapshots.map(
        (snapshot) => snapshot.conversation.id,
      ),
      skippedConversationIds,
    };
  }

  recoverInterruptedMessages(): number {
    let recovered = 0;
    for (const entry of this.repository.list({ includeArchived: true })) {
      const snapshot = cloneConversationSnapshot(
        this.repository.require(entry.id),
      );
      let changed = false;
      for (const message of Object.values(snapshot.messages)) {
        if (message.role !== "assistant") {
          continue;
        }
        if (
          message.content.trim().length === 0 &&
          !message.tokenUsage &&
          !message.inferenceContext &&
          (message.toolInvocations?.length ?? 0) === 0
        ) {
          message.content =
            "This response was interrupted when Branchy Chat closed. Retry the prompt to continue.";
          changed = true;
          recovered += 1;
        }
        let messageChanged = false;
        const invocations = (message.toolInvocations ?? []).map((invocation) => {
          if (
            invocation.status !== "pending" &&
            invocation.status !== "running"
          ) {
            return invocation;
          }
          changed = true;
          messageChanged = true;
          recovered += 1;
          return {
            ...invocation,
            status: "failed" as const,
            completedAt: this.now().toISOString(),
            error: {
              message:
                "Generation was interrupted when Branchy Chat closed. Edit the prompt and retry.",
            },
          };
        });
        if (messageChanged) {
          message.toolInvocations = invocations;
        }
      }
      if (changed) {
        this.saveSnapshot(snapshot);
      }
    }
    return recovered;
  }

  async close(): Promise<void> {
    for (const session of this.loginSessions.values()) {
      await session.cancel().catch(() => undefined);
    }
    this.loginSessions.clear();
    await this.codex.stop();
    this.repository.close();
  }

  private async startMessage(
    input: SendMessageInput,
    providerContent: string,
  ): Promise<SendMessageResult> {
    const initial = await this.withMutation(input.conversationId, async () => {
      const snapshot = cloneConversationSnapshot(
        this.repository.require(input.conversationId),
      );
      let branch: Branch;
      let createdBranch: Branch | null = null;
      if (input.branchDraft) {
        branch = this.createChildBranch(snapshot, input.branchDraft);
        createdBranch = branch;
      } else {
        branch = snapshot.branches[input.branchId];
        if (!branch) {
          throw new Error(`Branch ${input.branchId} was not found`);
        }
      }
      const branchKey = `${input.conversationId}:${branch.id}`;
      if (this.activeBranchStreams.has(branchKey)) {
        throw new Error("That branch already has an active response.");
      }

      const contextSnapshot = createdBranch
        ? applyConversationGraphUpdates(snapshot, [
            {
              type: "branch:create",
              conversationId: input.conversationId,
              branch: createdBranch,
            },
          ])
        : snapshot;
      const history = getBoundedBranchRecoveryMessages({
        snapshot: contextSnapshot,
        branchId: branch.id,
      })
        .filter(
          (message): message is Message & { role: "user" | "assistant" } =>
            message.role === "user" || message.role === "assistant",
        )
        .map((message) => ({
          role: message.role,
          content: message.content,
        }));
      const userMessage: Message = {
        id: `message-${randomUUID()}`,
        branchId: branch.id,
        role: "user",
        content: input.content,
        createdAt: this.now().toISOString(),
        attachments: this.messageAttachments(
          input.conversationId,
          input.attachmentIds ?? [],
        ),
      };
      const assistantMessage: Message = {
        id: `message-${randomUUID()}`,
        branchId: branch.id,
        role: "assistant",
        content: "",
        createdAt: this.now().toISOString(),
        toolInvocations: [],
      };
      const updates = [
        ...(createdBranch
          ? [
              {
                type: "branch:create" as const,
                conversationId: input.conversationId,
                branch: createdBranch,
              },
              {
                type: "canvas:update" as const,
                conversationId: input.conversationId,
                patch: {
                  focusedBranchId: createdBranch.id,
                  nodes: arrangeFocusedChildOnCanvas(
                    snapshot,
                    createdBranch.parentId as BranchId,
                    createdBranch.id,
                  ),
                },
              },
            ]
          : []),
        {
          type: "message:append" as const,
          conversationId: input.conversationId,
          message: userMessage,
        },
        {
          type: "message:append" as const,
          conversationId: input.conversationId,
          message: assistantMessage,
        },
      ];
      const next = applyConversationGraphUpdates(snapshot, updates);
      this.saveSnapshot(next);
      this.consumePendingAttachments(
        input.conversationId,
        input.attachmentIds ?? [],
      );
      const state: ActiveTurn = {
        assistantMessageId: assistantMessage.id,
        branchId: branch.id,
        content: "",
        contextMode: createdBranch ? "fork" : "resume",
        conversationId: input.conversationId,
        historyTruncated: false,
        processing: Promise.resolve(),
        reasoningSummary: "",
        recovered: false,
        session: null,
        streamId: input.streamId,
        terminal: false,
        threadId: null,
        toolInvocations: new Map(),
        turnId: null,
        userPrompt: input.content,
      };
      this.activeTurns.set(input.streamId, state);
      this.activeBranchStreams.set(branchKey, input.streamId);
      return {
        assistantMessage,
        branch,
        branchKey,
        createdBranch,
        history,
        snapshot: next,
        state,
        userMessage,
      };
    });

    let attachmentContext: Awaited<
      ReturnType<BranchyApplication["attachmentContext"]>
    >;
    try {
      attachmentContext = await this.attachmentContext(
        initial.userMessage.attachments ?? [],
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Branchy could not read the selected attachments.";
      await this.settleIncompleteTurn(initial.state, "error", message);
      this.activeTurns.delete(input.streamId);
      this.activeBranchStreams.delete(initial.branchKey);
      throw error;
    }
    const sourceMessage = input.branchDraft
      ? initial.snapshot.messages[input.branchDraft.messageId]
      : null;
    const sourceContext =
      sourceMessage?.inferenceContext ??
      (input.branchDraft
        ? initial.snapshot.branches[input.branchDraft.parentBranchId]
            ?.inferenceContext
        : null);
    const currentContext =
      initial.snapshot.branches[initial.branch.id]?.inferenceContext;

    try {
      const session = await this.codex.startTurn(
        {
          streamId: input.streamId,
          content: providerContent,
          clientUserMessageId: initial.userMessage.id,
          threadId: input.branchDraft
            ? null
            : currentContext?.threadId ?? null,
          forkFrom:
            input.branchDraft &&
            sourceContext?.threadId &&
            ("turnId" in sourceContext
              ? sourceContext.turnId
              : sourceContext.lastTurnId)
              ? {
                  threadId: sourceContext.threadId,
                  turnId:
                    ("turnId" in sourceContext
                      ? sourceContext.turnId
                      : sourceContext.lastTurnId) as string,
                }
              : null,
          messages: initial.history,
          additionalContext: attachmentContext.additionalContext,
          localImagePaths: attachmentContext.localImagePaths,
          model: initial.snapshot.conversation.settings.model,
          effort:
            initial.snapshot.conversation.settings.reasoningEffort ??
            undefined,
          webSearch: (
            input.tools ??
            initial.snapshot.conversation.settings.composerDefaults.tools
          ).includes("web-search"),
          baseInstructions:
            initial.snapshot.conversation.settings.systemPrompt ?? null,
        },
        (event) => {
          this.enqueueTurnEvent(initial.state, event);
        },
      );
      initial.state.session = session;
      void session.completion.finally(async () => {
        await initial.state.processing.catch(() => undefined);
        this.activeTurns.delete(input.streamId);
        this.activeBranchStreams.delete(initial.branchKey);
      });
    } catch (error) {
      await initial.state.processing.catch(() => undefined);
      const message =
        error instanceof Error
          ? error.message
          : "Branchy could not start this response.";
      await this.settleIncompleteTurn(initial.state, "error", message).catch(
        () => {
          initial.state.terminal = true;
        },
      );
      this.publishStream(input.streamId, {
        type: "error",
        message,
        recoverable: true,
      });
      this.activeTurns.delete(input.streamId);
      this.activeBranchStreams.delete(initial.branchKey);
      throw error;
    }

    const canonical = this.repository.require(input.conversationId);
    return {
      ...this.loadResult(canonical),
      streamId: input.streamId,
      optimisticUserMessage:
        canonical.messages[initial.userMessage.id] ?? initial.userMessage,
      pendingAssistantMessage:
        canonical.messages[initial.assistantMessage.id] ??
        initial.assistantMessage,
      appendedMessages: [
        canonical.messages[initial.userMessage.id] ?? initial.userMessage,
        canonical.messages[initial.assistantMessage.id] ??
          initial.assistantMessage,
      ],
      createdBranch: initial.createdBranch,
    };
  }

  private async handleTurnEvent(
    state: ActiveTurn,
    event: CodexTurnEvent,
  ): Promise<void> {
    if (state.terminal) {
      return;
    }
    switch (event.type) {
      case "context":
        state.threadId = event.threadId;
        state.contextMode = event.contextMode;
        state.recovered = event.recovered;
        state.historyTruncated = event.historyTruncated;
        return;
      case "start":
        state.threadId = event.threadId;
        state.turnId = event.turnId;
        state.contextMode = event.contextMode;
        state.recovered = event.recovered;
        this.publishStream(state.streamId, {
          type: "start",
          threadId: event.threadId,
          turnId: event.turnId ?? undefined,
          contextMode: event.contextMode,
          recovered: event.recovered,
        });
        return;
      case "delta":
        state.content += event.delta;
        this.publishStream(state.streamId, {
          type: "delta",
          delta: event.delta,
        });
        return;
      case "reasoning_summary":
        state.reasoningSummary = event.content;
        this.publishStream(state.streamId, {
          type: "reasoning_summary",
          delta: event.delta,
          content: event.content,
        });
        return;
      case "tool_progress": {
        const existing = state.toolInvocations.get(event.callId);
        const created = toolInvocation(event, this.now().toISOString());
        state.toolInvocations.set(event.callId, {
          ...(existing ?? created),
          input:
            existing?.input ??
            (event.tool === "image_generation"
              ? { prompt: state.userPrompt }
              : created.input),
          status: event.status,
          completedAt:
            event.status === "running" ? null : this.now().toISOString(),
          error:
            event.status === "failed"
              ? { message: `${event.tool.replaceAll("_", " ")} failed` }
              : null,
        });
        await this.persistTurnProgress(state);
        this.publishStream(state.streamId, {
          type: "tool_progress",
          tool: event.tool,
          callId: event.callId,
          status: event.status,
          ...(event.query ? { query: event.query } : {}),
        });
        return;
      }
      case "image_ready": {
        const asset = await this.assets.ingestGeneratedImage({
          savedPath: event.savedPath,
        });
        const existing =
          state.toolInvocations.get(event.imageId) ??
          toolInvocation(
            {
              ...event,
              type: "tool_progress",
              tool: "image_generation",
              callId: event.imageId,
              status: "succeeded",
            },
            this.now().toISOString(),
          );
        state.toolInvocations.set(event.imageId, {
          ...existing,
          input: existing.input ?? { prompt: state.userPrompt },
          status: "succeeded",
          completedAt: this.now().toISOString(),
          output: {
            imageId: asset.assetId,
            storageKey: asset.assetId,
            contentType: asset.mimeType,
            revisedPrompt: event.revisedPrompt,
          },
          error: null,
        });
        await this.persistTurnProgress(state);
        this.publishStream(state.streamId, {
          type: "image_ready",
          imageId: asset.assetId,
          revisedPrompt: event.revisedPrompt,
        });
        return;
      }
      case "complete":
        await this.completeTurn(state, event);
        return;
      case "cancelled":
        await this.settleIncompleteTurn(state, "cancelled", null);
        this.publishStream(state.streamId, { type: "cancelled" });
        return;
      case "error":
        await this.settleIncompleteTurn(state, "error", event.message);
        this.publishStream(state.streamId, {
          type: "error",
          message: event.message,
          recoverable: true,
        });
        return;
    }
  }

  private enqueueTurnEvent(state: ActiveTurn, event: CodexTurnEvent): void {
    state.processing = state.processing
      .catch(() => undefined)
      .then(async () => {
        if (state.terminal) {
          return;
        }
        try {
          await this.handleTurnEvent(state, event);
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Branchy could not process the response.";
          await this.settleIncompleteTurn(state, "error", message).catch(() => {
            state.terminal = true;
          });
          this.publishStream(state.streamId, {
            type: "error",
            message,
            recoverable: true,
          });
        }
      });
  }

  private async completeTurn(
    state: ActiveTurn,
    event: Extract<CodexTurnEvent, { type: "complete" }>,
  ): Promise<void> {
    const canonical = await this.withMutation(state.conversationId, async () => {
      const snapshot = cloneConversationSnapshot(
        this.repository.require(state.conversationId),
      );
      const assistant = snapshot.messages[state.assistantMessageId];
      const branch = snapshot.branches[state.branchId];
      if (!assistant || !branch) {
        throw new Error("The active Branchy response no longer exists.");
      }
      for (const [id, invocation] of state.toolInvocations) {
        if (
          invocation.status === "pending" ||
          invocation.status === "running"
        ) {
          state.toolInvocations.set(id, {
            ...invocation,
            status: "failed",
            completedAt: this.now().toISOString(),
            error: {
              message: "The tool did not return a completed result.",
            },
          });
        }
      }
      const completed: Message = {
        ...assistant,
        content: event.content,
        tokenUsage: {
          prompt: event.promptTokens,
          completion: event.completionTokens,
          cost: 0,
        },
        toolInvocations: [...state.toolInvocations.values()],
        inferenceContext:
          event.turnId && event.threadId
            ? {
                provider: "codex",
                threadId: event.threadId,
                turnId: event.turnId,
              }
            : assistant.inferenceContext,
      };
      branch.inferenceContext = {
        provider: "codex",
        threadId: event.threadId,
        lastTurnId: event.turnId,
      };
      snapshot.messages[completed.id] = completed;
      this.saveSnapshot(snapshot);
      return {
        snapshot,
        assistant: completed,
        version: this.versionFor(state.conversationId),
      };
    });
    state.terminal = true;
    this.publishStream(state.streamId, {
      type: "complete",
      content: canonical.assistant.content,
      canonical: {
        conversationId: state.conversationId,
        branchId: state.branchId,
        version: canonical.version,
        assistantMessage: canonical.assistant,
        assistantRenderedHtml: renderMessage(canonical.assistant).renderedHtml,
      },
      reasoningSummary: event.reasoningSummary,
      promptTokens: event.promptTokens,
      completionTokens: event.completionTokens,
      threadId: event.threadId,
      turnId: event.turnId ?? undefined,
      recovered: event.recovered,
      historyTruncated: event.historyTruncated,
    });
  }

  private async persistTurnProgress(state: ActiveTurn): Promise<void> {
    await this.withMutation(state.conversationId, async () => {
      const snapshot = cloneConversationSnapshot(
        this.repository.require(state.conversationId),
      );
      const assistant = snapshot.messages[state.assistantMessageId];
      if (!assistant) {
        throw new Error("The active Branchy response no longer exists.");
      }
      assistant.toolInvocations = [...state.toolInvocations.values()];
      this.saveSnapshot(snapshot);
    });
  }

  private async settleIncompleteTurn(
    state: ActiveTurn,
    status: "cancelled" | "error",
    message: string | null,
  ): Promise<void> {
    await this.withMutation(state.conversationId, async () => {
      const snapshot = cloneConversationSnapshot(
        this.repository.require(state.conversationId),
      );
      const assistant = snapshot.messages[state.assistantMessageId];
      if (!assistant) {
        return;
      }
      assistant.content =
        state.content.trim() ||
        (status === "error"
          ? `Branchy could not complete this response: ${message ?? "unknown error"}`
          : "Response cancelled.");
      assistant.toolInvocations = [...state.toolInvocations.values()].map(
        (invocation) =>
          invocation.status === "running" ||
          invocation.status === "pending"
            ? {
                ...invocation,
                status: "failed" as const,
                completedAt: this.now().toISOString(),
                error: {
                  message:
                    status === "cancelled"
                      ? "Generation was cancelled."
                      : message ?? "Generation failed.",
                },
              }
            : invocation,
      );
      this.saveSnapshot(snapshot);
    });
    state.terminal = true;
  }

  private createChildBranch(
    snapshot: ConversationGraphSnapshot,
    input: {
      parentBranchId: BranchId;
      messageId: string;
      span?: { start: number; end: number } | null;
      excerpt?: string | null;
      title?: string;
    },
  ): Branch {
    const parent = snapshot.branches[input.parentBranchId];
    if (!parent || !parent.messageIds.includes(input.messageId)) {
      throw new Error("The selected source message is not on the parent branch.");
    }
    return {
      id: `branch-${randomUUID()}`,
      parentId: parent.id,
      title:
        input.title?.trim() ||
        titleFromPrompt(input.excerpt ?? "New branch"),
      createdFrom: {
        messageId: input.messageId,
        span: input.span ?? null,
        excerpt: input.excerpt ?? null,
      },
      messageIds: [],
      createdAt: this.now().toISOString(),
    };
  }

  private async attachmentContext(
    attachments: readonly MessageAttachment[],
  ): Promise<{
    additionalContext: Record<
      string,
      { value: string; kind: "untrusted" }
    > | null;
    localImagePaths: string[];
  }> {
    const additionalContext: Record<
      string,
      { value: string; kind: "untrusted" }
    > = {};
    const localImagePaths: string[] = [];
    for (const [index, attachment] of attachments.entries()) {
      const resolved = await this.assets.resolveAssetFile(
        attachment.storageKey,
      );
      if (attachment.contentType.startsWith("image/")) {
        localImagePaths.push(resolved.absolutePath);
        continue;
      }
      const text = await extractAttachmentContext({
        bytes: await readFile(resolved.absolutePath),
        contentType: attachment.contentType,
        fileName: attachment.name,
      });
      if (text) {
        additionalContext[`Attachment ${index + 1}: ${attachment.name}`] = {
          value: text,
          kind: "untrusted",
        };
      }
    }
    return {
      additionalContext:
        Object.keys(additionalContext).length > 0
          ? additionalContext
          : null,
      localImagePaths,
    };
  }

  private messageAttachments(
    conversationId: string,
    attachmentIds: readonly string[],
  ): MessageAttachment[] {
    if (attachmentIds.length > MAX_ATTACHMENTS_PER_MESSAGE) {
      throw new Error(
        `You can attach at most ${MAX_ATTACHMENTS_PER_MESSAGE} files to one message.`,
      );
    }
    const pending = this.pendingAttachments.get(conversationId);
    return attachmentIds.map((attachmentId) => {
      const attachment = pending?.get(attachmentId);
      if (!attachment || attachment.status !== "ready") {
        throw new Error(`Attachment ${attachmentId} is not ready.`);
      }
      return {
        id: attachment.id,
        kind: "file",
        name: attachment.name,
        contentType: attachment.contentType,
        size: attachment.size,
        storageKey: attachment.storageKey,
        uploadedAt:
          attachment.uploadedAt ??
          attachment.createdAt,
      };
    });
  }

  private consumePendingAttachments(
    conversationId: string,
    attachmentIds: readonly string[],
  ): void {
    const pending = this.pendingAttachments.get(conversationId);
    for (const attachmentId of attachmentIds) {
      pending?.delete(attachmentId);
    }
  }

  private requireGeneratedImage(
    conversationId: string,
    messageId: string,
    imageId: string,
  ): string {
    const invocation = this.requireImageGenerationInvocation(
      conversationId,
      messageId,
      imageId,
    );
    if (
      invocation.status !== "succeeded" ||
      !invocation.output ||
      typeof invocation.output !== "object"
    ) {
      throw new Error("Generated image was not found.");
    }
    const output = invocation.output as Record<string, unknown>;
    if (
      typeof output.storageKey === "string" &&
      output.storageKey.length > 0
    ) {
      return output.storageKey;
    }
    throw new Error("Generated image was not found.");
  }

  private requireImageGenerationInvocation(
    conversationId: string,
    messageId: string,
    imageId: string,
  ): ToolInvocation {
    const message = this.repository.require(conversationId).messages[messageId];
    if (!message) {
      throw new Error("Generated image message was not found.");
    }
    for (const invocation of message.toolInvocations ?? []) {
      if (invocation.toolType !== "image_generation") {
        continue;
      }
      const output =
        invocation.output && typeof invocation.output === "object"
          ? (invocation.output as Record<string, unknown>)
          : null;
      if (
        invocation.id === imageId ||
        invocation.callId === imageId ||
        output?.imageId === imageId ||
        output?.id === imageId ||
        output?.assetId === imageId
      ) {
        return invocation;
      }
    }
    throw new Error("Generated image was not found.");
  }

  private async importAssets(
    staged: StagedBranchyArchive,
    snapshots: readonly ConversationGraphSnapshot[],
  ): Promise<void> {
    const required = referencedAssetKeys(snapshots);
    const names = assetNames(snapshots);
    const images = imageStorageKeys(snapshots);
    for (const asset of staged.assets) {
      if (!required.has(asset.storageKey)) {
        continue;
      }
      const contentType = asset.contentType as SupportedAssetMimeType | null;
      if (!contentType) {
        throw new Error(`Archive asset ${asset.storageKey} has no file type.`);
      }
      const extension = canonicalExtensionForMimeType(contentType);
      const originalName =
        names.get(asset.storageKey) ??
        `branchy-generated-image.${extension}`;
      const stored = images.has(asset.storageKey)
        ? await this.assets.writeGeneratedImage({
            bytes: asset.bytes,
            fileName: originalName,
            mimeType: contentType,
          })
        : await this.assets.writeAttachment({
            bytes: asset.bytes,
            fileName: originalName,
            mimeType: contentType,
          });
      if (stored.assetId !== asset.storageKey) {
        throw new Error("Archive asset identity did not match its contents.");
      }
    }
  }

  private async deleteProviderThreads(threadIds: string[]): Promise<void> {
    if (threadIds.length === 0) {
      return;
    }
    const result = await this.codex.deleteThreads(threadIds);
    if (result.failed.length > 0) {
      throw new Error(
        `Branchy could not delete ${result.failed.length} provider ${
          result.failed.length === 1 ? "thread" : "threads"
        }. No local conversation data was removed.`,
      );
    }
  }

  private async deleteUnreferencedAssets(
    candidates: ReadonlySet<string>,
  ): Promise<void> {
    if (candidates.size === 0) {
      return;
    }
    const referenced = new Set<string>();
    for (const entry of this.repository.list({ includeArchived: true })) {
      for (const key of referencedAssetKeys([
        this.repository.require(entry.id),
      ])) {
        referenced.add(key);
      }
    }
    for (const pending of this.pendingAttachments.values()) {
      for (const attachment of pending.values()) {
        referenced.add(attachment.storageKey);
      }
    }
    for (const candidate of candidates) {
      if (!referenced.has(candidate)) {
        await this.assets.deleteAsset(candidate);
      }
    }
  }

  private loadResult(
    snapshot: ConversationGraphSnapshot,
  ): ConversationLoadResult {
    return {
      conversationId: snapshot.conversation.id,
      snapshot,
      version: this.versionFor(snapshot.conversation.id),
      activeStreams: this.activeStreamsFor(snapshot.conversation.id),
    };
  }

  private activeStreamsFor(
    conversationId: string,
  ): ActiveConversationStream[] {
    return [...this.activeTurns.values()]
      .filter(
        (turn) =>
          turn.conversationId === conversationId && !turn.terminal,
      )
      .map((turn) => ({
        streamId: turn.streamId,
        branchId: turn.branchId,
        assistantMessageId: turn.assistantMessageId,
      }))
      .sort((left, right) => left.streamId.localeCompare(right.streamId));
  }

  private saveSnapshot(snapshot: ConversationGraphSnapshot): void {
    this.repository.save(snapshot, {
      lastActiveAt: this.now().toISOString(),
    });
    this.bumpVersion(snapshot.conversation.id);
  }

  private versionFor(conversationId: string): number {
    const existing = this.versions.get(conversationId);
    if (existing) {
      return existing;
    }
    this.versions.set(conversationId, 1);
    return 1;
  }

  private bumpVersion(conversationId: string): number {
    const next = this.versionFor(conversationId) + 1;
    this.versions.set(conversationId, next);
    return next;
  }

  private async withMutation<T>(
    conversationId: string,
    operation: () => Promise<T> | T,
  ): Promise<T> {
    const prior = this.mutationTails.get(conversationId) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = prior.catch(() => undefined).then(() => gate);
    this.mutationTails.set(conversationId, tail);
    await prior.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release?.();
      if (this.mutationTails.get(conversationId) === tail) {
        this.mutationTails.delete(conversationId);
      }
    }
  }
}
