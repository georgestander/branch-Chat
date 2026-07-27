import assert from "node:assert/strict";
import test from "node:test";

import {
  IPC_CHANNELS,
  STREAM_PROTOCOL_VERSION,
} from "./contracts.ts";
import {
  IPC_PAYLOAD_VALIDATORS,
  PAYLOAD_LIMITS,
  PayloadValidationError,
  validateBootstrapConversationInput,
  validateBranchIdentityInput,
  validateBranchyStreamEvent,
  validateCancelChatGptLoginInput,
  validateCancelMessageInput,
  validateConversationIdentityInput,
  validateCreateAttachmentInput,
  validateCreateConversationInput,
  validateEmptyPayload,
  validateExportArchiveInput,
  validateGeneratedImageIdentityInput,
  validateImportArchiveInput,
  validateListConversationsInput,
  validateLoadConversationInput,
  validateOpenExternalInput,
  validateRemoveAttachmentInput,
  validateRenameBranchInput,
  validateRenameConversationInput,
  validateRetryGeneratedImageInput,
  validateSaveBranchNoteInput,
  validateSaveComposerDraftInput,
  validateSaveGeneratedImageInput,
  validateSendMessageInput,
  validateStreamCloseInput,
  validateStreamOpenInput,
  validateStreamPortMessage,
  validateTranscribeAudioInput,
  validateUpdateBranchNoteInput,
  validateUpdateConversationCanvasInput,
  validateUpdateConversationSettingsInput,
} from "./validators.ts";

function rejects(
  operation: () => unknown,
  message?: string | RegExp,
): void {
  assert.throws(
    operation,
    (error: unknown) => {
      assert.ok(error instanceof PayloadValidationError);
      if (typeof message === "string") {
        assert.match(error.message, new RegExp(message));
      } else if (message) {
        assert.match(error.message, message);
      }
      return true;
    },
  );
}

test("IPC channels are exact, namespaced, and unique", () => {
  const channels = Object.values(IPC_CHANNELS);
  assert.equal(new Set(channels).size, channels.length);
  assert.ok(channels.every((channel) => channel.startsWith("branchy:")));
  assert.ok(channels.every((channel) => !channel.includes("rpc")));
  assert.deepEqual(
    Object.keys(IPC_PAYLOAD_VALIDATORS).sort(),
    [...channels].sort(),
  );
  assert.equal(IPC_CHANNELS.sendMessage, "branchy:message:send");
  assert.equal(IPC_CHANNELS.streamOpen, "branchy:stream:open");
});

test("empty and optional payload validators reject unknown keys", () => {
  assert.deepEqual(validateEmptyPayload(undefined), {});
  assert.deepEqual(validateEmptyPayload({}), {});
  rejects(() => validateEmptyPayload({ channel: "anything" }), "not allowed");

  assert.deepEqual(validateListConversationsInput(undefined), {});
  assert.deepEqual(validateListConversationsInput({ includeArchived: true }), {
    includeArchived: true,
  });
  rejects(
    () => validateListConversationsInput({ includeArchived: "yes" }),
    "must be a boolean",
  );
});

test("bootstrap and conversation identity inputs accept safe IDs only", () => {
  assert.deepEqual(
    validateBootstrapConversationInput({
      conversationId: "conversation_1",
      branchId: "conversation_1:root",
    }),
    { conversationId: "conversation_1", branchId: "conversation_1:root" },
  );
  assert.deepEqual(
    validateLoadConversationInput({ conversationId: "conversation_1" }),
    { conversationId: "conversation_1" },
  );
  assert.deepEqual(
    validateConversationIdentityInput({ conversationId: "conversation_1" }),
    { conversationId: "conversation_1" },
  );

  for (const unsafeId of [
    "../conversation",
    "folder/conversation",
    String.raw`folder\conversation`,
    ".hidden",
    "conversation.json",
    " conversation",
  ]) {
    rejects(() =>
      validateLoadConversationInput({ conversationId: unsafeId }),
    );
  }
  rejects(() =>
    validateBootstrapConversationInput({
      conversationId: "a".repeat(PAYLOAD_LIMITS.idCharacters + 1),
    }),
  );
});

test("conversation create, rename, and settings payloads are bounded", () => {
  assert.deepEqual(
    validateCreateConversationInput({
      title: "Desktop migration",
      initialMessage: "Plan this.",
      preset: "reasoning",
      model: "gpt-5.6-terra",
      reasoningEffort: "high",
      tools: ["web-search", "file-upload"],
    }),
    {
      title: "Desktop migration",
      initialMessage: "Plan this.",
      preset: "reasoning",
      model: "gpt-5.6-terra",
      reasoningEffort: "high",
      tools: ["web-search", "file-upload"],
    },
  );
  assert.deepEqual(
    validateRenameConversationInput({
      conversationId: "conversation_1",
      title: "A better title",
    }),
    { conversationId: "conversation_1", title: "A better title" },
  );
  assert.deepEqual(
    validateUpdateConversationSettingsInput({
      conversationId: "conversation_1",
      model: "gpt-5.6-terra",
      temperature: 0.4,
      systemPrompt: null,
      reasoningEffort: "xhigh",
      preset: "custom",
      tools: ["study-and-learn"],
    }),
    {
      conversationId: "conversation_1",
      model: "gpt-5.6-terra",
      temperature: 0.4,
      systemPrompt: null,
      reasoningEffort: "xhigh",
      preset: "custom",
      tools: ["study-and-learn"],
    },
  );

  rejects(() =>
    validateCreateConversationInput({
      initialMessage: "界".repeat(100_000),
    }),
  );
  rejects(() =>
    validateCreateConversationInput({
      tools: ["web-search", "web-search"],
    }),
  );
  rejects(() =>
    validateUpdateConversationSettingsInput({
      conversationId: "conversation_1",
    }),
  );
  rejects(() =>
    validateUpdateConversationSettingsInput({
      conversationId: "conversation_1",
      temperature: Number.NaN,
    }),
  );
  rejects(() =>
    validateUpdateConversationSettingsInput({
      conversationId: "conversation_1",
      model: "provider/model",
    }),
  );
});

test("canvas payloads bound coordinates, node counts, and node fields", () => {
  assert.deepEqual(
    validateUpdateConversationCanvasInput({
      conversationId: "conversation_1",
      viewport: { x: -20, y: 40, zoom: 1.25 },
      focusedBranchId: "branch_1",
      nodes: {
        branch_1: {
          x: 100,
          y: 200,
          width: 480,
          height: 720,
          folded: false,
          expanded: true,
        },
        branch_2: null,
      },
    }),
    {
      conversationId: "conversation_1",
      viewport: { x: -20, y: 40, zoom: 1.25 },
      focusedBranchId: "branch_1",
      nodes: {
        branch_1: {
          x: 100,
          y: 200,
          width: 480,
          height: 720,
          folded: false,
          expanded: true,
        },
        branch_2: null,
      },
    },
  );
  rejects(() =>
    validateUpdateConversationCanvasInput({
      conversationId: "conversation_1",
    }),
  );
  rejects(() =>
    validateUpdateConversationCanvasInput({
      conversationId: "conversation_1",
      viewport: { zoom: Number.POSITIVE_INFINITY },
    }),
  );
  rejects(() =>
    validateUpdateConversationCanvasInput({
      conversationId: "conversation_1",
      nodes: Object.fromEntries(
        Array.from(
          { length: PAYLOAD_LIMITS.canvasNodes + 1 },
          (_, index) => [`branch_${index}`, { x: index }],
        ),
      ),
    }),
  );
  rejects(() =>
    validateUpdateConversationCanvasInput({
      conversationId: "conversation_1",
      nodes: { "../branch": { x: 1 } },
    }),
  );
});

test("branch and note commands validate exact identities and selections", () => {
  assert.deepEqual(
    validateBranchIdentityInput({
      conversationId: "conversation_1",
      branchId: "branch_1",
    }),
    { conversationId: "conversation_1", branchId: "branch_1" },
  );
  assert.deepEqual(
    validateRenameBranchInput({
      conversationId: "conversation_1",
      branchId: "branch_1",
      title: "Follow-up",
    }),
    {
      conversationId: "conversation_1",
      branchId: "branch_1",
      title: "Follow-up",
    },
  );
  assert.deepEqual(
    validateSaveBranchNoteInput({
      conversationId: "conversation_1",
      parentBranchId: "branch_1",
      messageId: "message_1",
      span: { start: 3, end: 8 },
      excerpt: "hello",
      content: "Remember this.",
      attachmentIds: ["attachment_1"],
    }),
    {
      conversationId: "conversation_1",
      parentBranchId: "branch_1",
      messageId: "message_1",
      span: { start: 3, end: 8 },
      excerpt: "hello",
      content: "Remember this.",
      attachmentIds: ["attachment_1"],
    },
  );
  assert.deepEqual(
    validateUpdateBranchNoteInput({
      conversationId: "conversation_1",
      branchId: "branch_note",
      content: "Updated note.",
    }),
    {
      conversationId: "conversation_1",
      branchId: "branch_note",
      content: "Updated note.",
    },
  );
  rejects(() =>
    validateUpdateBranchNoteInput({
      conversationId: "conversation_1",
      branchId: "branch_note",
      content: " ",
    }),
  );
  rejects(() =>
    validateSaveBranchNoteInput({
      conversationId: "conversation_1",
      parentBranchId: "branch_1",
      messageId: "message_1",
      span: { start: 5, end: 5 },
      content: "No",
    }),
  );
  rejects(() =>
    validateBranchIdentityInput({
      conversationId: "conversation_1",
      branchId: "branch_1",
      arbitrary: true,
    }),
  );
});

test("composer draft commands preserve whitespace while bounding content", () => {
  assert.deepEqual(
    validateSaveComposerDraftInput({
      conversationId: "conversation_1",
      branchId: "branch_1",
      content: "  unfinished thought\nwith context  ",
    }),
    {
      conversationId: "conversation_1",
      branchId: "branch_1",
      content: "  unfinished thought\nwith context  ",
    },
  );
  assert.deepEqual(
    validateSaveComposerDraftInput({
      conversationId: "conversation_1",
      branchId: "branch_1",
      content: "",
    }),
    {
      conversationId: "conversation_1",
      branchId: "branch_1",
      content: "",
    },
  );
  rejects(() =>
    validateSaveComposerDraftInput({
      conversationId: "conversation_1",
      branchId: "branch_1",
      content: "界".repeat(100_000),
    }),
  );
  rejects(() =>
    validateSaveComposerDraftInput({
      conversationId: "conversation_1",
      branchId: "branch_1",
      content: "draft",
      localPath: "/tmp/draft.txt",
    }),
  );
});

test("send and cancel commands enforce stream-first target semantics", () => {
  assert.deepEqual(
    validateSendMessageInput({
      conversationId: "conversation_1",
      branchId: "branch_1",
      content: "Continue",
      streamId: "stream_1",
      tools: ["web-search"],
      attachmentIds: ["attachment_1", "attachment_2"],
    }),
    {
      conversationId: "conversation_1",
      branchId: "branch_1",
      content: "Continue",
      streamId: "stream_1",
      tools: ["web-search"],
      attachmentIds: ["attachment_1", "attachment_2"],
    },
  );
  assert.deepEqual(
    validateSendMessageInput({
      conversationId: "conversation_1",
      branchDraft: {
        parentBranchId: "branch_1",
        messageId: "message_1",
        span: { start: 0, end: 4 },
        excerpt: "Test",
      },
      content: "Explore this",
      streamId: "stream_2",
    }),
    {
      conversationId: "conversation_1",
      branchDraft: {
        parentBranchId: "branch_1",
        messageId: "message_1",
        span: { start: 0, end: 4 },
        excerpt: "Test",
      },
      content: "Explore this",
      streamId: "stream_2",
    },
  );
  assert.deepEqual(
    validateCancelMessageInput({
      conversationId: "conversation_1",
      streamId: "stream_1",
    }),
    { conversationId: "conversation_1", streamId: "stream_1" },
  );

  rejects(() =>
    validateSendMessageInput({
      conversationId: "conversation_1",
      content: "Missing target",
      streamId: "stream_1",
    }),
  );
  rejects(() =>
    validateSendMessageInput({
      conversationId: "conversation_1",
      branchId: "branch_1",
      branchDraft: {
        parentBranchId: "branch_1",
        messageId: "message_1",
      },
      content: "Two targets",
      streamId: "stream_1",
    }),
  );
  rejects(() =>
    validateSendMessageInput({
      conversationId: "conversation_1",
      branchId: "branch_1",
      content: "Too many files",
      streamId: "stream_1",
      attachmentIds: Array.from(
        { length: PAYLOAD_LIMITS.attachmentsPerMessage + 1 },
        (_, index) => `attachment_${index}`,
      ),
    }),
  );
});

test("attachment commands accept File-safe data and reject paths and excess bytes", () => {
  const bytes = new Uint8Array([1, 2, 3]);
  assert.deepEqual(
    validateCreateAttachmentInput({
      conversationId: "conversation_1",
      fileName: "research notes.pdf",
      contentType: "application/pdf",
      bytes,
      lastModified: 1_700_000_000_000,
    }),
    {
      conversationId: "conversation_1",
      fileName: "research notes.pdf",
      contentType: "application/pdf",
      bytes,
      lastModified: 1_700_000_000_000,
    },
  );
  assert.deepEqual(
    validateCreateAttachmentInput({
      conversationId: "conversation_1",
      fileName: "photo.png",
      contentType: "image/png",
      bytes: bytes.buffer,
    }).bytes,
    bytes.buffer,
  );
  assert.deepEqual(
    validateRemoveAttachmentInput({
      conversationId: "conversation_1",
      attachmentId: "attachment_1",
    }),
    {
      conversationId: "conversation_1",
      attachmentId: "attachment_1",
    },
  );

  for (const fileName of [
    "../secret.pdf",
    "/tmp/secret.pdf",
    String.raw`C:\secret.pdf`,
    "folder/file.pdf",
    "%2e%2e%2fsecret.pdf",
    ".hidden",
  ]) {
    rejects(() =>
      validateCreateAttachmentInput({
        conversationId: "conversation_1",
        fileName,
        contentType: "application/pdf",
        bytes,
      }),
    );
  }
  rejects(() =>
    validateCreateAttachmentInput({
      conversationId: "conversation_1",
      fileName: "script.js",
      contentType: "application/javascript",
      bytes,
    }),
  );
  rejects(() =>
    validateCreateAttachmentInput({
      conversationId: "conversation_1",
      fileName: "large.pdf",
      contentType: "application/pdf",
      bytes: new Uint8Array(PAYLOAD_LIMITS.attachmentBytes + 1),
    }),
  );
});

test("dictation accepts bounded WAV bytes only", () => {
  const bytes = new Uint8Array([82, 73, 70, 70]);
  assert.deepEqual(
    validateTranscribeAudioInput({
      contentType: "audio/wav",
      bytes,
    }),
    { contentType: "audio/wav", bytes },
  );
  rejects(() =>
    validateTranscribeAudioInput({
      contentType: "audio/mpeg",
      bytes,
    }),
  );
  rejects(() =>
    validateTranscribeAudioInput({
      contentType: "audio/wav",
      bytes: new Uint8Array(PAYLOAD_LIMITS.dictationBytes + 1),
    }),
  );
});

test("generated-image commands use opaque IDs and safe save names", () => {
  const identity = {
    conversationId: "conversation_1",
    messageId: "message_1",
    imageId: "image_1",
  };
  assert.deepEqual(validateGeneratedImageIdentityInput(identity), identity);
  assert.deepEqual(
    validateSaveGeneratedImageInput({
      ...identity,
      suggestedFileName: "branchy-image.png",
    }),
    { ...identity, suggestedFileName: "branchy-image.png" },
  );
  assert.deepEqual(
    validateRetryGeneratedImageInput({
      ...identity,
      branchId: "branch_1",
      prompt: "Draw it in blue",
      streamId: "stream_1",
    }),
    {
      ...identity,
      branchId: "branch_1",
      prompt: "Draw it in blue",
      streamId: "stream_1",
    },
  );
  rejects(() =>
    validateSaveGeneratedImageInput({
      ...identity,
      suggestedFileName: "../../image.png",
    }),
  );
  rejects(() =>
    validateGeneratedImageIdentityInput({
      ...identity,
      imageId: "assets/image_1",
    }),
  );
});

test("login, archive, and external-link payloads expose no credential or path fields", () => {
  assert.deepEqual(
    validateCancelChatGptLoginInput({ loginId: "login_1" }),
    { loginId: "login_1" },
  );
  assert.deepEqual(
    validateExportArchiveInput({
      conversationIds: ["conversation_1", "conversation_2"],
    }),
    { conversationIds: ["conversation_1", "conversation_2"] },
  );
  assert.deepEqual(
    validateImportArchiveInput({ conflictPolicy: "duplicate" }),
    { conflictPolicy: "duplicate" },
  );
  assert.deepEqual(
    validateOpenExternalInput({ url: "https://example.com/docs?q=branchy" }),
    { url: "https://example.com/docs?q=branchy" },
  );

  rejects(() =>
    validateCancelChatGptLoginInput({
      loginId: "login_1",
      accessToken: "secret",
    }),
  );
  rejects(() =>
    validateExportArchiveInput({
      path: "/Users/example/archive.branchychat",
    }),
  );
  rejects(() =>
    validateImportArchiveInput({
      conflictPolicy: "replace",
      path: "../archive.branchychat",
    }),
  );
  for (const url of [
    "http://example.com",
    "file:///tmp/secret",
    "data:text/html,hello",
    "javascript:alert(1)",
    "https://user:password@example.com",
  ]) {
    rejects(() => validateOpenExternalInput({ url }));
  }
});

test("stream open and close handshakes require two correlated opaque IDs", () => {
  const input = { streamId: "stream_1", subscriptionId: "subscription_1" };
  assert.deepEqual(validateStreamOpenInput(input), input);
  assert.deepEqual(validateStreamCloseInput(input), input);
  assert.deepEqual(
    validateStreamPortMessage({
      kind: "opened",
      protocolVersion: STREAM_PROTOCOL_VERSION,
      ...input,
    }),
    {
      kind: "opened",
      protocolVersion: STREAM_PROTOCOL_VERSION,
      ...input,
    },
  );
  rejects(() =>
    validateStreamOpenInput({
      streamId: "../stream",
      subscriptionId: "subscription_1",
    }),
  );
  rejects(() =>
    validateStreamPortMessage({
      kind: "opened",
      protocolVersion: 99,
      ...input,
    }),
  );
});

test("stream event union validates progress, image, terminal, and canonical completion", () => {
  assert.deepEqual(
    validateBranchyStreamEvent({
      type: "start",
      threadId: "thread_1",
      turnId: "turn_1",
      contextMode: "resume",
      recovered: false,
    }),
    {
      type: "start",
      threadId: "thread_1",
      turnId: "turn_1",
      contextMode: "resume",
      recovered: false,
    },
  );
  assert.deepEqual(validateBranchyStreamEvent({ type: "delta", delta: "Hi" }), {
    type: "delta",
    delta: "Hi",
  });
  assert.deepEqual(
    validateBranchyStreamEvent({
      type: "reasoning_summary",
      delta: "Checking",
      content: "Checking inputs",
    }),
    {
      type: "reasoning_summary",
      delta: "Checking",
      content: "Checking inputs",
    },
  );
  assert.deepEqual(
    validateBranchyStreamEvent({
      type: "tool_progress",
      tool: "image_generation",
      callId: "call_1",
      status: "running",
      query: "a blue tree",
    }),
    {
      type: "tool_progress",
      tool: "image_generation",
      callId: "call_1",
      status: "running",
      query: "a blue tree",
    },
  );
  assert.deepEqual(
    validateBranchyStreamEvent({
      type: "image_ready",
      imageId: "image_1",
      revisedPrompt: "A cobalt tree",
    }),
    {
      type: "image_ready",
      imageId: "image_1",
      revisedPrompt: "A cobalt tree",
    },
  );

  const canonical = {
    conversationId: "conversation_1",
    branchId: "branch_1",
    version: 4,
    assistantMessage: {
      id: "message_2",
      branchId: "branch_1",
      role: "assistant",
      content: "Finished",
      createdAt: "2026-07-23T10:00:00.000Z",
      tokenUsage: { prompt: 10, completion: 5, cost: 0 },
      attachments: null,
      toolInvocations: null,
    },
    assistantRenderedHtml: "<p>Finished</p>",
  };
  const complete = {
    type: "complete" as const,
    content: "Finished",
    canonical,
    promptTokens: 10,
    completionTokens: 5,
    threadId: "thread_1",
    turnId: "turn_1",
    recovered: false,
    historyTruncated: false,
  };
  assert.deepEqual(validateBranchyStreamEvent(complete), complete);
  assert.deepEqual(
    validateStreamPortMessage({
      kind: "event",
      protocolVersion: STREAM_PROTOCOL_VERSION,
      streamId: "stream_1",
      event: complete,
    }),
    {
      kind: "event",
      protocolVersion: STREAM_PROTOCOL_VERSION,
      streamId: "stream_1",
      event: complete,
    },
  );
  assert.deepEqual(validateBranchyStreamEvent({ type: "cancelled" }), {
    type: "cancelled",
  });
  assert.deepEqual(
    validateBranchyStreamEvent({
      type: "error",
      message: "Connection ended",
      recoverable: true,
    }),
    {
      type: "error",
      message: "Connection ended",
      recoverable: true,
    },
  );

  rejects(() =>
    validateBranchyStreamEvent({
      type: "delta",
      delta: "界".repeat(50_000),
    }),
  );
  rejects(() =>
    validateBranchyStreamEvent({
      ...complete,
      canonical: {
        ...canonical,
        branchId: "branch_2",
      },
    }),
  );
  rejects(() =>
    validateBranchyStreamEvent({
      type: "complete",
      content: "Finished",
    }),
  );
  rejects(() =>
    validateBranchyStreamEvent({
      type: "mystery",
      arbitrary: true,
    }),
  );
});
