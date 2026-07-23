import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AssetStore } from "../assets/index.ts";
import type {
  CancelTurnResult,
  CodexAccountState,
  CodexTurnEvent,
  CodexTurnSession,
  DeleteThreadsResult,
  DeviceCodeLoginSession,
  DictationResult,
  StartCodexTurnInput,
} from "../codex/index.ts";
import { ConversationRepository } from "../persistence/index.ts";
import {
  BranchyApplication,
  type BranchyCodexGateway,
} from "./service.ts";
import type { BranchyStreamEvent } from "../../shared/contracts.ts";

const NOW = new Date("2026-07-23T12:00:00.000Z");
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

interface FakeTurn {
  callback: (event: CodexTurnEvent) => void;
  resolve: (event: Extract<
    CodexTurnEvent,
    { type: "complete" | "cancelled" | "error" }
  >) => void;
  session: CodexTurnSession;
  threadId: string;
  turnId: string;
}

class FakeCodex implements BranchyCodexGateway {
  readonly inputs: StartCodexTurnInput[] = [];
  readonly deletedThreads: string[][] = [];
  deviceLoginCancelCount = 0;
  deviceVerificationUrl = "https://auth.openai.com/codex/device";
  failNextStartMessage: string | null = null;
  deleteFailureMessage: string | null = null;
  private readonly turns = new Map<string, FakeTurn>();
  private turnNumber = 0;

  async readAccount(): Promise<CodexAccountState> {
    return {
      status: "chatgpt",
      email: "branchy@example.test",
      planType: "plus",
      requiresOpenaiAuth: true,
    };
  }

  async startTurn(
    input: StartCodexTurnInput,
    callback: (event: CodexTurnEvent) => void,
  ): Promise<CodexTurnSession> {
    this.inputs.push(structuredClone(input));
    if (this.failNextStartMessage) {
      const message = this.failNextStartMessage;
      this.failNextStartMessage = null;
      throw new Error(message);
    }
    this.turnNumber += 1;
    const threadId = input.forkFrom
      ? `thread-fork-${this.turnNumber}`
      : input.threadId ?? `thread-${this.turnNumber}`;
    const turnId = `turn-${this.turnNumber}`;
    let resolve:
      | FakeTurn["resolve"]
      | undefined;
    const completion = new Promise<
      Extract<CodexTurnEvent, { type: "complete" | "cancelled" | "error" }>
    >((resolvePromise) => {
      resolve = resolvePromise;
    });
    const session: CodexTurnSession = {
      streamId: input.streamId,
      threadId,
      completion,
      cancel: async () => {
        this.emit(input.streamId, {
          type: "cancelled",
          streamId: input.streamId,
          threadId,
          turnId,
        });
        return true;
      },
    };
    this.turns.set(input.streamId, {
      callback,
      resolve: resolve as FakeTurn["resolve"],
      session,
      threadId,
      turnId,
    });
    callback({
      type: "context",
      streamId: input.streamId,
      threadId,
      contextMode: input.forkFrom
        ? "fork"
        : input.threadId
          ? "resume"
          : "start",
      recovered: false,
      historyTruncated: false,
    });
    callback({
      type: "start",
      streamId: input.streamId,
      threadId,
      turnId,
      contextMode: input.forkFrom
        ? "fork"
        : input.threadId
          ? "resume"
          : "start",
      recovered: false,
    });
    return session;
  }

  emit(streamId: string, event: CodexTurnEvent): void {
    const turn = this.turns.get(streamId);
    if (!turn) {
      throw new Error(`Unknown stream ${streamId}`);
    }
    turn.callback(event);
    if (
      event.type === "complete" ||
      event.type === "cancelled" ||
      event.type === "error"
    ) {
      turn.resolve(event);
      this.turns.delete(streamId);
    }
  }

  turn(streamId: string): { threadId: string; turnId: string } {
    const turn = this.turns.get(streamId);
    if (!turn) {
      throw new Error(`Unknown stream ${streamId}`);
    }
    return turn;
  }

  async cancelTurn(streamId: string): Promise<CancelTurnResult> {
    const turn = this.turns.get(streamId);
    if (!turn) {
      return { interrupted: true, settled: false, queued: true };
    }
    await turn.session.cancel();
    return { interrupted: true, settled: false };
  }

  async deleteThreads(threadIds: string[]): Promise<DeleteThreadsResult> {
    this.deletedThreads.push([...threadIds]);
    return this.deleteFailureMessage
      ? {
          deleted: [],
          failed: threadIds.map((threadId) => ({
            threadId,
            message: this.deleteFailureMessage!,
          })),
        }
      : { deleted: [...threadIds], failed: [] };
  }

  async transcribeWav(): Promise<DictationResult> {
    return { transcript: "dictated text", durationSeconds: 1 };
  }

  async startDeviceCodeLogin(): Promise<DeviceCodeLoginSession> {
    return {
      loginId: "login-1",
      verificationUrl: this.deviceVerificationUrl,
      userCode: "BRANCH-Y",
      completion: new Promise(() => {}),
      cancel: async () => {
        this.deviceLoginCancelCount += 1;
        return true;
      },
    };
  }

  async cancelDeviceCodeLogin(): Promise<boolean> {
    return true;
  }

  async logoutChatGpt(): Promise<CodexAccountState> {
    return { status: "signed-out", requiresOpenaiAuth: true };
  }

  async stop(): Promise<void> {}
}

async function setup(t: test.TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "branchy-application-"));
  const generatedRoot = join(directory, "codex-workspace");
  await mkdir(generatedRoot, { recursive: true });
  const assets = await AssetStore.open({
    rootPath: join(directory, "assets"),
    generatedImageSourceRoots: [generatedRoot],
    now: () => NOW,
  });
  const repository = ConversationRepository.open(":memory:", {
    clock: () => NOW.toISOString(),
  });
  const codex = new FakeCodex();
  const streams = new Map<string, BranchyStreamEvent[]>();
  const application = new BranchyApplication({
    assets,
    codex,
    repository,
    now: () => new Date(NOW),
    publishStream: (streamId, event) => {
      const events = streams.get(streamId) ?? [];
      events.push(event);
      streams.set(streamId, events);
    },
  });
  t.after(async () => {
    await application.close();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    application,
    assets,
    codex,
    directory,
    generatedRoot,
    repository,
    streams,
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for application state");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("persists streamed image progress, completion, and native fork context", async (t) => {
  const harness = await setup(t);
  const created = harness.application.createConversation({
    title: "Visual exploration",
  });
  const rootBranchId = created.snapshot.conversation.rootBranchId;
  const sent = await harness.application.sendMessage({
    conversationId: created.conversationId,
    branchId: rootBranchId,
    content: "Generate a small blue square",
    streamId: "stream-root",
  });
  const turn = harness.codex.turn("stream-root");
  const activeBootstrap = await harness.application.bootstrap({
    conversationId: created.conversationId,
  });
  assert.equal(activeBootstrap.kind, "ready");
  if (activeBootstrap.kind === "ready") {
    assert.deepEqual(activeBootstrap.activeStreams, [
      {
        streamId: "stream-root",
        branchId: rootBranchId,
        assistantMessageId: sent.pendingAssistantMessage.id,
      },
    ]);
  }

  harness.codex.emit("stream-root", {
    type: "tool_progress",
    streamId: "stream-root",
    threadId: turn.threadId,
    turnId: turn.turnId,
    tool: "image_generation",
    callId: "image-call",
    status: "running",
  });
  await waitFor(() => {
    const assistant = harness.repository.require(created.conversationId)
      .messages[sent.pendingAssistantMessage.id];
    return assistant?.toolInvocations?.[0]?.status === "running";
  });

  const generatedPath = join(harness.generatedRoot, "result.png");
  await writeFile(generatedPath, PNG);
  harness.codex.emit("stream-root", {
    type: "image_ready",
    streamId: "stream-root",
    threadId: turn.threadId,
    turnId: turn.turnId,
    imageId: "image-call",
    savedPath: generatedPath,
    revisedPrompt: "A small blue square",
  });
  harness.codex.emit("stream-root", {
    type: "complete",
    streamId: "stream-root",
    threadId: turn.threadId,
    turnId: turn.turnId,
    content: "Here is the image.",
    reasoningSummary: null,
    promptTokens: 11,
    completionTokens: 6,
    contextMode: "start",
    recovered: false,
    historyTruncated: false,
  });
  await waitFor(
    () =>
      harness.streams
        .get("stream-root")
        ?.some((event) => event.type === "complete") === true,
  );
  await waitFor(() => {
    const bootstrap = harness.application.loadConversation(
      created.conversationId,
    );
    return bootstrap.activeStreams.length === 0;
  });

  const canonical = harness.repository.require(created.conversationId);
  const assistant = canonical.messages[sent.pendingAssistantMessage.id]!;
  assert.equal(assistant.content, "Here is the image.");
  assert.equal(assistant.toolInvocations?.[0]?.status, "succeeded");
  const output = assistant.toolInvocations?.[0]?.output as {
    imageId: string;
  };
  assert.match(
    harness.application.generatedImageUrl(
      created.conversationId,
      assistant.id,
      output.imageId,
    ),
    /^branchy-asset:\/\/asset\/asset_[a-f0-9]{64}$/u,
  );

  const child = await harness.application.sendMessage({
    conversationId: created.conversationId,
    content: "Explore a red version",
    streamId: "stream-child",
    branchDraft: {
      parentBranchId: rootBranchId,
      messageId: assistant.id,
      excerpt: "Here is the image.",
      span: { start: 0, end: 18 },
    },
  });
  assert.equal(child.createdBranch?.parentId, rootBranchId);
  assert.deepEqual(harness.codex.inputs[1]?.forkFrom, {
    threadId: turn.threadId,
    turnId: turn.turnId,
  });
  const childTurn = harness.codex.turn("stream-child");
  harness.codex.emit("stream-child", {
    type: "cancelled",
    streamId: "stream-child",
    threadId: childTurn.threadId,
    turnId: childTurn.turnId,
  });
});

test("retries a failed image invocation without treating it as downloadable", async (t) => {
  const harness = await setup(t);
  const created = harness.application.createConversation({
    title: "Retry failed image",
  });
  const branchId = created.snapshot.conversation.rootBranchId;
  const sent = await harness.application.sendMessage({
    conversationId: created.conversationId,
    branchId,
    content: "Generate a glass lighthouse",
    streamId: "stream-image-failure",
  });
  const turn = harness.codex.turn("stream-image-failure");
  harness.codex.emit("stream-image-failure", {
    type: "tool_progress",
    streamId: "stream-image-failure",
    threadId: turn.threadId,
    turnId: turn.turnId,
    tool: "image_generation",
    callId: "failed-image-call",
    status: "failed",
  });
  harness.codex.emit("stream-image-failure", {
    type: "complete",
    streamId: "stream-image-failure",
    threadId: turn.threadId,
    turnId: turn.turnId,
    content: "The image could not be generated.",
    reasoningSummary: null,
    promptTokens: 4,
    completionTokens: 3,
    contextMode: "start",
    recovered: false,
    historyTruncated: false,
  });
  await waitFor(
    () =>
      harness.application.loadConversation(created.conversationId).activeStreams
        .length === 0,
  );

  const failed = harness.repository.require(created.conversationId).messages[
    sent.pendingAssistantMessage.id
  ]?.toolInvocations?.[0];
  assert.equal(failed?.id, "failed-image-call");
  assert.equal(failed?.status, "failed");
  assert.throws(
    () =>
      harness.application.generatedImageUrl(
        created.conversationId,
        sent.pendingAssistantMessage.id,
        "failed-image-call",
      ),
    /Generated image was not found/u,
  );
  await assert.rejects(
    harness.application.generatedImageFile(
      created.conversationId,
      sent.pendingAssistantMessage.id,
      "failed-image-call",
    ),
    /Generated image was not found/u,
  );

  const retry = await harness.application.retryGeneratedImage({
    conversationId: created.conversationId,
    branchId,
    messageId: sent.pendingAssistantMessage.id,
    imageId: "failed-image-call",
    prompt: "A glass lighthouse at blue hour",
    streamId: "stream-image-retry",
  });
  assert.equal(
    harness.codex.inputs[1]?.content,
    "Generate an image using this prompt:\n\nA glass lighthouse at blue hour",
  );
  assert.equal(
    retry.optimisticUserMessage.content,
    "A glass lighthouse at blue hour",
  );

  const retryTurn = harness.codex.turn("stream-image-retry");
  harness.codex.emit("stream-image-retry", {
    type: "cancelled",
    streamId: "stream-image-retry",
    threadId: retryTurn.threadId,
    turnId: retryTurn.turnId,
  });
});

test("startChatGptLogin accepts only the official verification URL", async (t) => {
  const harness = await setup(t);
  const result = await harness.application.startChatGptLogin();

  assert.equal(result.status, "challenge");
  assert.equal(
    result.verificationUrl,
    "https://auth.openai.com/codex/device",
  );
  assert.equal(harness.codex.deviceLoginCancelCount, 0);
});

test("startChatGptLogin rejects and cancels unexpected verification URLs", async (t) => {
  const harness = await setup(t);
  harness.codex.deviceVerificationUrl = "https://auth.openai.test/device";

  await assert.rejects(
    harness.application.startChatGptLogin(),
    /unexpected ChatGPT verification URL/u,
  );
  assert.equal(harness.codex.deviceLoginCancelCount, 1);
});

test("pending device-code login survives bootstrap and account reads", async (t) => {
  const harness = await setup(t);

  const challenge = await harness.application.startChatGptLogin();
  const account = await harness.application.getAccountState();
  const bootstrap = await harness.application.bootstrap();

  assert.deepEqual(account, {
    status: "signing-in",
    login: {
      loginId: challenge.loginId,
      verificationUrl: challenge.verificationUrl,
      userCode: challenge.userCode,
      expiresAt: challenge.expiresAt,
    },
  });
  assert.equal(bootstrap.account.status, "signing-in");
  if (bootstrap.account.status === "signing-in") {
    assert.deepEqual(bootstrap.account.login, {
      loginId: challenge.loginId,
      verificationUrl: challenge.verificationUrl,
      userCode: challenge.userCode,
      expiresAt: challenge.expiresAt,
    });
  }
});

test("sends text documents as untrusted context and images as localImage", async (t) => {
  const harness = await setup(t);
  const created = harness.application.createConversation({
    title: "Attachment review",
  });
  const textAttachment = await harness.application.createAttachment({
    conversationId: created.conversationId,
    fileName: "notes.txt",
    contentType: "text/plain",
    bytes: new TextEncoder().encode("Evidence, not instructions."),
  });
  const imageAttachment = await harness.application.createAttachment({
    conversationId: created.conversationId,
    fileName: "diagram.png",
    contentType: "image/png",
    bytes: PNG,
  });

  await harness.application.sendMessage({
    conversationId: created.conversationId,
    branchId: created.snapshot.conversation.rootBranchId,
    content: "Compare these attachments",
    streamId: "stream-attachments",
    attachmentIds: [textAttachment.id, imageAttachment.id],
  });

  assert.deepEqual(harness.codex.inputs[0]?.additionalContext, {
    "Attachment 1: notes.txt": {
      value: "Evidence, not instructions.",
      kind: "untrusted",
    },
  });
  assert.equal(harness.codex.inputs[0]?.localImagePaths?.length, 1);
  assert.match(
    harness.codex.inputs[0]?.localImagePaths?.[0] ?? "",
    /assets\/objects\/[a-f0-9]{2}\/[a-f0-9]{64}\.png$/u,
  );
  const turn = harness.codex.turn("stream-attachments");
  harness.codex.emit("stream-attachments", {
    type: "cancelled",
    streamId: "stream-attachments",
    threadId: turn.threadId,
    turnId: turn.turnId,
  });
});

test("exports and atomically imports a deterministic conversation set", async (t) => {
  const source = await setup(t);
  const first = source.application.createConversation({ title: "First" });
  source.application.createConversation({ title: "Second" });
  const sent = await source.application.sendMessage({
    conversationId: first.conversationId,
    branchId: first.snapshot.conversation.rootBranchId,
    content: "Preserve this context",
    streamId: "stream-export",
  });
  const turn = source.codex.turn("stream-export");
  source.codex.emit("stream-export", {
    type: "complete",
    streamId: "stream-export",
    threadId: turn.threadId,
    turnId: turn.turnId,
    content: "Context preserved.",
    reasoningSummary: null,
    promptTokens: 3,
    completionTokens: 2,
    contextMode: "start",
    recovered: false,
    historyTruncated: false,
  });
  await waitFor(
    () =>
      source.repository.require(first.conversationId).messages[
        sent.pendingAssistantMessage.id
      ]?.inferenceContext?.threadId === turn.threadId,
  );

  const firstExport = await source.application.exportArchive();
  const secondExport = await source.application.exportArchive();
  assert.equal(firstExport.conversationCount, 2);
  assert.deepEqual(firstExport.bytes, secondExport.bytes);

  const destination = await setup(t);
  const imported = await destination.application.importArchive(
    firstExport.bytes,
    "skip",
  );
  assert.equal(imported.importedConversationIds.length, 2);
  assert.equal(destination.repository.list().length, 2);

  const skipped = await destination.application.importArchive(
    firstExport.bytes,
    "skip",
  );
  assert.equal(skipped.skippedConversationIds.length, 2);
  assert.equal(destination.repository.list().length, 2);

  const duplicated = await destination.application.importArchive(
    firstExport.bytes,
    "duplicate",
  );
  assert.equal(duplicated.importedConversationIds.length, 2);
  assert.equal(destination.repository.list().length, 4);
  const duplicateWithContext = destination.repository.require(
    duplicated.importedConversationIds.find((id) => {
      const snapshot = destination.repository.require(id);
      return Object.values(snapshot.messages).some(
        (message) => message.content === "Context preserved.",
      );
    })!,
  );
  assert.ok(
    Object.values(duplicateWithContext.branches).every(
      (branch) => branch.inferenceContext == null,
    ),
  );
  assert.ok(
    Object.values(duplicateWithContext.messages).every(
      (message) => message.inferenceContext == null,
    ),
  );
});

test("settles a turn that fails before its first provider event", async (t) => {
  const harness = await setup(t);
  const created = harness.application.createConversation({
    title: "Unavailable provider",
  });
  harness.codex.failNextStartMessage = "Provider is unavailable";

  await assert.rejects(
    harness.application.sendMessage({
      conversationId: created.conversationId,
      branchId: created.snapshot.conversation.rootBranchId,
      content: "Try this once",
      streamId: "stream-start-failure",
    }),
    /Provider is unavailable/u,
  );

  const snapshot = harness.repository.require(created.conversationId);
  const assistant = Object.values(snapshot.messages).find(
    (message) => message.role === "assistant",
  );
  assert.match(assistant?.content ?? "", /Provider is unavailable/u);
  assert.equal(
    harness.application.loadConversation(created.conversationId).activeStreams
      .length,
    0,
  );
  assert.equal(
    harness.streams
      .get("stream-start-failure")
      ?.some((event) => event.type === "error"),
    true,
  );
});

test("an immediate cancellation persists an explicit terminal message", async (t) => {
  const harness = await setup(t);
  const created = harness.application.createConversation({
    title: "Cancelled response",
  });
  const sent = await harness.application.sendMessage({
    conversationId: created.conversationId,
    branchId: created.snapshot.conversation.rootBranchId,
    content: "Stop immediately",
    streamId: "stream-cancel-early",
  });
  const turn = harness.codex.turn("stream-cancel-early");
  harness.codex.emit("stream-cancel-early", {
    type: "cancelled",
    streamId: "stream-cancel-early",
    threadId: turn.threadId,
    turnId: turn.turnId,
  });
  await waitFor(
    () =>
      harness.repository.require(created.conversationId).messages[
        sent.pendingAssistantMessage.id
      ]?.content === "Response cancelled.",
  );

  assert.equal(harness.application.recoverInterruptedMessages(), 0);
});

test("turn-processing failures settle and publish a terminal error", async (t) => {
  const harness = await setup(t);
  const created = harness.application.createConversation({
    title: "Failed image ingest",
  });
  const sent = await harness.application.sendMessage({
    conversationId: created.conversationId,
    branchId: created.snapshot.conversation.rootBranchId,
    content: "Generate an image",
    streamId: "stream-ingest-failure",
  });
  const turn = harness.codex.turn("stream-ingest-failure");

  harness.codex.emit("stream-ingest-failure", {
    type: "image_ready",
    streamId: "stream-ingest-failure",
    threadId: turn.threadId,
    turnId: turn.turnId,
    imageId: "image-failed",
    savedPath: join(harness.directory, "outside-workspace.png"),
    revisedPrompt: null,
  });
  harness.codex.emit("stream-ingest-failure", {
    type: "complete",
    streamId: "stream-ingest-failure",
    threadId: turn.threadId,
    turnId: turn.turnId,
    content: "This must not overwrite the failure.",
    reasoningSummary: null,
    promptTokens: 2,
    completionTokens: 2,
    contextMode: "start",
    recovered: false,
    historyTruncated: false,
  });

  await waitFor(
    () =>
      harness.streams
        .get("stream-ingest-failure")
        ?.some((event) => event.type === "error") === true,
  );
  const assistant = harness.repository.require(created.conversationId)
    .messages[sent.pendingAssistantMessage.id];
  assert.match(assistant?.content ?? "", /generated image source/i);
  assert.equal(
    harness.streams
      .get("stream-ingest-failure")
      ?.some((event) => event.type === "complete"),
    false,
  );
});

test("restart recovery marks a plain blank assistant as interrupted", async (t) => {
  const harness = await setup(t);
  const created = harness.application.createConversation({
    title: "Interrupted text",
  });
  const snapshot = structuredClone(created.snapshot);
  const branchId = snapshot.conversation.rootBranchId;
  const assistantId = "message-interrupted";
  snapshot.messages[assistantId] = {
    id: assistantId,
    branchId,
    role: "assistant",
    content: "",
    createdAt: NOW.toISOString(),
    toolInvocations: [],
  };
  snapshot.branches[branchId]!.messageIds.push(assistantId);
  harness.repository.save(snapshot);

  assert.equal(harness.application.recoverInterruptedMessages(), 1);
  assert.match(
    harness.repository.require(created.conversationId).messages[assistantId]
      ?.content ?? "",
    /interrupted/u,
  );
});

test("conversation-wide pending attachment limits are bounded and removal collects bytes", async (t) => {
  const harness = await setup(t);
  const created = harness.application.createConversation({
    title: "Attachment quota",
  });
  const attachments = [];
  for (let index = 0; index < 64; index += 1) {
    attachments.push(
      await harness.application.createAttachment({
        conversationId: created.conversationId,
        fileName: `note-${index}.txt`,
        contentType: "text/plain",
        bytes: new TextEncoder().encode(
          index === 1 ? "unique note 0" : `unique note ${index}`,
        ),
      }),
    );
  }
  assert.notEqual(attachments[0]!.id, attachments[1]!.id);
  assert.equal(attachments[0]!.storageKey, attachments[1]!.storageKey);
  assert.equal(attachments[0]!.name, "note-0.txt");
  assert.equal(attachments[1]!.name, "note-1.txt");
  await assert.rejects(
    harness.application.createAttachment({
      conversationId: created.conversationId,
      fileName: "too-many.txt",
      contentType: "text/plain",
      bytes: new TextEncoder().encode("ninth file"),
    }),
    /at most 64 pending attachments/u,
  );
  await assert.rejects(
    harness.application.createAttachment({
      conversationId: created.conversationId,
      fileName: "legacy.doc",
      contentType: "application/msword",
      bytes: new Uint8Array([1, 2, 3]),
    }),
    /Legacy \.doc/u,
  );

  const removed = await harness.application.removeAttachment(
    created.conversationId,
    attachments[2]!.id,
  );
  assert.equal(removed?.id, attachments[2]!.id);
  await assert.rejects(
    harness.assets.resolveAssetFile(attachments[2]!.storageKey),
    /not found/u,
  );
});

test("independent branch composers can stage 5 plus 4 files while each message stays capped at 8", async (t) => {
  const harness = await setup(t);
  const created = harness.application.createConversation({
    title: "Parallel branch composers",
  });
  const rootBranchId = created.snapshot.conversation.rootBranchId;
  const attachments = await Promise.all(
    Array.from({ length: 9 }, (_, index) =>
      harness.application.createAttachment({
        conversationId: created.conversationId,
        fileName: `composer-${index}.txt`,
        contentType: "text/plain",
        bytes: new TextEncoder().encode(`composer attachment ${index}`),
      }),
    ),
  );

  await assert.rejects(
    harness.application.sendMessage({
      conversationId: created.conversationId,
      branchId: rootBranchId,
      content: "Do not accept nine files on one message",
      streamId: "stream-nine-attachments",
      attachmentIds: attachments.map((attachment) => attachment.id),
    }),
    /at most 8 files to one message/u,
  );
  assert.equal(
    Object.keys(
      harness.repository.require(created.conversationId).messages,
    ).length,
    0,
  );

  const sent = await harness.application.sendMessage({
    conversationId: created.conversationId,
    branchId: rootBranchId,
    content: "Use the first composer files",
    streamId: "stream-five-attachments",
    attachmentIds: attachments.slice(0, 5).map((attachment) => attachment.id),
  });
  assert.equal(sent.optimisticUserMessage.attachments?.length, 5);

  const branchNote = harness.application.saveBranchNote({
    conversationId: created.conversationId,
    parentBranchId: rootBranchId,
    messageId: sent.optimisticUserMessage.id,
    content: "Use the second composer files",
    attachmentIds: attachments.slice(5).map((attachment) => attachment.id),
  });
  assert.equal(branchNote.appendedMessages[0]?.attachments?.length, 4);

  const turn = harness.codex.turn("stream-five-attachments");
  harness.codex.emit("stream-five-attachments", {
    type: "complete",
    streamId: "stream-five-attachments",
    threadId: turn.threadId,
    turnId: turn.turnId,
    content: "Used the first composer files.",
    reasoningSummary: null,
    promptTokens: 5,
    completionTokens: 4,
    contextMode: "start",
    recovered: false,
    historyTruncated: false,
  });
});

test("conversation deletion fails closed on provider cleanup and collects local assets", async (t) => {
  const harness = await setup(t);
  const created = harness.application.createConversation({
    title: "Private conversation",
  });
  const attachment = await harness.application.createAttachment({
    conversationId: created.conversationId,
    fileName: "private.txt",
    contentType: "text/plain",
    bytes: new TextEncoder().encode("private attachment"),
  });
  const sent = await harness.application.sendMessage({
    conversationId: created.conversationId,
    branchId: created.snapshot.conversation.rootBranchId,
    content: "Remember this",
    streamId: "stream-private",
    attachmentIds: [attachment.id],
  });
  const turn = harness.codex.turn("stream-private");
  harness.codex.emit("stream-private", {
    type: "complete",
    streamId: "stream-private",
    threadId: turn.threadId,
    turnId: turn.turnId,
    content: "Remembered.",
    reasoningSummary: null,
    promptTokens: 2,
    completionTokens: 1,
    contextMode: "start",
    recovered: false,
    historyTruncated: false,
  });
  await waitFor(
    () =>
      harness.repository.require(created.conversationId).messages[
        sent.pendingAssistantMessage.id
      ]?.inferenceContext?.threadId === turn.threadId,
  );

  harness.codex.deleteFailureMessage = "offline";
  await assert.rejects(
    harness.application.deleteConversation(created.conversationId),
    /No local conversation data was removed/u,
  );
  assert.ok(harness.repository.load(created.conversationId));
  assert.equal(
    (await harness.assets.resolveAssetFile(attachment.storageKey)).asset.assetId,
    attachment.storageKey,
  );

  harness.codex.deleteFailureMessage = null;
  await harness.application.deleteConversation(created.conversationId);
  assert.equal(harness.repository.load(created.conversationId), null);
  await assert.rejects(
    harness.assets.resolveAssetFile(attachment.storageKey),
    /not found/u,
  );
});
