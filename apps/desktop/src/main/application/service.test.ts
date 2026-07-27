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
import type {
  BranchyStreamEvent,
  SaveComposerDraftResult,
} from "../../shared/contracts.ts";

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

async function setup(
  t: test.TestContext,
  options: {
    draftSaveDelayMilliseconds?: number;
    drainMainLoop?: () => Promise<void>;
  } = {},
) {
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
  const titleUpdates: Array<{ conversationId: string; title: string }> = [];
  const application = new BranchyApplication({
    assets,
    codex,
    draftSaveDelayMilliseconds:
      options.draftSaveDelayMilliseconds ?? 0,
    drainMainLoop: options.drainMainLoop,
    repository,
    now: () => new Date(NOW),
    publishStream: (streamId, event) => {
      const events = streams.get(streamId) ?? [];
      events.push(event);
      streams.set(streamId, events);
    },
    publishConversationTitle: (update) => {
      titleUpdates.push(update);
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
    titleUpdates,
  };
}

test("first root exchange gets a fallback title then an isolated model title", async (t) => {
  const harness = await setup(t);
  const created = harness.application.createConversation();
  const branchId = created.snapshot.conversation.rootBranchId;

  await harness.application.sendMessage({
    conversationId: created.conversationId,
    branchId,
    content: "Explain why the sky is blue in simple language.",
    streamId: "stream-title-source",
  });
  const sourceTurn = harness.codex.turn("stream-title-source");
  harness.codex.emit("stream-title-source", {
    type: "complete",
    streamId: "stream-title-source",
    threadId: sourceTurn.threadId,
    turnId: sourceTurn.turnId,
    content: "Blue light scatters more strongly in Earth's atmosphere.",
    reasoningSummary: null,
    promptTokens: 10,
    completionTokens: 8,
    contextMode: "start",
    recovered: false,
    historyTruncated: false,
  });

  await waitFor(() => harness.codex.inputs.length === 2);
  assert.equal(
    harness.repository.getDirectoryEntry(created.conversationId)?.title,
    "Explain why the sky is blue in simple language",
  );
  assert.deepEqual(harness.titleUpdates, [
    {
      conversationId: created.conversationId,
      title: "Explain why the sky is blue in simple language",
    },
  ]);
  const titleInput = harness.codex.inputs[1]!;
  assert.equal(titleInput.threadId, null);
  assert.equal(titleInput.webSearch, false);
  assert.match(titleInput.content, /Assistant: Blue light scatters/u);

  const titleTurn = harness.codex.turn(titleInput.streamId);
  harness.codex.emit(titleInput.streamId, {
    type: "complete",
    streamId: titleInput.streamId,
    threadId: titleTurn.threadId,
    turnId: titleTurn.turnId,
    content: '"Why the Sky Is Blue."',
    reasoningSummary: null,
    promptTokens: 20,
    completionTokens: 6,
    contextMode: "start",
    recovered: false,
    historyTruncated: false,
  });

  await waitFor(
    () =>
      harness.repository.getDirectoryEntry(created.conversationId)?.title ===
      "Why the Sky Is Blue",
  );
  assert.deepEqual(harness.codex.deletedThreads, [[titleTurn.threadId]]);
  assert.deepEqual(harness.titleUpdates.at(-1), {
    conversationId: created.conversationId,
    title: "Why the Sky Is Blue",
  });
});

test("manual rename wins over an in-flight automatic title", async (t) => {
  const harness = await setup(t);
  const created = harness.application.createConversation();
  const branchId = created.snapshot.conversation.rootBranchId;

  await harness.application.sendMessage({
    conversationId: created.conversationId,
    branchId,
    content: "Plan a garden.",
    streamId: "stream-title-manual",
  });
  const sourceTurn = harness.codex.turn("stream-title-manual");
  harness.codex.emit("stream-title-manual", {
    type: "complete",
    streamId: "stream-title-manual",
    threadId: sourceTurn.threadId,
    turnId: sourceTurn.turnId,
    content: "Start with sunlight and soil.",
    reasoningSummary: null,
    promptTokens: 4,
    completionTokens: 5,
    contextMode: "start",
    recovered: false,
    historyTruncated: false,
  });
  await waitFor(() => harness.codex.inputs.length === 2);
  harness.application.renameConversation(
    created.conversationId,
    "My Garden Notes",
  );

  const titleInput = harness.codex.inputs[1]!;
  const titleTurn = harness.codex.turn(titleInput.streamId);
  harness.codex.emit(titleInput.streamId, {
    type: "complete",
    streamId: titleInput.streamId,
    threadId: titleTurn.threadId,
    turnId: titleTurn.turnId,
    content: "Garden Planning Basics",
    reasoningSummary: null,
    promptTokens: 8,
    completionTokens: 4,
    contextMode: "start",
    recovered: false,
    historyTruncated: false,
  });

  await waitFor(() => harness.codex.deletedThreads.length === 1);
  assert.equal(
    harness.repository.getDirectoryEntry(created.conversationId)?.title,
    "My Garden Notes",
  );
});

test("bootstrap backfills completed legacy default titles locally", async (t) => {
  const harness = await setup(t);
  const created = harness.application.createConversation();
  const branchId = created.snapshot.conversation.rootBranchId;
  const snapshot = structuredClone(created.snapshot);
  snapshot.messages.user = {
    id: "user",
    branchId,
    role: "user",
    content: "Review the quarterly forecast.",
    createdAt: NOW.toISOString(),
  };
  snapshot.messages.assistant = {
    id: "assistant",
    branchId,
    role: "assistant",
    content: "The forecast is on track.",
    createdAt: NOW.toISOString(),
  };
  snapshot.branches[branchId]!.messageIds = ["user", "assistant"];
  harness.repository.save(snapshot);

  const bootstrap = await harness.application.bootstrap({
    conversationId: created.conversationId,
  });

  assert.equal(bootstrap.kind, "ready");
  assert.equal(
    harness.repository.getDirectoryEntry(created.conversationId)?.title,
    "Review the quarterly forecast",
  );
  assert.equal(harness.codex.inputs.length, 0);
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for application state");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("bootstrap restores per-branch drafts and sending clears the canonical draft", async (t) => {
  const harness = await setup(t);
  const created = harness.application.createConversation({
    title: "Draft recovery",
  });
  const branchId = created.snapshot.conversation.rootBranchId;

  assert.deepEqual(
    await harness.application.saveComposerDraft({
      conversationId: created.conversationId,
      branchId,
      content: "  continue this thought\nwith the evidence  ",
    }),
    {
      conversationId: created.conversationId,
      branchId,
      content: "  continue this thought\nwith the evidence  ",
      updatedAt: NOW.toISOString(),
    },
  );
  const bootstrap = await harness.application.bootstrap({
    conversationId: created.conversationId,
    branchId,
  });
  assert.equal(bootstrap.kind, "ready");
  if (bootstrap.kind === "ready") {
    assert.deepEqual(bootstrap.draftsByBranch, {
      [branchId]: "  continue this thought\nwith the evidence  ",
    });
  }
  assert.deepEqual(
    harness.application.loadConversation(created.conversationId)
      .draftsByBranch,
    {
      [branchId]: "  continue this thought\nwith the evidence  ",
    },
  );

  const sent = await harness.application.sendMessage({
    conversationId: created.conversationId,
    branchId,
    content: "continue this thought with the evidence",
    streamId: "stream-draft-clear",
  });

  assert.deepEqual(sent.draftsByBranch, {});
  assert.deepEqual(
    harness.repository.loadDrafts(created.conversationId),
    {},
  );
  const turn = harness.codex.turn("stream-draft-clear");
  harness.codex.emit("stream-draft-clear", {
    type: "complete",
    streamId: "stream-draft-clear",
    threadId: turn.threadId,
    turnId: turn.turnId,
    content: "Done.",
    reasoningSummary: null,
    promptTokens: 10,
    completionTokens: 2,
    contextMode: "start",
    recovered: false,
    historyTruncated: false,
  });
});

test("main-owned draft debounce preserves ordering across reload and send", async (t) => {
  const harness = await setup(t, {
    draftSaveDelayMilliseconds: 60_000,
  });
  const created = harness.application.createConversation({
    title: "Draft ordering",
  });
  const branchId = created.snapshot.conversation.rootBranchId;

  const olderSave = harness.application.saveComposerDraft({
    conversationId: created.conversationId,
    branchId,
    content: "older",
  });
  const newerSave = harness.application.saveComposerDraft({
    conversationId: created.conversationId,
    branchId,
    content: "newer",
  });
  const bootstrap = await harness.application.bootstrap({
    conversationId: created.conversationId,
    branchId,
  });

  await Promise.all([olderSave, newerSave]);
  assert.equal(bootstrap.kind, "ready");
  if (bootstrap.kind === "ready") {
    assert.deepEqual(bootstrap.draftsByBranch, {
      [branchId]: "newer",
    });
  }

  const pendingAtSend = harness.application.saveComposerDraft({
    conversationId: created.conversationId,
    branchId,
    content: "send this",
  });
  const sent = await harness.application.sendMessage({
    conversationId: created.conversationId,
    branchId,
    content: "send this",
    streamId: "stream-draft-ordering",
  });

  await pendingAtSend;
  assert.deepEqual(sent.draftsByBranch, {});
  assert.deepEqual(
    harness.repository.loadDrafts(created.conversationId),
    {},
  );
  const turn = harness.codex.turn("stream-draft-ordering");
  harness.codex.emit("stream-draft-ordering", {
    type: "complete",
    streamId: "stream-draft-ordering",
    threadId: turn.threadId,
    turnId: turn.turnId,
    content: "Done.",
    reasoningSummary: null,
    promptTokens: 3,
    completionTokens: 1,
    contextMode: "start",
    recovered: false,
    historyTruncated: false,
  });
});

test(
  "close drains a final renderer draft before closing persistence",
  async (t) => {
    let queueLateDraft = () => {};
    const harness = await setup(t, {
      draftSaveDelayMilliseconds: 60_000,
      drainMainLoop: async () => {
        queueLateDraft();
        await Promise.resolve();
      },
    });
    const created = harness.application.createConversation({
      title: "Quit-safe draft",
    });
    const branchId = created.snapshot.conversation.rootBranchId;
    let resolveLateSave:
      | ((result: SaveComposerDraftResult) => void)
      | undefined;
    let rejectLateSave: ((error: unknown) => void) | undefined;
    const lateSave = new Promise<SaveComposerDraftResult>((resolve, reject) => {
      resolveLateSave = resolve;
      rejectLateSave = reject;
    });
    queueLateDraft = () => {
      queueLateDraft = () => {};
      void harness.application
        .saveComposerDraft({
          conversationId: created.conversationId,
          branchId,
          content: "the final keystroke",
        })
        .then(resolveLateSave, rejectLateSave);
    };

    await harness.application.close();

    assert.equal((await lateSave)?.content, "the final keystroke");
    await assert.rejects(
      harness.application.saveComposerDraft({
        conversationId: created.conversationId,
        branchId,
        content: "too late",
      }),
      /Branchy Chat is closing/u,
    );
  },
);

test("close waits for an immediate draft mutation accepted during its drain", async (t) => {
  let queueLateDraft = () => {};
  const harness = await setup(t, {
    drainMainLoop: async () => {
      queueLateDraft();
    },
  });
  const created = harness.application.createConversation({
    title: "Quit-safe immediate draft",
  });
  const branchId = created.snapshot.conversation.rootBranchId;
  let resolveLateSave:
    | ((result: SaveComposerDraftResult) => void)
    | undefined;
  let rejectLateSave: ((error: unknown) => void) | undefined;
  const lateSave = new Promise<SaveComposerDraftResult>((resolve, reject) => {
    resolveLateSave = resolve;
    rejectLateSave = reject;
  });
  queueLateDraft = () => {
    queueLateDraft = () => {};
    void harness.application
      .saveComposerDraft({
        conversationId: created.conversationId,
        branchId,
        content: "immediate final keystroke",
      })
      .then(resolveLateSave, rejectLateSave);
  };

  await harness.application.close();

  assert.equal((await lateSave)?.content, "immediate final keystroke");
});

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
  assert.deepEqual(
    harness.codex.inputs[1]?.additionalContext?.[
      "branch-source-selection"
    ],
    {
      kind: "application",
      value:
        "The user created this child from the following exact span of the parent assistant response. " +
        "Treat this selected span as the primary focus of the new branch request. " +
        "Use inherited conversation only as supporting context; do not replace the selected subject with a broader topic.\n\n" +
        "Here is the image.",
    },
  );
  assert.equal(harness.codex.inputs[1]?.content, "Explore a red version");
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

test("saved notes remain editable and can seed a model-backed child branch", async (t) => {
  const harness = await setup(t);
  const created = harness.application.createConversation({
    title: "Notes",
  });
  const rootBranchId = created.snapshot.conversation.rootBranchId;
  const rootTurn = await harness.application.sendMessage({
    conversationId: created.conversationId,
    branchId: rootBranchId,
    content: "Capture useful observations.",
    streamId: "stream-note-root",
  });

  const saved = harness.application.saveBranchNote({
    conversationId: created.conversationId,
    parentBranchId: rootBranchId,
    messageId: rootTurn.optimisticUserMessage.id,
    content: "The first observation.",
  });
  assert.equal(saved.branch.kind, "note");

  const updated = harness.application.updateBranchNote({
    conversationId: created.conversationId,
    branchId: saved.branch.id,
    content: "The corrected observation.",
  });
  assert.equal(updated.updatedMessage.content, "The corrected observation.");
  assert.equal(
    harness.repository.require(created.conversationId).branches[saved.branch.id]
      ?.kind,
    "note",
  );

  const child = await harness.application.sendMessage({
    conversationId: created.conversationId,
    content: "Explore this observation.",
    streamId: "stream-note-child",
    branchDraft: {
      parentBranchId: saved.branch.id,
      messageId: updated.updatedMessage.id,
      excerpt: updated.updatedMessage.content,
    },
  });
  assert.equal(child.createdBranch?.kind, undefined);
  assert.equal(child.createdBranch?.parentId, saved.branch.id);
  assert.deepEqual(
    harness.codex.inputs[1]?.additionalContext?.[
      "branch-source-selection"
    ],
    {
      kind: "application",
      value:
        "The user created this child from the following saved note. " +
        "Treat this selected span as the primary focus of the new branch request. " +
        "Use inherited conversation only as supporting context; do not replace the selected subject with a broader topic.\n\n" +
        "The corrected observation.",
    },
  );

  const rootSession = harness.codex.turn("stream-note-root");
  harness.codex.emit("stream-note-root", {
    type: "cancelled",
    streamId: "stream-note-root",
    threadId: rootSession.threadId,
    turnId: rootSession.turnId,
  });
  const childSession = harness.codex.turn("stream-note-child");
  harness.codex.emit("stream-note-child", {
    type: "cancelled",
    streamId: "stream-note-child",
    threadId: childSession.threadId,
    turnId: childSession.turnId,
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
